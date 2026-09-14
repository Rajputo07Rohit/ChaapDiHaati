export class AppError extends Error {
  status: number;
  publicMessage: string;
  code: string;

  constructor(status: number, publicMessage: string, code = "APP_ERROR", debugMessage?: string) {
    super(debugMessage || publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, debugMessage?: string) {
    super(400, message, "VALIDATION_ERROR", debugMessage);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(404, `${entity} not found.`, "NOT_FOUND");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(403, message, "FORBIDDEN");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please log in to continue.") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, "CONFLICT");
  }
}
