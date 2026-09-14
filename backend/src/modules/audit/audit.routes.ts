import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { auditReport } from "../reports/reports.service";

export const auditRouter = Router();

auditRouter.get("/", requireAuth, isAdmin, (req, res) => {
  const rows = auditReport({
    entityType: req.query.entityType as string | undefined,
    userId: req.query.userId as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
  });
  res.json({ rows });
});
