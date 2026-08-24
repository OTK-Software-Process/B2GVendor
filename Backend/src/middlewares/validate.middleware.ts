import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { AppError, FieldErrors } from '../utils/AppError';

export type ValidationSource = 'body' | 'query' | 'params';

export function zodErrorToFields(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!(key in fields)) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

export function validate(schema: ZodTypeAny, source: ValidationSource = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(AppError.validation(zodErrorToFields(result.error)));
      return;
    }

    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };
}
