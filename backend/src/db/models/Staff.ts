import { Schema, model } from "mongoose";

export interface StaffDoc {
  _id: string;
  userId: string | null;
  fullName: string;
  roleTitle: string;
  salaryPaise: number;
  salaryMethod: "CALENDAR_DAY" | "FIXED_30" | "WORKING_26" | "CUSTOM";
  customDays: number | null;
  joiningDate: string;
  active: boolean;
  phone: string | null;
  createdAt: string;
}

const schema = new Schema<StaffDoc>({
  _id: { type: String },
  userId: { type: String, default: null, ref: "User" },
  fullName: { type: String, required: true },
  roleTitle: { type: String, required: true },
  salaryPaise: { type: Number, required: true, min: 0 },
  salaryMethod: { type: String, required: true, enum: ["CALENDAR_DAY", "FIXED_30", "WORKING_26", "CUSTOM"], default: "FIXED_30" },
  customDays: { type: Number, default: null },
  joiningDate: { type: String, required: true },
  active: { type: Boolean, required: true, default: true },
  phone: { type: String, default: null },
  createdAt: { type: String, required: true },
});

export const Staff = model<StaffDoc>("Staff", schema);
