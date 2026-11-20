import { NextFunction, Request, Response } from 'express';

// Keys that can reach an object's prototype. JSON.parse keeps "__proto__" as an
// ordinary key, and copying it onto a plain object with `obj[key] = value`
// REPLACES that object's prototype -- so it is dropped here, with its two
// relatives, before anything else sees the body (ASVS V15.3.6).
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isDangerousKey(key: string): boolean {
  // `$`-prefixed and dotted keys are MongoDB operators / paths (NoSQL injection).
  return key.startsWith('$') || key.includes('.') || PROTOTYPE_KEYS.has(key);
}

export function stripDangerousKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDangerousKeys);
  }

  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isDangerousKey(key)) {
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
