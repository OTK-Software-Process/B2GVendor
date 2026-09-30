export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_LOCKED'
  | 'NOT_AUTHENTICATED'
  | 'FORBIDDEN'
  | 'TOKEN_INVALID'
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'DUPLICATE_TAG'
  | 'NEAR_DUPLICATE_TAG'
  | 'INTERNAL_ERROR';

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: FieldErrors;
  // Structured, machine-readable context for the client (e.g. which existing
  // tags a new tag collides with) -- not for field-level validation, use `fields`.
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, fields?: FieldErrors, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static validation(fields: FieldErrors, message = 'Please check the highlighted fields.'): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, fields);
  }

  static emailAlreadyRegistered(): AppError {
    return new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This email is already in use.', {
      email: 'Already registered'
    });
  }

  static invalidCredentials(): AppError {
    return new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  static accountSuspended(): AppError {
    return new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended.');
  }

  static notAuthenticated(): AppError {
    return new AppError(401, 'NOT_AUTHENTICATED', 'You are not signed in.');
  }

  static forbidden(message = 'You do not have permission to do that.'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static tokenInvalid(): AppError {
    return new AppError(400, 'TOKEN_INVALID', 'This link has expired or has already been used.');
  }

  static rateLimited(message = 'Too many requests. Please try again later.'): AppError {
    return new AppError(429, 'RATE_LIMITED', message);
  }

  static notFound(message = 'Not found.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static badRequest(message = 'Bad request.'): AppError {
    return new AppError(400, 'BAD_REQUEST', message);
  }

  static internalError(message = 'An unexpected error occurred.'): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}
