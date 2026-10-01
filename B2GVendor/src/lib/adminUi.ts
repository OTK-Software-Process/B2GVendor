import type { AppLang } from '@/context/AppContext';
import type { BackendSetupEmailResult } from '@/lib/backend';

// Small helpers shared by the admin account pages (vendors and staff).

export type Translate = (th: string, en: string) => string;

export function formatDate(iso: string | null | undefined, lang: AppLang): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium' });
}

/** Turns the server's "was the set-password email sent?" answer into a message for the admin. */
export function setupEmailMessage(email: string, result: BackendSetupEmailResult, t: Translate): { ok: boolean; text: string } {
  if (result.sent) return { ok: true, text: t(`ส่งอีเมลลิงก์ตั้งรหัสผ่านไปที่ ${email} แล้ว`, `A set-password email was sent to ${email}.`) };
  return {
    ok: false,
    text:
      result.reason === 'smtp_not_configured'
        ? t('ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์อีเมล จึงไม่ได้ส่งอีเมล', 'Email is not configured on the server, so no email was sent.')
        : t('ส่งอีเมลไม่สำเร็จ กรุณากด “ส่งลิงก์ตั้งรหัสผ่าน” อีกครั้งภายหลัง', 'The email could not be sent. Use “Send password link” to try again later.')
  };
}
