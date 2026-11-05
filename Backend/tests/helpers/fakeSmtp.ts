import net from 'net';
import { env } from '../../src/config/env';

// A throwaway SMTP server on 127.0.0.1 that accepts every message and keeps it
// in memory. Lets a check exercise the "email is configured" paths (sign-up
// sends a verification link) without Backend/.env's real SMTP ever being used.
// No STARTTLS and no AUTH are offered, so nodemailer sends in plain text.
export interface FakeSmtp {
  messages: string[];
  rejectNextMessage(): void;
  close(): Promise<void>;
}

type SmtpSettings = { SMTP_HOST?: string; SMTP_PORT?: number; SMTP_USER?: string; SMTP_PASS?: string };

export async function startFakeSmtp(): Promise<FakeSmtp> {
  const messages: string[] = [];
  let rejectNextMessage = false;
  const server = net.createServer(socket => {
    let buffer = '';
    let data: string[] | null = null;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake-smtp');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let end: number;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            if (rejectNextMessage) {
              rejectNextMessage = false;
              reply('550 message rejected by test server');
              data = null;
              continue;
            }
            messages.push(data.join('\n'));
            data = null;
            reply('250 queued');
          } else {
            data.push(line.startsWith('.') ? line.slice(1) : line); // undo dot-stuffing
          }
        } else if (/^DATA$/i.test(line)) {
          data = [];
          reply('354 go ahead');
        } else if (/^QUIT/i.test(line)) {
          reply('221 bye');
          socket.end();
        } else {
          reply('250 ok');
        }
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));

  const settings = env as SmtpSettings;
  settings.SMTP_HOST = '127.0.0.1';
  settings.SMTP_PORT = (server.address() as net.AddressInfo).port;
  settings.SMTP_USER = undefined;
  settings.SMTP_PASS = undefined;

  return {
    messages,
    rejectNextMessage: () => {
      rejectNextMessage = true;
    },
    close: () =>
      new Promise<void>(resolve => {
        settings.SMTP_HOST = undefined;
        server.close(() => resolve());
      })
  };
}
