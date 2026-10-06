import { Order, PromoCode, PromoCodeDoc } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { NotFoundError, ValidationError } from "../../utils/errors";

export interface PromoCodeRow {
  id: string;
  code: string;
  description: string;
  discount_type: "FLAT" | "PERCENTAGE";
  discount_value: number;
  min_order_paise: number;
  usage_limit: number | null;
  used_count: number;
  per_customer_limit: number | null;
  active: boolean;
  expires_at: string | null;
}

function toRow(doc: PromoCodeDoc): PromoCodeRow {
  return {
    id: doc._id,
    code: doc.code,
    description: doc.description,
    discount_type: doc.discountType,
    discount_value: doc.discountValue,
    min_order_paise: doc.minOrderPaise,
    usage_limit: doc.usageLimit,
    used_count: doc.usedCount,
    per_customer_limit: doc.perCustomerLimit,
    active: doc.active,
    expires_at: doc.expiresAt,
  };
}

export async function createPromoCode(input: {
  code: string;
  description: string;
  discountType: "FLAT" | "PERCENTAGE";
  discountValue: number;
  minOrderPaise?: number;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  expiresAt?: string | null;
  userId: string;
}): Promise<PromoCodeRow> {
  const code = input.code.trim().toUpperCase();
  if (!code) throw new ValidationError("A code is required.");
  if (input.discountType === "PERCENTAGE" && (input.discountValue <= 0 || input.discountValue > 100)) {
    throw new ValidationError("Percentage discount must be between 1 and 100.");
  }
  if (input.discountType === "FLAT" && input.discountValue <= 0) {
    throw new ValidationError("Flat discount must be greater than zero.");
  }
  const existing = await PromoCode.findOne({ code });
  if (existing) throw new ValidationError(`Code "${code}" already exists.`);

  const id = newId("promo");
  await PromoCode.create({
    _id: id,
    code,
    description: input.description.trim(),
    discountType: input.discountType,
    discountValue: input.discountValue,
    minOrderPaise: input.minOrderPaise ?? 0,
    usageLimit: input.usageLimit ?? null,
    usedCount: 0,
    perCustomerLimit: input.perCustomerLimit ?? null,
    active: true,
    expiresAt: input.expiresAt ?? null,
    createdBy: input.userId,
    createdAt: nowIso(),
  });
  return toRow((await PromoCode.findById(id))!);
}

export async function listPromoCodes(): Promise<PromoCodeRow[]> {
  const docs = await PromoCode.find().sort({ createdAt: -1 });
  return docs.map(toRow);
}

export async function setPromoCodeActive(id: string, active: boolean): Promise<PromoCodeRow> {
  const doc = await PromoCode.findById(id);
  if (!doc) throw new NotFoundError("Promo code");
  doc.active = active;
  await doc.save();
  return toRow(doc);
}

/** Active, non-expired codes — for the customer app's offers banner. No usage counts or ids exposed beyond what's needed to display and apply a code. */
export async function listActivePromoCodesForCustomer(): Promise<{ code: string; description: string; discount_type: "FLAT" | "PERCENTAGE"; discount_value: number; min_order_paise: number }[]> {
  const now = nowIso();
  const docs = await PromoCode.find({
    active: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).sort({ createdAt: -1 });
  return docs
    .filter((d) => d.usageLimit == null || d.usedCount < d.usageLimit)
    .map((d) => ({
      code: d.code,
      description: d.description,
      discount_type: d.discountType,
      discount_value: d.discountValue,
      min_order_paise: d.minOrderPaise,
    }));
}

/**
 * Validates a customer-entered code against a specific order's subtotal and
 * phone, throwing a friendly ValidationError for any reason it can't be
 * applied. Returns the live PromoCode doc — the caller (createCustomerOrder)
 * is responsible for actually incrementing usedCount once the order is
 * committed, inside the same transaction, so a crashed order never burns a
 * redemption.
 */
export async function validatePromoCodeForOrder(rawCode: string, phone: string, subtotalPaise: number): Promise<PromoCodeDoc> {
  const code = rawCode.trim().toUpperCase();
  const promo = await PromoCode.findOne({ code });
  if (!promo || !promo.active) throw new ValidationError("That promo code isn't valid.");
  if (promo.expiresAt && promo.expiresAt <= nowIso()) throw new ValidationError("That promo code has expired.");
  if (subtotalPaise < promo.minOrderPaise) {
    throw new ValidationError(`Add ₹${(promo.minOrderPaise / 100).toFixed(0)} more to use this code.`);
  }
  if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
    throw new ValidationError("That promo code has reached its usage limit.");
  }
  if (promo.perCustomerLimit != null) {
    const usedByCustomer = await Order.countDocuments({
      promoCode: promo.code,
      customerPhone: phone,
      status: { $nin: ["CANCELLED", "REFUNDED"] },
    });
    if (usedByCustomer >= promo.perCustomerLimit) {
      throw new ValidationError("You've already used this promo code.");
    }
  }
  return promo;
}
