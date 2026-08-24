type Level = 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`;
  if (level === 'error') {
    console.error(line, meta ?? '');
    return;
  }
  if (level === 'warn') {
    console.warn(line, meta ?? '');
    return;
  }
  console.log(line, meta ?? '');
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit('error', scope, message, meta)
};
