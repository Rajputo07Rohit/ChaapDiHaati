import { PaymentMethod, PaymentMethodDoc } from "../../db/models";
import { newId } from "../../utils/ids";
import { ConflictError, NotFoundError } from "../../utils/errors";

function toRow(doc: PaymentMethodDoc) {
  return { id: doc._id, name: doc.name, type: doc.type, active: doc.active, sort_order: doc.sortOrder };
}

export async function listPaymentMethods(activeOnly = true) {
  const filter = activeOnly ? { active: true } : {};
  const docs = await PaymentMethod.find(filter).sort({ sortOrder: 1 });
  return docs.map(toRow);
}

export async function getPaymentMethodOrThrow(id: string): Promise<{ id: string; name: string; type: "CASH" | "ONLINE"; active: boolean; sort_order: number }> {
  const doc = await PaymentMethod.findById(id);
  if (!doc) throw new NotFoundError("Payment method");
  return toRow(doc);
}

export async function createPaymentMethod(input: { name: string; type: "CASH" | "ONLINE"; sortOrder: number }) {
  // `name` has a unique index, so a plain insert would throw a raw
  // duplicate-key error (surfacing as an opaque 500) if a method with this
  // name already exists — including one that's merely disabled, which is
  // the common case: someone disabled "UPI" earlier, then tried to "add"
  // it back instead of re-enabling it. Reactivate that record instead of
  // failing; only a genuinely still-active duplicate is a real conflict.
  const existing = await PaymentMethod.findOne({ name: input.name });
  if (existing) {
    if (existing.active) {
      throw new ConflictError(`"${input.name}" already exists and is active.`);
    }
    existing.active = true;
    existing.type = input.type;
    existing.sortOrder = input.sortOrder;
    await existing.save();
    return toRow(existing);
  }

  const id = newId("pm");
  await PaymentMethod.create({ _id: id, name: input.name, type: input.type, active: true, sortOrder: input.sortOrder });
  return toRow((await PaymentMethod.findById(id))!);
}

export async function updatePaymentMethod(id: string, changes: { active?: boolean; name?: string; sortOrder?: number }) {
  const doc = await PaymentMethod.findById(id);
  if (!doc) throw new NotFoundError("Payment method");
  if (changes.active !== undefined) doc.active = changes.active;
  if (changes.name !== undefined) doc.name = changes.name;
  if (changes.sortOrder !== undefined) doc.sortOrder = changes.sortOrder;
  await doc.save();
  return toRow(doc);
}
