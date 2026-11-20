type Level = 'info' | 'warn' | 'error';

// The line is passed as an ARGUMENT to a fixed '%s' format, never as the format
// itself: console.log() treats its first string as a printf-style template, so
// a request URL or Origin containing %s / %d / %o / %j / %c would otherwise be
// expanded and could swallow or rearrange what follows (ASVS V1.3.10).
function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`;
  if (level === 'error') {
    console.error('%s', line, meta ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn('%s', line, meta ?? '');
    return;
  }
  console.log('%s', line, meta ?? '');
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta)
};
