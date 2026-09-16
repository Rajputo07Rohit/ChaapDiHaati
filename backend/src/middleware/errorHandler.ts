import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: err.errors[0]?.message || "Invalid input.",
        code: "VALIDATION_ERROR",
        details: err.errors,
      },
    });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);
    }
    return res.status(err.status).json({ error: { message: err.publicMessage, code: err.code, details: err.details } });
  }

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);
  return res.status(500).json({
    error: { message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" },
  });
}
