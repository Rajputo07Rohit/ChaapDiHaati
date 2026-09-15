import { Schema, model } from "mongoose";

export interface DailyClosingDoc {
  _id: string;
  businessDate: string;
  status: "OPEN" | "CLOSED";
  openingCashPaise: number;
  grossSalesPaise: number | null;
  discountsPaise: number | null;
  netSalesPaise: number | null;
  cogsPaise: number | null;
  grossProfitPaise: number | null;
  expensesPaise: number | null;
  netProfitPaise: number | null;
  expectedCashPaise: number | null;
  actualCashPaise: number | null;
  cashDifferencePaise: number | null;
  cashDiffReason: string | null;
  bankBalancePaise: number | null;
  stockValuePaise: number | null;
  openedBy: string | null;
  closedBy: string | null;
  reopenedBy: string | null;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const schema = new Schema<DailyClosingDoc>({
  _id: { type: String },
  businessDate: { type: String, required: true, unique: true },
  status: { type: String, required: true, enum: ["OPEN", "CLOSED"], default: "OPEN" },
  openingCashPaise: { type: Number, required: true, default: 0 },
  grossSalesPaise: { type: Number, default: null },
  discountsPaise: { type: Number, default: null },
  netSalesPaise: { type: Number, default: null },
  cogsPaise: { type: Number, default: null },
  grossProfitPaise: { type: Number, default: null },
  expensesPaise: { type: Number, default: null },
  netProfitPaise: { type: Number, default: null },
  expectedCashPaise: { type: Number, default: null },
  actualCashPaise: { type: Number, default: null },
  cashDifferencePaise: { type: Number, default: null },
  cashDiffReason: { type: String, default: null },
  bankBalancePaise: { type: Number, default: null },
  stockValuePaise: { type: Number, default: null },
  openedBy: { type: String, default: null, ref: "User" },
  closedBy: { type: String, default: null, ref: "User" },
  reopenedBy: { type: String, default: null, ref: "User" },
  closedAt: { type: String, default: null },
  reopenedAt: { type: String, default: null },
  reopenReason: { type: String, default: null },
  notes: { type: String, default: null },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});
schema.index({ status: 1 });

export const DailyClosing = model<DailyClosingDoc>("DailyClosing", schema);
