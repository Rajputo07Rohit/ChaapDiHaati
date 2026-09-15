import { InventoryItem, Purchase, PurchaseDoc, PurchaseItemSub } from "../../db/models";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { nextPurchaseNumber } from "../../utils/sequence";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
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
  void_reason: string | null;
  notes: string | null;
}

function toRow(doc: PurchaseDoc): PurchaseOrderRow {
  return {
    id: doc._id,
    purchase_number: doc.purchaseNumber,
    supplier_id: doc.supplierId,
    invoice_number: doc.invoiceNumber,
    business_date: doc.businessDate,
    payment_method_id: doc.paymentMethodId,
    payment_status: doc.paymentStatus,
    subtotal_paise: doc.subtotalPaise,
    tax_paise: doc.taxPaise,
    discount_paise: doc.discountPaise,
    total_paise: doc.totalPaise,
    amount_paid_paise: doc.amountPaidPaise,
    status: doc.status,
    void_reason: doc.voidReason,
    notes: doc.notes,
  };
}

function toItemRow(item: PurchaseItemSub, itemName: string) {
  return {
    id: item._id,
    inventory_item_id: item.inventoryItemId,
    item_name: itemName,
    quantity: item.quantity,
    purchase_unit: item.purchaseUnit,
    quantity_base: item.quantityBase,
    rate_paise: item.ratePaise,
    amount_paise: item.amountPaise,
    price_pending: item.pricePending ? 1 : 0,
    notes: item.notes,
  };
}

export async function getPurchaseOrThrow(id: string): Promise<PurchaseOrderRow> {
  const doc = await Purchase.findById(id);
  if (!doc) throw new NotFoundError("Purchase");
  return toRow(doc);
}

export async function getPurchaseItems(purchaseOrderId: string) {
  const doc = await Purchase.findById(purchaseOrderId);
  if (!doc) return [];
  const items = await InventoryItem.find({ _id: { $in: doc.purchaseItems.map((i) => i.inventoryItemId) } });
  const byId = new Map(items.map((i) => [i._id, i.name]));
  return doc.purchaseItems.map((i) => toItemRow(i, byId.get(i.inventoryItemId) ?? ""));
}

export async function listPurchases(filters: { businessDate?: string; supplierId?: string } = {}): Promise<PurchaseOrderRow[]> {
  const query: Record<string, unknown> = {};
  if (filters.businessDate) query.businessDate = filters.businessDate;
  if (filters.supplierId) query.supplierId = filters.supplierId;
  const docs = await Purchase.find(query).sort({ createdAt: -1 });
  return docs.map(toRow);
}

export async function recordPurchase(input: RecordPurchaseInput, userId: string, role: Role): Promise<PurchaseOrderRow> {
  if (!input.items || input.items.length === 0) throw new ValidationError("A purchase must have at least one item.");
  const businessDate = input.businessDate || todayBusinessDate();
  await assertBusinessDateWritable(businessDate, role);

  const lines = await Promise.all(
    input.items.map(async (item) => {
      const invItem = await getInventoryItemOrThrow(item.inventoryItemId);
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
    })
  );

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
  const now = nowIso();

  await withTransaction(async (session) => {
    const purchaseNumber = await nextPurchaseNumber(session);

    const purchaseItems: PurchaseItemSub[] = lines.map(
      (l) =>
        ({
          _id: newId("pline"),
          inventoryItemId: l.inventoryItemId,
          quantity: l.quantity,
          purchaseUnit: l.purchaseUnit,
          quantityBase: l.quantityBase,
          ratePaise: l.ratePaise,
          amountPaise: l.amountPaise,
          pricePending: l.pricePending,
          notes: l.notes,
        }) as PurchaseItemSub
    );

    await Purchase.create(
      [
        {
          _id: purchaseId,
          purchaseNumber,
          supplierId: input.supplierId ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          businessDate,
          paymentMethodId: input.paymentMethodId ?? null,
          paymentStatus: input.paymentStatus,
          subtotalPaise: subtotal,
          taxPaise: tax,
          discountPaise: discount,
          totalPaise: total,
          amountPaidPaise: amountPaid,
          notes: input.notes ?? null,
          status: "RECORDED",
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
          purchaseItems,
        },
      ],
      { session }
    );

    for (const l of lines) {
      await recordMovement(
        {
          inventoryItemId: l.inventoryItemId,
          movementType: "PURCHASE",
          direction: "IN",
          quantityBase: l.quantityBase,
          unitCostPaisePerBase: l.amountPaise != null ? l.amountPaise / l.quantityBase : null,
          referenceType: "PURCHASE",
          referenceId: purchaseId,
          businessDate,
          userId,
        },
        session
      );
    }

    if (amountPaid > 0 && input.paymentMethodId) {
      const method = await getPaymentMethodOrThrow(input.paymentMethodId);
      if (method.type === "CASH") {
        await recordCashTransaction(
          { businessDate, txnType: "PURCHASE", direction: "OUT", amountPaise: amountPaid, referenceType: "PURCHASE", referenceId: purchaseId, userId },
          session
        );
      } else {
        await recordBankTransaction(
          {
            businessDate,
            txnType: "DEBIT",
            amountPaise: amountPaid,
            description: `Purchase ${purchaseNumber}${input.invoiceNumber ? ` (Inv ${input.invoiceNumber})` : ""}`,
            category: "SUPPLIER",
            paymentMethodId: input.paymentMethodId,
            userId,
          },
          session
        );
      }
    }

    await recordAudit(
      {
        userId,
        action: "PURCHASE_RECORDED",
        entityType: "purchase_order",
        entityId: purchaseId,
        newValue: { purchaseNumber, total, itemCount: lines.length, pricePendingItems: lines.filter((l) => l.pricePending).length },
      },
      session
    );
  });

  return getPurchaseOrThrow(purchaseId);
}

export async function voidPurchase(purchaseId: string, reason: string, userId: string): Promise<PurchaseOrderRow> {
  if (!reason) throw new ValidationError("A reason is required to void a purchase.");
  const purchase = await Purchase.findById(purchaseId);
  if (!purchase) throw new NotFoundError("Purchase");
  if (purchase.status === "VOID") throw new ConflictError("Purchase is already void.");

  const now = nowIso();

  await withTransaction(async (session) => {
    for (const item of purchase.purchaseItems) {
      await recordMovement(
        {
          inventoryItemId: item.inventoryItemId,
          movementType: "RETURN",
          direction: "OUT",
          quantityBase: item.quantityBase,
          referenceType: "PURCHASE_VOID",
          referenceId: purchaseId,
          businessDate: todayBusinessDate(),
          userId,
          allowNegativeStock: true,
          reason: `Purchase ${purchase.purchaseNumber} voided: ${reason}`,
        },
        session
      );
    }

    if (purchase.amountPaidPaise > 0 && purchase.paymentMethodId) {
      const method = await getPaymentMethodOrThrow(purchase.paymentMethodId);
      if (method.type === "CASH") {
        await recordCashTransaction(
          {
            businessDate: todayBusinessDate(),
            txnType: "ADJUSTMENT",
            direction: "IN",
            amountPaise: purchase.amountPaidPaise,
            referenceType: "PURCHASE_VOID",
            referenceId: purchaseId,
            reason: `Refund from supplier — purchase ${purchase.purchaseNumber} voided`,
            userId,
          },
          session
        );
      } else {
        await recordBankTransaction(
          {
            businessDate: todayBusinessDate(),
            txnType: "CREDIT",
            amountPaise: purchase.amountPaidPaise,
            description: `Refund — purchase ${purchase.purchaseNumber} voided`,
            category: "SUPPLIER",
            paymentMethodId: purchase.paymentMethodId,
            userId,
          },
          session
        );
      }
    }

    await Purchase.updateOne({ _id: purchaseId }, { status: "VOID", voidReason: reason, updatedAt: now }, { session });

    await recordAudit({ userId, action: "PURCHASE_VOIDED", entityType: "purchase_order", entityId: purchaseId, reason }, session);
  });

  return getPurchaseOrThrow(purchaseId);
}
