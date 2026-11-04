import type { AppLang } from '@/context/AppContext';

const PWNED_PASSWORD_MESSAGE =
  'This password has appeared in known data breaches. Please choose a different password.';
const PASSWORD_RESET_REQUEST_ERROR =
  'An error occurred while processing the password reset request.';

export function localizeAuthError(message: string, lang: AppLang): string {
  if (lang === 'en') {
    return message;
  }

  switch (message) {
    case PWNED_PASSWORD_MESSAGE:
      return 'รหัสผ่านนี้เคยปรากฏในข้อมูลจากเหตุการณ์ข้อมูลรั่วไหล โปรดเลือกรหัสผ่านอื่น';
    case PASSWORD_RESET_REQUEST_ERROR:
      return 'เกิดข้อผิดพลาดขณะดำเนินการคำขอตั้งรหัสผ่านใหม่';
    default:
      return message;
  }
}
