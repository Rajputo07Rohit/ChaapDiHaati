import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as customerMenuService from "./customerMenu.service";

export const customerMenuRouter = Router();

customerMenuRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ categories: await customerMenuService.listPublicMenu() });
  })
);
