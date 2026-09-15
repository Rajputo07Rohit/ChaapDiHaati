import { Supplier, SupplierDoc } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";

function toRow(doc: SupplierDoc) {
  return { id: doc._id, name: doc.name, phone: doc.phone, address: doc.address, notes: doc.notes, active: doc.active, created_at: doc.createdAt };
}

export async function listSuppliers() {
  const docs = await Supplier.find({ active: true }).sort({ name: 1 });
  return docs.map(toRow);
}

export async function createSupplier(input: { name: string; phone?: string; address?: string; notes?: string }) {
  const id = newId("sup");
  await Supplier.create({
    _id: id,
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    active: true,
    createdAt: nowIso(),
  });
  return toRow((await Supplier.findById(id))!);
}
