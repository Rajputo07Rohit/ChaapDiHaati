import { db } from "../../db/connection";
import { NotFoundError } from "../../utils/errors";

export interface PaymentMethodRow {
  id: string;
  name: string;
  type: "CASH" | "ONLINE";
  active: number;
  sort_order: number;
}

export function listPaymentMethods(activeOnly = true): PaymentMethodRow[] {
  const sql = activeOnly
    ? "SELECT * FROM payment_methods WHERE active = 1 ORDER BY sort_order ASC"
    : "SELECT * FROM payment_methods ORDER BY sort_order ASC";
  return db.prepare(sql).all() as PaymentMethodRow[];
}

export function getPaymentMethodOrThrow(id: string): PaymentMethodRow {
  const row = db.prepare("SELECT * FROM payment_methods WHERE id = ?").get(id) as PaymentMethodRow | undefined;
  if (!row) throw new NotFoundError("Payment method");
  return row;
}
