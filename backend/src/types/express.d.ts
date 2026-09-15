import "express";

export type Role = "ADMIN" | "MANAGER" | "STAFF" | "RIDER";

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
