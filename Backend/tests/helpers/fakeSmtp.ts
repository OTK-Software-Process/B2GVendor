import net from 'net';
import { env } from '../../src/config/env';

// A throwaway SMTP server on 127.0.0.1 that accepts every message and keeps it
// in memory. Lets a check exercise the "email is configured" paths (sign-up
// sends a verification link) without Backend/.env's real SMTP ever being used.
// No STARTTLS and no AUTH are offered, so nodemailer sends in plain text.
export interface FakeSmtp {
  messages: string[];
  // When each message was accepted (Date.now()), same order as `messages`.
  acceptedAt: number[];
  // Most messages being delivered at the same time (fully sent, not yet accepted).
  maxInFlightMessages: number;
  // Answer the next message with "550 rejected" instead of accepting it.
  rejectNextMessage(): void;
  close(): Promise<void>;
}

export interface FakeSmtpOptions {
  // Wait this long before accepting each message -- a real provider takes tens
  // to hundreds of milliseconds per message.
  acceptDelayMs?: number;
}

type SmtpSettings = { SMTP_HOST?: string; SMTP_PORT?: number; SMTP_USER?: string; SMTP_PASS?: string };

export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const messages: string[] = [];
  const acceptedAt: number[] = [];
  let inFlight = 0;
  const stats = { maxInFlightMessages: 0 };
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
            const message = data.join('\n');
            data = null;
            inFlight += 1;
            stats.maxInFlightMessages = Math.max(stats.maxInFlightMessages, inFlight);
            const accept = (): void => {
              inFlight -= 1;
              messages.push(message);
              acceptedAt.push(Date.now());
              reply('250 queued');
            };
            if (options.acceptDelayMs) setTimeout(accept, options.acceptDelayMs);
            else accept();
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
    acceptedAt,
    get maxInFlightMessages() {
      return stats.maxInFlightMessages;
    },
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
