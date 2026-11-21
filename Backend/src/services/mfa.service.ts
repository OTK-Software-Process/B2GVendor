import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { clock } from '../config/clock';
import { mfaKey } from '../config/mfa';
import { Account, IAccount, isStaffRole } from '../models/account.model';
import { MfaCredential, IRecoveryCodeEntry, IdentityCheck } from '../models/mfaCredential.model';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { maskEmail } from '../utils/privacy';
import { hashPassword, verifyPassword } from '../utils/passwordHasher';
import { decrypt, encrypt, SecretBoxError } from '../utils/secretBox';
import { generateRecoveryCode, looksLikeTotpCode, parseRecoveryCode, RECOVERY_CODE_COUNT } from '../utils/recoveryCodes';
import { generateTotpSecret, matchingTimeStep, otpauthUri } from '../utils/totp';
import { audit } from './audit.service';
import { confirmPassword } from './account.service';
import { clearMfaFailures, reserveMfaAttempt } from './loginLockout.service';
import { isEmailConfigured, MfaNotice, sendMfaNoticeEmail } from './email.service';
import { revokeAllSessions, revokeOtherSessions } from './session.service';

// Two-step verification with an authenticator app (TOTP) and recovery codes
// (ASVS V6.3.3, V6.4.4, V6.5.1-V6.5.6, V6.5.8; docs/Security.md section 15).
//
// The rules this file keeps:
//   * A code works ONCE: the highest accepted time step is stored, and a code of
//     that step or an older one is refused; a recovery code is marked used in the
//     same atomic update that accepts it (V6.5.1).
//   * Time is the server's. Nothing from the client says what time it is (V6.5.8).
//   * The seed is encrypted at rest and bound to its account; recovery codes are
//     hashed and shown once (V6.5.2, V6.5.3).
//   * Wrong codes are counted and locked apart from the password's, and a correct
//     password never clears that count (see loginLockout.service.ts).
//   * Every change needs the password again, and most need a valid code too.

/** How long a secret handed out by setup waits to be proven. */
export const SETUP_TTL_MS = 10 * 60 * 1000;

export type SecondFactorMethod = 'totp' | 'recovery_code';

export interface SecondFactorResult {
  method: SecondFactorMethod;
  /** Only after a recovery code: how many are left. */
  recoveryCodesRemaining?: number;
}

export interface MfaStatus {
  /** Whether this server can do two-step verification at all (a key is configured). */
  available: boolean;
  enabled: boolean;
  enabledAt: Date | null;
  recoveryCodesRemaining: number;
  /** The account's role must use it (staff, while MFA_REQUIRED_FOR_STAFF is on). */
  required: boolean;
  /** Required and not yet set up: the account can reach nothing but the setup. */
  setupRequired: boolean;
}

function requireKey(): Buffer {
  const key = mfaKey();
  if (!key) throw AppError.serviceUnavailable('Two-step verification is not available on this server.');
  return key;
}

const isRequiredFor = (account: Pick<IAccount, 'role'>): boolean => isStaffRole(account.role) && env.MFA_REQUIRED_FOR_STAFF;

function who(account: Pick<IAccount, '_id' | 'role' | 'email'>): { accountId: string; role: string; email: string } {
  return { accountId: String(account._id), role: account.role, email: maskEmail(account.email) };
}

// A compare against a hash nothing can match, for a recovery code whose ID is
// unknown: the answer then takes as long as a real wrong code does.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'), env.BCRYPT_ROUNDS);
  return dummyHash;
}

async function notify(account: Pick<IAccount, 'email' | 'name'>, what: MfaNotice): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    await sendMfaNoticeEmail(account.email, account.name, what);
  } catch (error) {
    logger.warn('mfa', `Could not send the two-step verification notice to ${maskEmail(account.email)}`, error);
  }
}

function setMfaFlag(accountId: Types.ObjectId, enabled: boolean): Promise<unknown> {
  // Bookkeeping: the explicit audit entries below say what happened, so the
  // automatic diff of the flag is left out (it would be a second, vaguer row).
  return audit.withoutAuto(() => Account.updateOne({ _id: accountId }, { $set: { mfaEnabled: enabled } }).exec());
}

// ------------------------------------------------------------------ status

export async function getStatus(account: IAccount): Promise<MfaStatus> {
  const credential = await MfaCredential.findOne({ accountId: account._id }).select('+recoveryCodes enabledAt');
  const enabled = !!credential?.enabledAt && account.mfaEnabled;
  return {
    available: !!mfaKey(),
    enabled,
    enabledAt: enabled ? (credential?.enabledAt ?? null) : null,
    recoveryCodesRemaining: enabled ? (credential?.recoveryCodes ?? []).filter(code => !code.usedAt).length : 0,
    required: isRequiredFor(account),
    setupRequired: isRequiredFor(account) && !account.mfaEnabled
  };
}

// ------------------------------------------------------------------ checking a code

type FailureReason = 'invalid_code' | 'replayed' | 'locked';

function fail(account: Pick<IAccount, '_id' | 'role' | 'email'>, purpose: string, reason: FailureReason): never {
  logger.security('warn', 'auth.mfa.failure', { purpose, reason, ...who(account) });
  throw AppError.invalidMfaCode();
}

/**
 * Checks the second factor an account supplied: a six-digit authenticator code,
 * or a recovery code. Used at sign-in and by every sensitive change.
 *
 * The attempt is claimed BEFORE the code is looked at (so a burst of parallel
 * guesses cannot all be checked before the lock lands), and a correct code clears
 * the count.
 */
export async function verifySecondFactor(account: IAccount, input: string, purpose: string): Promise<SecondFactorResult> {
  const key = requireKey();
  const credential = await MfaCredential.findOne({ accountId: account._id }).select('+secretEnc +recoveryCodes');
  if (!credential?.enabledAt || !credential.secretEnc) throw AppError.conflict('Two-step verification is not on for this account.');

  const attempt = await reserveMfaAttempt(account._id);
  if (!attempt.allowed) {
    logger.security('warn', 'auth.mfa.failure', { purpose, reason: 'locked', ...who(account) });
    throw AppError.accountLocked(attempt.retryAfterSeconds);
  }
  if (attempt.lockedUntil) logger.security('warn', 'auth.lockout', { scope: 'mfa', ...who(account), lockedUntil: attempt.lockedUntil });

  const code = input.trim();

  // ---- an authenticator code
  if (looksLikeTotpCode(code)) {
    let step: number | null;
    try {
      step = matchingTimeStep(decrypt(credential.secretEnc, key, String(account._id)), code, clock.now(), env.MFA_TOTP_DRIFT_STEPS);
    } catch (error) {
      if (!(error instanceof SecretBoxError)) throw error;
      // The stored seed cannot be read: the wrong key, or the data was changed. That is
      // a fault to see, not a wrong code to count.
      logger.error('mfa', `The authenticator secret of ${maskEmail(account.email)} could not be decrypted (is MFA_ENCRYPTION_KEY the key it was made with?)`, error);
      throw AppError.internalError('Two-step verification could not be checked. Please contact an administrator.');
    }
    if (step === null) return fail(account, purpose, 'invalid_code');

    // The code is right. It is accepted only if its step is newer than the newest one
    // already used, and the claim is one atomic update: two requests carrying the same
    // code race here and exactly one wins (V6.5.1).
    const claim = await MfaCredential.updateOne({ accountId: account._id, lastUsedStep: { $lt: step } }, { $set: { lastUsedStep: step } });
    if (claim.modifiedCount === 0) return fail(account, purpose, 'replayed');

    await clearMfaFailures(account._id);
    return { method: 'totp' };
  }

  // ---- a recovery code
  const parsed = parseRecoveryCode(code);
  if (!parsed) return fail(account, purpose, 'invalid_code');
  const entry = credential.recoveryCodes.find(candidate => candidate.id === parsed.id && !candidate.usedAt);
  const matches = await verifyPassword(parsed.secret, entry?.hash ?? (await getDummyHash()));
  if (!entry || !matches) return fail(account, purpose, 'invalid_code');

  // Marked used in the very update that accepts it: a second request with the same code finds nothing to match.
  const claim = await MfaCredential.updateOne(
    { accountId: account._id, recoveryCodes: { $elemMatch: { id: entry.id, usedAt: { $exists: false } } } },
    { $set: { 'recoveryCodes.$.usedAt': new Date() } }
  );
  if (claim.modifiedCount === 0) return fail(account, purpose, 'replayed');

  await clearMfaFailures(account._id);
  const remaining = credential.recoveryCodes.filter(candidate => !candidate.usedAt).length - 1;
  logger.security('warn', 'auth.mfa.recovery_used', { purpose, remaining, ...who(account) });
  await notify(account, 'recovery_code_used');
  return { method: 'recovery_code', recoveryCodesRemaining: remaining };
}

// ------------------------------------------------------------------ recovery codes

async function newRecoveryCodes(): Promise<{ shown: string[]; entries: IRecoveryCodeEntry[] }> {
  const generated: ReturnType<typeof generateRecoveryCode>[] = [];
  const ids = new Set<string>();
  while (generated.length < RECOVERY_CODE_COUNT) {
    const code = generateRecoveryCode();
    if (ids.has(code.id)) continue; // two codes with one ID could not be told apart
    ids.add(code.id);
    generated.push(code);
  }
  const entries = await Promise.all(generated.map(async code => ({ id: code.id, hash: await hashPassword(code.secret, env.BCRYPT_ROUNDS) })));
  return { shown: generated.map(code => code.display), entries };
}

// ------------------------------------------------------------------ setting up

export interface SetupStarted {
  /** The secret, in Base32, to type into an authenticator app. */
  secret: string;
  /** The same as an otpauth:// address, for a QR code or a tap-to-add link. */
  otpauthUri: string;
  expiresInSeconds: number;
}

/**
 * Step one: after the password is proved again, a new secret is made and kept
 * (encrypted) as PENDING. Nothing is turned on, and signing in does not change,
 * until step two proves the app really has it.
 */
export async function beginSetup(account: IAccount, password: string): Promise<SetupStarted> {
  const key = requireKey();
  await confirmPassword(String(account._id), password, 'mfa_setup');
  if (account.mfaEnabled) throw AppError.conflict('Two-step verification is already on. Turn it off first to set up a new authenticator.');

  const secret = generateTotpSecret();
  await MfaCredential.updateOne(
    { accountId: account._id },
    { $set: { pendingSecretEnc: encrypt(secret, key, String(account._id)), pendingExpiresAt: new Date(clock.now() + SETUP_TTL_MS) } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  logger.security('info', 'account.mfa.setup_started', who(account));

  return { secret, otpauthUri: otpauthUri({ secret, account: account.email, issuer: env.MFA_ISSUER }), expiresInSeconds: SETUP_TTL_MS / 1000 };
}

export interface Enabled {
  /** Shown ONCE. Only their hashes are kept. */
  recoveryCodes: string[];
  otherSessionsRevoked: number;
}

/**
 * Step two: a code made from the pending secret proves the app has it. The
 * factor is then switched on, ten recovery codes are made, and every OTHER
 * session of the account is ended (a stolen session made before the second factor
 * existed must not outlive it).
 */
export async function enable(account: IAccount, code: string, currentSessionId: string): Promise<Enabled> {
  const key = requireKey();
  if (account.mfaEnabled) throw AppError.conflict('Two-step verification is already on.');

  const credential = await MfaCredential.findOne({ accountId: account._id }).select('+pendingSecretEnc');
  if (!credential?.pendingSecretEnc || !credential.pendingExpiresAt || credential.pendingExpiresAt.getTime() <= clock.now()) {
    throw AppError.badRequest('The setup has expired. Start again to get a new secret.');
  }

  const attempt = await reserveMfaAttempt(account._id);
  if (!attempt.allowed) throw AppError.accountLocked(attempt.retryAfterSeconds);
  if (attempt.lockedUntil) logger.security('warn', 'auth.lockout', { scope: 'mfa', ...who(account), lockedUntil: attempt.lockedUntil });

  const step = looksLikeTotpCode(code) ? matchingTimeStep(decrypt(credential.pendingSecretEnc, key, String(account._id)), code.trim(), clock.now(), env.MFA_TOTP_DRIFT_STEPS) : null;
  if (step === null) return fail(account, 'mfa_setup', 'invalid_code');

  const { shown, entries } = await newRecoveryCodes();
  // The pending secret becomes the active one, once: of two parallel requests with the same code, one finds nothing to update.
  const activated = await MfaCredential.findOneAndUpdate(
    { accountId: account._id, pendingSecretEnc: credential.pendingSecretEnc, enabledAt: { $exists: false } },
    {
      $set: { secretEnc: credential.pendingSecretEnc, enabledAt: new Date(), lastUsedStep: step, recoveryCodes: entries, recoveryCodesGeneratedAt: new Date(), failedCount: 0 },
      $unset: { pendingSecretEnc: 1, pendingExpiresAt: 1, lockedUntil: 1, lastFailedAt: 1 }
    },
    { new: true }
  );
  if (!activated) throw AppError.conflict('Two-step verification was just turned on from another request.');

  await setMfaFlag(account._id, true);
  const otherSessionsRevoked = await revokeOtherSessions(account._id, currentSessionId);
  logger.security('info', 'account.mfa.enabled', { ...who(account), otherSessionsRevoked });
  await audit.log({ action: 'account.mfa_enabled', entity: account, force: true, metadata: { role: account.role, accountType: account.type, otherSessionsRevoked } });
  await notify(account, 'enabled');
  return { recoveryCodes: shown, otherSessionsRevoked };
}

// ------------------------------------------------------------------ changing it

/** New recovery codes; the old ones stop working. Needs the password AND a valid code. */
export async function regenerateRecoveryCodes(account: IAccount, password: string, code: string): Promise<{ recoveryCodes: string[] }> {
  requireKey();
  if (!account.mfaEnabled) throw AppError.conflict('Two-step verification is not on for this account.');
  await confirmPassword(String(account._id), password, 'mfa_recovery_codes');
  await verifySecondFactor(account, code, 'mfa_recovery_codes');

  const { shown, entries } = await newRecoveryCodes();
  await MfaCredential.updateOne({ accountId: account._id }, { $set: { recoveryCodes: entries, recoveryCodesGeneratedAt: new Date() } });
  logger.security('info', 'account.mfa.recovery_regenerated', who(account));
  await audit.log({ action: 'account.mfa_recovery_regenerated', entity: account, force: true, metadata: { role: account.role, accountType: account.type } });
  await notify(account, 'recovery_codes_regenerated');
  return { recoveryCodes: shown };
}

/** Turns it off. Needs the password AND a valid code, and is refused for a role that must use it. */
export async function disable(account: IAccount, password: string, code: string, currentSessionId: string): Promise<{ otherSessionsRevoked: number }> {
  requireKey();
  if (!account.mfaEnabled) throw AppError.conflict('Two-step verification is not on for this account.');
  if (isRequiredFor(account)) throw AppError.forbidden('Two-step verification is required for your role and cannot be turned off. If you lost your authenticator, ask a Super Admin to reset it.');
  await confirmPassword(String(account._id), password, 'mfa_disable');
  await verifySecondFactor(account, code, 'mfa_disable');

  await clearMfa(account._id);
  const otherSessionsRevoked = await revokeOtherSessions(account._id, currentSessionId);
  logger.security('info', 'account.mfa.disabled', { ...who(account), otherSessionsRevoked });
  await audit.log({ action: 'account.mfa_disabled', entity: account, force: true, metadata: { role: account.role, accountType: account.type } });
  await notify(account, 'disabled');
  return { otherSessionsRevoked };
}

/** Removes an account's second factor completely: the secret, the codes, the counters and the flag. */
export async function clearMfa(accountId: Types.ObjectId): Promise<void> {
  await MfaCredential.deleteOne({ accountId });
  await setMfaFlag(accountId, false);
}

// ------------------------------------------------------------------ a lost factor

export interface MfaResetRequest {
  /** The administrator doing it. */
  actor: IAccount;
  /** Their own password: a stolen admin session must not be able to strip someone's second factor. */
  actorPassword: string;
  /** How the person's identity was established. Recorded; the code cannot check it, only insist it was stated. */
  identityCheck: IdentityCheck;
  /** What was done, in words. Recorded. */
  reason: string;
}

/**
 * ASVS V6.4.4: a lost second factor is replaced only after an identity check as
 * strong as the one at enrolment. The enrolment proof was a password plus control
 * of the mailbox; a reset therefore has to be done by a person who vouches for the
 * identity, on the record: the administrator must re-enter their own password,
 * state which check was done and why, and all of it goes in the audit log. The
 * account's sessions are ended, the owner is emailed, and (for staff) the account
 * must set up a new factor at its next sign-in.
 */
export async function resetByAdmin(target: IAccount, request: MfaResetRequest): Promise<{ sessionsRevoked: number }> {
  await confirmPassword(String(request.actor._id), request.actorPassword, 'mfa_reset');
  if (!target.mfaEnabled && !(await MfaCredential.exists({ accountId: target._id }))) throw AppError.conflict('Two-step verification is not on for this account.');

  await clearMfa(target._id);
  const sessionsRevoked = await revokeAllSessions(target._id);

  logger.security('warn', 'account.mfa.reset', { ...who(target), by: String(request.actor._id), identityCheck: request.identityCheck, sessionsRevoked });
  await audit.log({
    action: 'account.mfa_reset',
    entity: target,
    force: true,
    metadata: { role: target.role, accountType: target.type, identityCheck: request.identityCheck, reason: request.reason, resetBy: request.actor.email, sessionsRevoked }
  });
  await notify(target, 'reset');
  return { sessionsRevoked };
}

/** The same, for the command line (Super Admin accounts, which the admin panel never changes). The operator's access to the server is the identity check. */
export async function resetFromCommandLine(target: IAccount, reason: string): Promise<{ sessionsRevoked: number }> {
  await clearMfa(target._id);
  const sessionsRevoked = await revokeAllSessions(target._id);
  logger.security('warn', 'account.mfa.reset', { ...who(target), by: 'command_line', sessionsRevoked });
  await audit.asSystem('mfa-reset-script', () =>
    audit.log({ action: 'account.mfa_reset', entity: target, force: true, metadata: { role: target.role, accountType: target.type, identityCheck: 'server_access', reason, resetBy: 'command line', sessionsRevoked } })
  );
  await notify(target, 'reset');
  return { sessionsRevoked };
}
