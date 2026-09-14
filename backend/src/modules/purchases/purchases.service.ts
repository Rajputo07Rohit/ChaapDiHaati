import { db } from "../../db/connection";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { nextPurchaseNumber } from "../../utils/sequence";
import { recordAudit } from "../../utils/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors";
import { assertBusinessDateWritable } from "../../utils/businessDate";
import { convertQuantity } from "../../utils/units";
import { getInventoryItemOrThrow, recordMovement } from "../inventory/inventory.service";
import { recordCashTransaction } from "../cash/cash.service";
import { recordBankTransaction } from "../bank/bank.service";
import { getPaymentMethodOrThrow } from "../paymentMethods/paymentMethods.service";
import { Role } from "../../types/express";
import { RecordPurchaseInput } from "./purchases.types";

export interface PurchaseOrderRow {
  id: string;
  purchase_number: string;
  supplier_id: string | null;
  invoice_number: string | null;
  business_date: string;
  payment_method_id: string | null;
  payment_status: string;
  subtotal_paise: number;
  tax_paise: number;
  discount_paise: number;
  total_paise: number;
  amount_paid_paise: number;
  status: string;
  notes: string | null;
}

export function getPurchaseOrThrow(id: string): PurchaseOrderRow {
  const row = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(id) as PurchaseOrderRow | undefined;
  if (!row) throw new NotFoundError("Purchase");
  return row;
}

export function getPurchaseItems(purchaseOrderId: string) {
  return db
    .prepare(
      `SELECT pi.*, ii.name as item_name FROM purchase_items pi
       JOIN inventory_items ii ON ii.id = pi.inventory_item_id
       WHERE pi.purchase_order_id = ?`
    )
    .all(purchaseOrderId);
}

export function listPurchases(filters: { businessDate?: string; supplierId?: string } = {}) {
  let sql = "SELECT * FROM purchase_orders WHERE 1=1";
  const params: unknown[] = [];
  if (filters.businessDate) {
    sql += " AND business_date = ?";
    params.push(filters.businessDate);
  }
  if (filters.supplierId) {
    sql += " AND supplier_id = ?";
    params.push(filters.supplierId);
  }
  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...params) as PurchaseOrderRow[];
}

export function recordPurchase(input: RecordPurchaseInput, userId: string, role: Role): PurchaseOrderRow {
  if (!input.items || input.items.length === 0) throw new ValidationError("A purchase must have at least one item.");
  const businessDate = input.businessDate || todayBusinessDate();
  assertBusinessDateWritable(businessDate, role);

  const lines = input.items.map((item) => {
    const invItem = getInventoryItemOrThrow(item.inventoryItemId);
    if (item.quantity <= 0) throw new ValidationError(`Quantity for ${invItem.name} must be greater than zero.`);
    const quantityInItemUnit = convertQuantity(item.purchaseUnit, invItem.purchase_unit, item.quantity);
    const quantityBase = quantityInItemUnit * invItem.purchase_to_base_factor;
    const pricePending = !!item.pricePending || item.ratePaise == null;
    const amountPaise = pricePending ? null : Math.round((item.ratePaise as number) * item.quantity);

    return {
      inventoryItemId: item.inventoryItemId,
      itemName: invItem.name,
      quantity: item.quantity,
      purchaseUnit: item.purchaseUnit,
      quantityBase,
      ratePaise: pricePending ? null : item.ratePaise ?? null,
      amountPaise,
      pricePending,
      notes: item.notes ?? null,
    };
  });

  const subtotal = lines.reduce((s, l) => s + (l.amountPaise ?? 0), 0);
  const tax = input.taxPaise ?? 0;
  const discount = input.discountPaise ?? 0;
  const total = subtotal + tax - discount;
  if (total < 0) throw new ValidationError("Purchase total cannot be negative.");

  let amountPaid = 0;
  if (input.paymentStatus === "PAID") amountPaid = total;
  else if (input.paymentStatus === "PARTIAL") {
    amountPaid = input.amountPaidPaise ?? 0;
    if (amountPaid <= 0 || amountPaid >= total) {
      throw new ValidationError("Partial payment must be greater than zero and less than the total.");
    }
  }
  if (amountPaid > 0 && !input.paymentMethodId) {
    throw new ValidationError("A payment method is required when any amount is paid.");
  }

  const purchaseId = newId("purchase");
  const purchaseNumber = nextPurchaseNumber();
  const now = nowIso();

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO purchase_orders
        (id, purchase_number, supplier_id, invoice_number, business_date, payment_method_id, payment_status,
         subtotal_paise, tax_paise, discount_paise, total_paise, amount_paid_paise, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      purchaseId,
      purchaseNumber,
      input.supplierId ?? null,
      input.invoiceNumber ?? null,
      businessDate,
      input.paymentMethodId ?? null,
      input.paymentStatus,
      subtotal,
      tax,
      discount,
      total,
      amountPaid,
      input.notes ?? null,
      userId,
      now,
      now
    );

    for (const l of lines) {
      db.prepare(
        `INSERT INTO purchase_items
          (id, purchase_order_id, inventory_item_id, quantity, purchase_unit, quantity_base, rate_paise, amount_paise, price_pending, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId("pline"),
        purchaseId,
        l.inventoryItemId,
        l.quantity,
        l.purchaseUnit,
        l.quantityBase,
        l.ratePaise,
        l.amountPaise,
        l.pricePending ? 1 : 0,
        l.notes
      );

      recordMovement({
        inventoryItemId: l.inventoryItemId,
        movementType: "PURCHASE",
        direction: "IN",
        quantityBase: l.quantityBase,
        unitCostPaisePerBase: l.amountPaise != null ? l.amountPaise / l.quantityBase : null,
        referenceType: "PURCHASE",
        referenceId: purchaseId,
        businessDate,
        userId,
      });
    }

    if (amountPaid > 0 && input.paymentMethodId) {
      const method = getPaymentMethodOrThrow(input.paymentMethodId);
      if (method.type === "CASH") {
        recordCashTransaction({
          businessDate,
          txnType: "PURCHASE",
          direction: "OUT",
          amountPaise: amountPaid,
          referenceType: "PURCHASE",
          referenceId: purchaseId,
          userId,
        });
      } else {
        recordBankTransaction({
          businessDate,
          txnType: "DEBIT",
          amountPaise: amountPaid,
          description: `Purchase ${purchaseNumber}${input.invoiceNumber ? ` (Inv ${input.invoiceNumber})` : ""}`,
          category: "SUPPLIER",
          paymentMethodId: input.paymentMethodId,
          userId,
        });
      }
    }

    recordAudit({
      userId,
      action: "PURCHASE_RECORDED",
      entityType: "purchase_order",
      entityId: purchaseId,
      newValue: { purchaseNumber, total, itemCount: lines.length, pricePendingItems: lines.filter((l) => l.pricePending).length },
    });
  });
  txn();

  return getPurchaseOrThrow(purchaseId);
}

export function voidPurchase(purchaseId: string, reason: string, userId: string): PurchaseOrderRow {
  if (!reason) throw new ValidationError("A reason is required to void a purchase.");
  const purchase = getPurchaseOrThrow(purchaseId);
  if (purchase.status === "VOID") throw new ConflictError("Purchase is already void.");

  const items = getPurchaseItems(purchaseId) as { inventory_item_id: string; quantity_base: number }[];
  const now = nowIso();

  const txn = db.transaction(() => {
    for (const item of items) {
      recordMovement({
        inventoryItemId: item.inventory_item_id,
        movementType: "RETURN",
        direction: "OUT",
        quantityBase: item.quantity_base,
        referenceType: "PURCHASE_VOID",
        referenceId: purchaseId,
        businessDate: todayBusinessDate(),
        userId,
        allowNegativeStock: true,
        reason: `Purchase ${purchase.purchase_number} voided: ${reason}`,
      });
    }

    if (purchase.amount_paid_paise > 0 && purchase.payment_method_id) {
      const method = getPaymentMethodOrThrow(purchase.payment_method_id);
      if (method.type === "CASH") {
        recordCashTransaction({
          businessDate: todayBusinessDate(),
          txnType: "ADJUSTMENT",
          direction: "IN",
          amountPaise: purchase.amount_paid_paise,
          referenceType: "PURCHASE_VOID",
          referenceId: purchaseId,
          reason: `Refund from supplier — purchase ${purchase.purchase_number} voided`,
          userId,
        });
      } else {
        recordBankTransaction({
          businessDate: todayBusinessDate(),
          txnType: "CREDIT",
          amountPaise: purchase.amount_paid_paise,
          description: `Refund — purchase ${purchase.purchase_number} voided`,
          category: "SUPPLIER",
          paymentMethodId: purchase.payment_method_id,
          userId,
        });
      }
    }

    db.prepare("UPDATE purchase_orders SET status = 'VOID', void_reason = ?, updated_at = ? WHERE id = ?").run(
      reason,
      now,
      purchaseId
    );

    recordAudit({
      userId,
      action: "PURCHASE_VOIDED",
      entityType: "purchase_order",
      entityId: purchaseId,
      reason,
    });
  });
  txn();

  return getPurchaseOrThrow(purchaseId);
}
