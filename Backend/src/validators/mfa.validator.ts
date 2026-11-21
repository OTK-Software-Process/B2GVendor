import { z } from 'zod';
import { IDENTITY_CHECKS } from '../models/mfaCredential.model';
import { mfaCodeSchema } from './auth.validator';

// Every change to a second factor asks for the password again (and most for a
// code). Strict: an unknown field is refused, and no field carries a time.

const passwordField = z.string().min(1, 'Password is required').max(1000);

export const mfaSetupSchema = z.object({ password: passwordField }).strict();

export const mfaEnableSchema = z.object({ code: mfaCodeSchema }).strict();

export const mfaChangeSchema = z.object({ password: passwordField, code: mfaCodeSchema }).strict();

// An administrator resetting someone's lost second factor (ASVS V6.4.4): their own
// password, which identity check was done, and what was done. All of it is recorded.
export const mfaResetSchema = z
  .object({
    password: passwordField,
    identityCheck: z.enum(IDENTITY_CHECKS, { message: 'Choose how the identity was checked' }),
    reason: z.string().trim().min(10, 'Describe what was checked, in at least 10 characters').max(500, 'At most 500 characters')
  })
  .strict();

export type MfaResetInput = z.infer<typeof mfaResetSchema>;
