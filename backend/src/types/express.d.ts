import "express";

export type Role = "ADMIN" | "MANAGER" | "STAFF";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        fullName: string;
        role: Role;
      };
    }
  }
}
