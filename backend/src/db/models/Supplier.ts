import { Schema, model } from "mongoose";

export interface SupplierDoc {
  _id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

const schema = new Schema<SupplierDoc>({
  _id: { type: String },
  name: { type: String, required: true },
  phone: { type: String, default: null },
  address: { type: String, default: null },
  notes: { type: String, default: null },
  active: { type: Boolean, required: true, default: true },
  createdAt: { type: String, required: true },
});

export const Supplier = model<SupplierDoc>("Supplier", schema);
