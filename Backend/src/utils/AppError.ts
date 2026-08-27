export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_LOCKED'
  | 'NOT_AUTHENTICATED'
  | 'FORBIDDEN'
  | 'TOKEN_INVALID'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: FieldErrors;

  constructor(status: number, code: ErrorCode, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
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
}
