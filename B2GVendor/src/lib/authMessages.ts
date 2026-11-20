import type { AppLang } from '@/context/AppContext';

const PWNED_PASSWORD_MESSAGE =
  'This password has appeared in known data breaches. Please choose a different password.';
const PASSWORD_RESET_REQUEST_ERROR =
  'An error occurred while processing the password reset request.';

// Server messages for the brute-force protections (rate limits and the
// per-account lock), so they are not shown in English on the Thai interface.
const SIGN_IN_RATE_LIMIT_MESSAGE = 'Too many sign-in attempts. Please try again in a few minutes.';
const PASSWORD_RESET_RATE_LIMIT_MESSAGE = 'Too many password reset requests. Please try again later.';
const ACCOUNT_LOCKED_MESSAGE = /^Too many failed sign-in attempts\. Please try again in (\d+) minutes?\.$/;

// The password rules (Backend/src/utils/passwordPolicy.ts): 8-128 characters of
// any kind, not made mostly of the site's name or the person's own details.
const PASSWORD_TOO_SHORT = 'Password must be at least 8 characters';
const PASSWORD_TOO_LONG = 'Password must be at most 128 characters';
const PASSWORD_TOO_GUESSABLE =
  'This password is too easy to guess: it is mostly the name of this site, your name or your email address. Add words of your own.';

export function localizeAuthError(message: string, lang: AppLang): string {
  if (lang === 'en') {
    return message;
  }

  const locked = ACCOUNT_LOCKED_MESSAGE.exec(message);
  if (locked) {
    return `กรอกรหัสผ่านผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${locked[1]} นาที`;
  }

  switch (message) {
    case SIGN_IN_RATE_LIMIT_MESSAGE:
      return 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ในอีกสักครู่';
    case PASSWORD_RESET_RATE_LIMIT_MESSAGE:
      return 'ส่งคำขอตั้งรหัสผ่านใหม่บ่อยเกินไป กรุณาลองใหม่ภายหลัง';
    case PWNED_PASSWORD_MESSAGE:
      return 'รหัสผ่านนี้เคยปรากฏในข้อมูลจากเหตุการณ์ข้อมูลรั่วไหล โปรดเลือกรหัสผ่านอื่น';
    case PASSWORD_RESET_REQUEST_ERROR:
      return 'เกิดข้อผิดพลาดขณะดำเนินการคำขอตั้งรหัสผ่านใหม่';
    case PASSWORD_TOO_SHORT:
      return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    case PASSWORD_TOO_LONG:
      return 'รหัสผ่านยาวได้ไม่เกิน 128 ตัวอักษร';
    case PASSWORD_TOO_GUESSABLE:
      return 'รหัสผ่านนี้เดาง่ายเกินไป เพราะส่วนใหญ่เป็นชื่อเว็บไซต์ ชื่อ หรืออีเมลของคุณ กรุณาเพิ่มคำของคุณเอง';
    default:
      return message;
  }
}
