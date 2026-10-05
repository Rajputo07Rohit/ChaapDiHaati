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
        isSuperAdmin: boolean;
      };
      sessionId?: string;
      /** Set by requireCustomerAuth for the customer-facing /api/public/* routes — entirely separate from `user` (staff). */
      customer?: {
        phone: string;
      };
    }
  }
}
