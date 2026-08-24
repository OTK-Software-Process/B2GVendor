import { Response } from 'express';
import { ErrorCode, FieldErrors } from './AppError';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    fields?: FieldErrors;
  };
}

export function ok<T>(res: Response, data: T, status = 200): Response {
  const body: SuccessEnvelope<T> = { success: true, data };
  return res.status(status).json(body);
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, 201);
}

export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  fields?: FieldErrors
): Response {
  const body: ErrorEnvelope = { success: false, error: { code, message } };
  if (fields) body.error.fields = fields;
  return res.status(status).json(body);
}
