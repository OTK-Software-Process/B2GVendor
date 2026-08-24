import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

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

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function send(mail: Mail): Promise<void> {
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    logger.warn('email', `SMTP not configured, email not sent to ${mail.to}`, {
      subject: mail.subject,
      text: mail.text
    });
    return;
  }

  await activeTransporter.sendMail({ from: env.MAIL_FROM, ...mail });
  logger.info('email', `sent "${mail.subject}" to ${mail.to}`);
}

function layout(heading: string, body: string, buttonLabel: string, url: string): string {
  return `<!doctype html>
<html lang="th">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">${heading}</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#334155;">${body}</p>
      <a href="${url}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;">${buttonLabel}</a>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">${url}</p>
    </div>
  </body>
</html>`;
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  rawToken: string
): Promise<void> {
  const url = `${env.APP_URL}/verify-email/${rawToken}`;

  await send({
    to,
    subject: 'ยืนยันอีเมลของคุณ | Verify your B2G Vendor email',
    text: `สวัสดีคุณ ${name}\n\nกรุณายืนยันอีเมลของคุณภายใน 24 ชั่วโมง:\n${url}\n\nHi ${name}, please verify your email within 24 hours using the link above.`,
    html: layout(
      'ยืนยันอีเมลของคุณ',
      `สวัสดีคุณ ${name} — กรุณายืนยันอีเมลเพื่อเริ่มใช้งานบัญชี B2G Vendor ลิงก์นี้มีอายุ 24 ชั่วโมง`,
      'ยืนยันอีเมล',
      url
    )
  });
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  rawToken: string
): Promise<void> {
  const url = `${env.APP_URL}/reset-password/${rawToken}`;

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
  const url = `${env.APP_URL}/reset-password/${rawToken}`;

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
