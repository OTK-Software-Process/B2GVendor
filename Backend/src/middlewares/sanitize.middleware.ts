import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

// Keys that can reach an object's prototype. JSON.parse keeps "__proto__" as an
// ordinary key, and copying it onto a plain object with `obj[key] = value`
// REPLACES that object's prototype -- so it is dropped here, with its two
// relatives, before anything else sees the body (ASVS V15.3.6).
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isDangerousKey(key: string): boolean {
  // `$`-prefixed and dotted keys are MongoDB operators / paths (NoSQL injection).
  return key.startsWith('$') || key.includes('.') || PROTOTYPE_KEYS.has(key);
}

export function stripDangerousKeys(value: unknown, dropped: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map(item => stripDangerousKeys(item, dropped));
  }

  if (value !== null && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isDangerousKey(key)) {
        dropped.push(key);
        continue;
      }
      clean[key] = stripDangerousKeys(val, dropped);
    }
    return clean;
  }

  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    const dropped: string[] = [];
    req.body = stripDangerousKeys(req.body, dropped);
    // No form of the website ever sends such a key: seeing one is a probe for
    // NoSQL injection or prototype pollution (ASVS V16.3.3).
    if (dropped.length > 0) {
      logger.security('warn', 'input.dangerous_keys_dropped', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        keys: [...new Set(dropped)].slice(0, 10).map(key => key.slice(0, 40)),
        ip: req.ip
      });
    }
  }
  next();
}
