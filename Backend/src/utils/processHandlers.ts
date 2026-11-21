import { logger } from './logger';

/**
 * The "last resort" error handler for a whole process (ASVS V16.5.4).
 *
 * Express already turns an error thrown inside a route into a 500, but an
 * error outside any request -- a rejected promise nobody awaited in a timer, a
 * throw inside an event handler -- would otherwise end the process with only
 * Node's default stack dump, or (for a rejection, before Node 15) be ignored.
 *
 * Here both are logged through the normal logger with what kind of failure it
 * was, and the process then exits with code 1. Carrying on after an unknown
 * failure would mean running in a state nobody designed for; Docker's
 * `restart: unless-stopped` starts a clean process instead.
 */
export function installProcessHandlers(processName: string): void {
  let exiting = false;
  const fail = (kind: string, err: unknown): void => {
    logger.error('process', `${processName}: ${kind} -- exiting`, err);
    if (exiting) return;
    exiting = true;
    process.exitCode = 1;
    // Give the log line a moment to reach stdout/stderr, then stop for sure.
    setTimeout(() => process.exit(1), 100).unref();
  };

  process.on('uncaughtException', (err, origin) => fail(origin === 'unhandledRejection' ? 'unhandled promise rejection' : 'uncaught exception', err));
  process.on('unhandledRejection', reason => fail('unhandled promise rejection', reason));
}
