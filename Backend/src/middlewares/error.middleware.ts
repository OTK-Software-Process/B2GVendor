import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError, FieldErrors } from '../utils/AppError';
import { fail } from '../utils/apiResponse';
import { logger } from '../utils/logger';
import { isProduction } from '../config/env';

interface DuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): err is DuplicateKeyError {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function mongooseValidationFields(err: mongoose.Error.ValidationError): FieldErrors {
  const fields: FieldErrors = {};
  for (const [path, issue] of Object.entries(err.errors)) {
    fields[path] = issue.message;
  }
  return fields;
}

// Errors thrown by express.json() / body-parser for a body the CLIENT got wrong
// (broken JSON, a bare string, too big, an unsupported charset). They carry an
// `entity.*`-style `type` and a 4xx `status`; anything else is a real server fault.
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  if (typeof err !== 'object' || err === null) return false;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return typeof type === 'string' && /^(entity\.|encoding\.|charset\.|request\.)/.test(type) && typeof status === 'number' && status >= 400 && status < 500;
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound());
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): Response {
  if (err instanceof AppError) {
    return fail(res, err.status, err.code, err.message, err.fields, err.details);
  }

  if (isBodyParserError(err)) {
    // Never echo the parser's own message: it quotes the offending input.
    const problem = err.type === 'entity.too.large' ? AppError.payloadTooLarge() : AppError.badRequest('The request body is not valid JSON.');
    return fail(res, problem.status, problem.code, problem.message);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const validation = AppError.validation(mongooseValidationFields(err));
    return fail(res, validation.status, validation.code, validation.message, validation.fields);
  }

  if (err instanceof mongoose.Error.CastError) {
    const notFound = AppError.notFound();
    return fail(res, notFound.status, notFound.code, notFound.message);
  }

  if (isDuplicateKeyError(err)) {
    if (err.keyPattern && 'email' in err.keyPattern) {
      const conflict = AppError.emailAlreadyRegistered();
      return fail(res, conflict.status, conflict.code, conflict.message, conflict.fields);
    }
    return fail(res, 409, 'VALIDATION_ERROR', 'That value is already in use.');
  }

  logger.error('error', `${req.method} ${req.originalUrl}`, err);

  return fail(
    res,
    500,
    'INTERNAL_ERROR',
    isProduction ? 'Something went wrong.' : String((err as Error)?.message ?? err)
  );
}
