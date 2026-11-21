import net from 'node:net';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Antivirus scan of every TOR file downloaded from the feed, BEFORE it is
// unpacked, parsed or stored (ASVS V5.4.3). The scanner is ClamAV's daemon
// (clamd, the `clamav` service in docker-compose.yml), spoken to over TCP with
// its INSTREAM command:
//
//   client: "zINSTREAM\0", then chunks of <4-byte big-endian length><bytes>,
//           then a zero-length chunk
//   clamd:  "stream: OK\0" | "stream: <signature> FOUND\0" | "... ERROR\0"
//
// Fail closed: when a scanner is configured (CLAMAV_HOST) and cannot give an
// answer, the file is treated like a failed download -- not stored, and the next
// poll's retry sweep tries again. Without CLAMAV_HOST (local `npm run dev`)
// scanning is off and that is logged once.

const CHUNK_BYTES = 64 * 1024;

export class MalwareFoundError extends Error {
  constructor(public readonly signature: string) {
    super(`Antivirus found ${signature}`);
    this.name = 'MalwareFoundError';
  }
}

export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(`Antivirus scan could not complete: ${message}`);
    this.name = 'ScannerUnavailableError';
  }
}

export function isScanningEnabled(): boolean {
  return !!env.CLAMAV_HOST;
}

/** Sends `buffer` to clamd and returns its verdict line ("stream: OK", ...). */
export function clamdInstream(buffer: Buffer, host: string, port: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let reply = '';
    let settled = false;
    const finish = (err: Error | null, value?: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(value ?? '');
    };

    socket.setTimeout(timeoutMs, () => finish(new ScannerUnavailableError(`no answer from ${host}:${port} within ${timeoutMs} ms`)));
    socket.on('error', err => finish(new ScannerUnavailableError(err.message)));
    socket.on('data', chunk => {
      reply += chunk.toString('utf8');
      const end = reply.indexOf('\0');
      if (end !== -1) finish(null, reply.slice(0, end).trim());
    });
    socket.on('end', () => finish(reply ? null : new ScannerUnavailableError('connection closed without a verdict'), reply.replace(/\0/g, '').trim()));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
        const chunk = buffer.subarray(offset, offset + CHUNK_BYTES);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk: end of stream
    });
  });
}

let warnedDisabled = false;

/**
 * Throws MalwareFoundError for an infected file and ScannerUnavailableError when
 * the configured scanner cannot answer. Returns normally for a clean file, or
 * when no scanner is configured.
 */
export async function assertFileIsClean(buffer: Buffer, source: string): Promise<void> {
  if (!env.CLAMAV_HOST) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      logger.warn('antivirus', 'CLAMAV_HOST is not set: downloaded TOR files are NOT scanned (set it in production; docker compose does)');
    }
    return;
  }

  const verdict = await clamdInstream(buffer, env.CLAMAV_HOST, env.CLAMAV_PORT, env.CLAMAV_TIMEOUT_MS);
  if (/^stream: OK$/.test(verdict)) return;

  const found = /^stream: (.+) FOUND$/.exec(verdict);
  if (found) {
    let host = source;
    try {
      host = new URL(source).hostname;
    } catch {
      // keep the raw source
    }
    logger.security('error', 'tor.malware_found', { signature: found[1].slice(0, 200), sourceHost: host, bytes: buffer.length });
    throw new MalwareFoundError(found[1]);
  }
  // e.g. "INSTREAM size limit exceeded. ERROR" -- never treat as clean.
  throw new ScannerUnavailableError(verdict.slice(0, 200) || 'empty verdict');
}
