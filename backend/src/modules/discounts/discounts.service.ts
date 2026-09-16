import { DiscountRule, DiscountRuleDoc } from "../../db/models";
import { DiscountType } from "../../db/models/Order";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { NotFoundError } from "../../utils/errors";

export interface DiscountRuleRow {
  id: string;
  name: string;
  menuItemIds: string[];
  categoryIds: string[];
  discountType: DiscountType;
  discountValue: number;
  active: boolean;
  createdAt: string;
}

function toRow(doc: DiscountRuleDoc): DiscountRuleRow {
  return {
    id: doc._id,
    name: doc.name,
    menuItemIds: doc.menuItemIds,
    categoryIds: doc.categoryIds,
    discountType: doc.discountType,
    discountValue: doc.discountValue,
    active: doc.active,
    createdAt: doc.createdAt,
  };
}

export interface CreateDiscountRuleInput {
  name: string;
  menuItemIds: string[];
  categoryIds: string[];
  discountType: DiscountType;
  discountValue: number;
}

export async function listDiscountRules(activeOnly: boolean): Promise<DiscountRuleRow[]> {
  const docs = await DiscountRule.find(activeOnly ? { active: true } : {}).sort({ createdAt: -1 });
  return docs.map(toRow);
}

export async function getDiscountRuleOrThrow(id: string): Promise<DiscountRuleRow> {
  const rule = await DiscountRule.findById(id);
  if (!rule) throw new NotFoundError("Discount rule");
  return toRow(rule);
}

export async function createDiscountRule(input: CreateDiscountRuleInput, userId: string): Promise<DiscountRuleRow> {
  const id = newId("disc");
  await DiscountRule.create({
    _id: id,
    name: input.name,
    menuItemIds: input.menuItemIds,
    categoryIds: input.categoryIds,
    discountType: input.discountType,
    discountValue: input.discountValue,
    active: true,
    createdBy: userId,
    createdAt: nowIso(),
  });
  const rule = await getDiscountRuleOrThrow(id);
  await recordAudit({ userId, action: "DISCOUNT_RULE_CREATED", entityType: "discount_rule", entityId: id, newValue: input });
  return rule;
}

export interface UpdateDiscountRuleInput {
  name?: string;
  menuItemIds?: string[];
  categoryIds?: string[];
  discountType?: DiscountType;
  discountValue?: number;
  active?: boolean;
}

export async function updateDiscountRule(id: string, input: UpdateDiscountRuleInput, userId: string): Promise<DiscountRuleRow> {
  const existing = await DiscountRule.findById(id);
  if (!existing) throw new NotFoundError("Discount rule");
  const before = toRow(existing);

  if (input.name !== undefined) existing.name = input.name;
  if (input.menuItemIds !== undefined) existing.menuItemIds = input.menuItemIds;
  if (input.categoryIds !== undefined) existing.categoryIds = input.categoryIds;
  if (input.discountType !== undefined) existing.discountType = input.discountType;
  if (input.discountValue !== undefined) existing.discountValue = input.discountValue;
  if (input.active !== undefined) existing.active = input.active;
  await existing.save();

  await recordAudit({ userId, action: "DISCOUNT_RULE_UPDATED", entityType: "discount_rule", entityId: id, oldValue: before, newValue: input });
  return toRow(existing);
}

export async function deleteDiscountRule(id: string, userId: string): Promise<void> {
  const existing = await getDiscountRuleOrThrow(id);
  await DiscountRule.deleteOne({ _id: id });
  await recordAudit({ userId, action: "DISCOUNT_RULE_DELETED", entityType: "discount_rule", entityId: id, oldValue: existing });
}
