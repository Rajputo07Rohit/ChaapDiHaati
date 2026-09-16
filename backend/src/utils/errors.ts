export class AppError extends Error {
  status: number;
  publicMessage: string;
  code: string;
  details?: unknown;

  constructor(status: number, publicMessage: string, code = "APP_ERROR", debugMessage?: string, details?: unknown) {
    super(debugMessage || publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = code;
    this.details = details;
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

/**
 * Thrown when completing/delivering a sale hits a recipe that points at an
 * inventory item which no longer exists (data-integrity problem, not an
 * out-of-stock situation — those already go through as warnings). Rather
 * than just failing, this carries the affected line names so the POS can
 * ask "create the order anyway?" and retry with bypassMissingInventory.
 */
export class InventoryMissingError extends AppError {
  constructor(missingItems: string[]) {
    super(
      409,
      `Some ingredients' inventory records are missing: ${missingItems.join(", ")}. You can still complete this order, but those ingredients won't be deducted from stock.`,
      "INVENTORY_ITEMS_MISSING",
      undefined,
      { missingItems }
    );
  }
}
