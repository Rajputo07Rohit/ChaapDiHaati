import { PaymentMethod, PaymentMethodDoc } from "../../db/models";
import { newId } from "../../utils/ids";
import { NotFoundError } from "../../utils/errors";

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
