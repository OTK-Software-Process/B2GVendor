import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { maskEmail, tokenLink } from '../utils/privacy';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    });
  }

  return transporter;
}

/** Whether outgoing mail is configured. */
export function isEmailConfigured(): boolean {
  return !!env.SMTP_HOST;
}

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

async function send(mail: Mail): Promise<void> {
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    throw new Error('SMTP is not configured; email could not be sent.');
  }

  await activeTransporter.sendMail({ from: env.MAIL_FROM, ...mail });
  logger.info('email', `sent "${mail.subject}" to ${maskEmail(mail.to)}`);
}

function layout(heading: string, body: string, buttonLabel: string, url: string, footerHtml = ''): string {
  return `<!doctype html>
<html lang="th">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(body)}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(buttonLabel)}</a>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">${escapeHtml(url)}</p>
      ${footerHtml}
    </div>
  </body>
</html>`;
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  rawToken: string
): Promise<void> {
  const url = tokenLink(env.APP_URL, 'reset-password', rawToken);

  await send({
    to,
    subject: 'ตั้งรหัสผ่านใหม่ | Reset your B2G Vendor password',
    text: `สวัสดีคุณ ${name}\n\nตั้งรหัสผ่านใหม่ภายใน 1 ชั่วโมง:\n${url}\n\nIf you did not request this, you can ignore this email.`,
    html: layout(
      'ตั้งรหัสผ่านใหม่',
      `สวัสดีคุณ ${name} — กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้มีอายุ 1 ชั่วโมง หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้`,
      'ตั้งรหัสผ่านใหม่',
      url
    )
  });
}

export async function sendPasswordSetupEmail(
  to: string,
  name: string,
  rawToken: string
): Promise<void> {
  const url = tokenLink(env.APP_URL, 'reset-password', rawToken);

  await send({
    to,
    subject: 'ตั้งรหัสผ่านสำหรับบัญชีใหม่ | Set your B2G Vendor password',
    text: `สวัสดีคุณ ${name}\n\nผู้ดูแลระบบได้สร้างบัญชีให้คุณ กรุณาตั้งรหัสผ่านภายใน 1 ชั่วโมง:\n${url}`,
    html: layout(
      'ตั้งรหัสผ่านสำหรับบัญชีใหม่',
      `สวัสดีคุณ ${name} — ผู้ดูแลระบบได้สร้างบัญชี B2G Vendor ให้คุณแล้ว กรุณาตั้งรหัสผ่านภายใน 1 ชั่วโมง`,
      'ตั้งรหัสผ่าน',
      url
    )
  });
}

export async function sendEmailVerificationEmail(
  to: string,
  name: string,
  rawToken: string
): Promise<void> {
  const url = tokenLink(env.APP_URL, 'verify-email', rawToken);

  await send({
    to,
    subject: 'ยืนยันอีเมลบัญชี B2G Vendor | Verify your B2G Vendor email',
    text: `สวัสดีคุณ ${name}\n\nยืนยันอีเมลของคุณภายใน 24 ชั่วโมง:\n${url}\n\nIf you did not create this account, you can ignore this email.`,
    html: layout(
      'ยืนยันอีเมลบัญชี B2G Vendor',
      `สวัสดีคุณ ${name} — กดปุ่มด้านล่างเพื่อยืนยันอีเมลของคุณ ลิงก์นี้มีอายุ 24 ชั่วโมง หากคุณไม่ได้สร้างบัญชีนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้`,
      'ยืนยันอีเมล',
      url
    )
  });
}

/**
 * ASVS V6.3.7: sent after every password change and reset, so the owner notices
 * a change they did not make. It carries no link that changes anything -- only
 * the way to the forgot-password page, to take the account back.
 */
export async function sendPasswordChangedEmail(to: string, name: string, how: 'changed' | 'reset'): Promise<void> {
  const resetUrl = `${env.APP_URL}/forgot-password`;
  const when = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long', timeStyle: 'short' });
  const thaiHow = how === 'reset' ? 'ตั้งรหัสผ่านใหม่ผ่านลิงก์ทางอีเมล' : 'เปลี่ยนรหัสผ่านในหน้าบัญชี';
  const englishHow = how === 'reset' ? 'reset through an emailed link' : 'changed from the account page';

  await send({
    to,
    subject: 'รหัสผ่านของคุณถูกเปลี่ยนแล้ว | Your B2G Vendor password was changed',
    text:
      `สวัสดีคุณ ${name}\n\nรหัสผ่านบัญชี B2G Vendor ของคุณถูก${thaiHow}เมื่อ ${when} และอุปกรณ์อื่นถูกออกจากระบบแล้ว ` +
      `หากไม่ใช่คุณ กรุณาตั้งรหัสผ่านใหม่ทันทีที่ ${resetUrl}\n\n` +
      `Your B2G Vendor password was ${englishHow} on ${when} (Bangkok time), and your other devices were signed out. ` +
      `If this was not you, reset your password now: ${resetUrl}`,
    html: layout(
      'รหัสผ่านของคุณถูกเปลี่ยนแล้ว',
      `สวัสดีคุณ ${name} — รหัสผ่านบัญชี B2G Vendor ของคุณถูก${thaiHow}เมื่อ ${when} และอุปกรณ์อื่นถูกออกจากระบบแล้ว หากเป็นคุณ ไม่ต้องดำเนินการใด ๆ หากไม่ใช่คุณ กรุณาตั้งรหัสผ่านใหม่ทันที`,
      'ตั้งรหัสผ่านใหม่',
      resetUrl
    )
  });
}

/**
 * Sent instead of a verification email when someone signs up with an email that
 * already has an account. The sign-up itself answers exactly as for a new
 * address (ASVS V6.3.8), so only the owner of the mailbox learns the account
 * exists -- and is pointed to sign-in and password reset.
 */
export async function sendAccountExistsEmail(to: string, name: string): Promise<void> {
  const loginUrl = `${env.APP_URL}/login`;
  const resetUrl = `${env.APP_URL}/forgot-password`;

  await send({
    to,
    subject: 'มีการสมัครด้วยอีเมลของคุณ | Someone tried to sign up with your email',
    text:
      `สวัสดีคุณ ${name}\n\nมีผู้พยายามสมัครบัญชี B2G Vendor ด้วยอีเมลนี้ ซึ่งมีบัญชีอยู่แล้ว ` +
      `หากเป็นคุณ เข้าสู่ระบบได้ที่ ${loginUrl} หรือตั้งรหัสผ่านใหม่ที่ ${resetUrl}\n\n` +
      `Someone tried to create a B2G Vendor account with this email, which already has one. ` +
      `If it was you, sign in or reset your password. If not, you can ignore this email -- nothing has changed.`,
    html: layout(
      'มีการสมัครด้วยอีเมลของคุณ',
      `สวัสดีคุณ ${name} — มีผู้พยายามสมัครบัญชี B2G Vendor ด้วยอีเมลนี้ ซึ่งมีบัญชีอยู่แล้ว หากเป็นคุณ กรุณาเข้าสู่ระบบ หรือตั้งรหัสผ่านใหม่หากจำไม่ได้ หากไม่ใช่คุณ ไม่ต้องดำเนินการใด ๆ บัญชีของคุณไม่มีการเปลี่ยนแปลง`,
      'เข้าสู่ระบบ',
      loginUrl,
      `<p style="margin:16px 0 0;font-size:12px;color:#64748b;">Forgot your password? <a href="${escapeHtml(resetUrl)}" style="color:#0284c7;">Reset it here</a>.</p>`
    )
  });
}

export async function sendNewWorkMatchEmail(
  to: string,
  name: string,
  work: string,
  matchedTagNames: string[],
  unsubscribeToken: string,
): Promise<void> {
  const url = `${env.APP_URL}/works/${encodeURIComponent(work)}`;
  const unsubscribeUrl = tokenLink(env.APP_URL, 'unsubscribe', unsubscribeToken);
  const unsubscribeFooter = `<p style="margin:24px 0 0;font-size:12px;color:#64748b;">To stop these emails, <a href="${escapeHtml(unsubscribeUrl)}" style="color:#0284c7;">unsubscribe here</a>.</p>`;

  await send({
    to,
    subject: "งานใหม่ตรงกับแท็กที่คุณติดตาม | New work matches your followed tags",
    text: `สวัสดีคุณ ${name}\n\nมีงานใหม่ที่ตรงกับแท็กที่คุณติดตาม: ${matchedTagNames.join(', ')}\n\nดูรายละเอียดงานได้ที่: ${url}\n\nTo stop these emails: ${unsubscribeUrl}`,
    html: layout(
      'งานใหม่ตรงกับแท็กที่คุณติดตาม',
      `สวัสดีคุณ ${name} — มีงานใหม่ที่ตรงกับแท็กที่คุณติดตาม: ${matchedTagNames.join(', ')}`,
      'ดูรายละเอียดงาน',
      url,
      unsubscribeFooter,
    )
  });
}

export interface DailyDigestItem {
  workId: string;
  workTitle: string;
  agencyName: string;
  matchedTags: string[];
}

// account/notifications/settings' 'daily' frequency option -- one summary
// email covering every match since the last digest, instead of an email per
// match. Unlike sendNewWorkMatchEmail, this has multiple links (one per
// work), so it builds its own HTML rather than reusing layout()'s
// single-button shape.
export async function sendDailyDigestEmail(to: string, name: string, items: DailyDigestItem[], unsubscribeToken: string): Promise<void> {
  const unsubscribeUrl = tokenLink(env.APP_URL, 'unsubscribe', unsubscribeToken);
  const rows = items
    .map(item => {
      const url = `${env.APP_URL}/works/${encodeURIComponent(item.workId)}`;
      return `<li style="margin:0 0 16px;">
        <a href="${escapeHtml(url)}" style="color:#0284c7;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(item.workTitle)}</a>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(item.agencyName)} — ${escapeHtml(item.matchedTags.join(', '))}</div>
      </li>`;
    })
    .join('');

  const textLines = items.map(item => `- ${item.workTitle} (${item.agencyName}) -- ${env.APP_URL}/works/${item.workId}`).join('\n');

  await send({
    to,
    subject: `สรุปงานใหม่ประจำวัน (${items.length} รายการ) | Your daily digest (${items.length} new)`,
    text: `สวัสดีคุณ ${name}\n\nมีงานใหม่ที่ตรงกับแท็กที่คุณติดตาม ${items.length} รายการในวันนี้:\n\n${textLines}\n\nTo stop these emails: ${unsubscribeUrl}`,
    html: `<!doctype html>
<html lang="th">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">สรุปงานใหม่ประจำวัน</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">สวัสดีคุณ ${escapeHtml(name)} — มีงานใหม่ที่ตรงกับแท็กที่คุณติดตาม ${items.length} รายการในวันนี้:</p>
      <ul style="margin:0;padding:0;list-style:none;">${rows}</ul>
      <p style="margin:24px 0 0;font-size:12px;color:#64748b;">To stop these emails, <a href="${escapeHtml(unsubscribeUrl)}" style="color:#0284c7;">unsubscribe here</a>.</p>
    </div>
  </body>
</html>`
  });
}