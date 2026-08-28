import { NextFunction, Request, Response } from 'express';

function stripDangerousKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDangerousKeys);
  }

  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) {
        continue;
      }
      clean[key] = stripDangerousKeys(val);
    }
    return clean;
  }

  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = stripDangerousKeys(req.body);
  }
  next();
}
