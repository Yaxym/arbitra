// Кастомные классы ошибок

export class ApiError extends Error {
  public statusCode: number;
  public code: string;
  
  constructor(message: string, statusCode: number = 500, code: string = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, ApiError);
  }
}

export class ExchangeError extends ApiError {
  public exchange: string;
  
  constructor(exchange: string, message: string) {
    super(`[${exchange}] ${message}`, 502, 'EXCHANGE_ERROR');
    this.name = 'ExchangeError';
    this.exchange = exchange;
  }
}

export class RateLimitError extends ApiError {
  public retryAfter: number;
  
  constructor(message: string, retryAfter: number = 60) {
    super(message, 429, 'RATE_LIMIT');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class ValidationError extends ApiError {
  public field?: string;
  
  constructor(message: string, field?: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class DatabaseError extends ApiError {
  constructor(message: string) {
    super(message, 500, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}
