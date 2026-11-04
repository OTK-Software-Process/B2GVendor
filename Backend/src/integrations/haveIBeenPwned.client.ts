import { createHash } from 'crypto';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

const PWNED_PASSWORDS_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const REQUEST_TIMEOUT_MS = 5000;

function serviceUnavailable(): AppError {
  return AppError.serviceUnavailable(
    'Password safety check is temporarily unavailable. Please try again later.',
  );
}

export async function assertPasswordNotPwned(password: string): Promise<void> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let response: Response;
  try {
    response = await fetch(`${PWNED_PASSWORDS_RANGE_URL}${prefix}`, {
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'B2GVendor-Password-Check',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    logger.warn('haveIBeenPwned', 'Password range request failed.');
    throw serviceUnavailable();
  }

  if (!response.ok) {
    logger.warn('haveIBeenPwned', `Password range request returned HTTP ${response.status}.`);
    throw serviceUnavailable();
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    logger.warn('haveIBeenPwned', 'Could not read the password range response.');
    throw serviceUnavailable();
  }

  const rows = body.split(/\r?\n/).filter((row) => row.length > 0);
  if (rows.length === 0) {
    logger.warn('haveIBeenPwned', 'Password range response was empty.');
    throw serviceUnavailable();
  }

  let isPwned = false;
  for (const row of rows) {
    const [rangeSuffix, count, ...extra] = row.split(':');
    if (
      extra.length > 0 ||
      !/^[0-9A-F]{35}$/i.test(rangeSuffix ?? '') ||
      !/^\d+$/.test(count ?? '')
    ) {
      logger.warn('haveIBeenPwned', 'Password range response was malformed.');
      throw serviceUnavailable();
    }

    if (rangeSuffix.toUpperCase() === suffix && Number(count) > 0) {
      isPwned = true;
    }
  }

  if (isPwned) {
    throw AppError.badRequest(
      'This password has appeared in known data breaches. Please choose a different password.',
    );
  }
}
