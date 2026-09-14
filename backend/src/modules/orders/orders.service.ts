import { db } from "../../db/connection";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { nextSequence } from "../../utils/sequence";
import { recordAudit } from "../../utils/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import { assertBusinessDateWritable } from "../../utils/businessDate";
import { getCurrentPrice, getMenuItemOrThrow } from "../menu/menu.service";
import { getEffectiveRecipeVersion, getRecipeItems } from "../recipes/recipe.service";
import { recordMovement } from "../inventory/inventory.service";
import { recordCashTransaction } from "../cash/cash.service";
import { recordBankTransaction } from "../bank/bank.service";
import { getPaymentMethodOrThrow } from "../paymentMethods/paymentMethods.service";
import { Role } from "../../types/express";
import { CompleteOrderInput, CreateOrderInput, DiscountType, OrderItemInput, OrderStatus } from "./orders.types";

const EDITABLE_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "PREPARING", "READY"];
const COMPLETABLE_STATUSES: OrderStatus[] = ["CONFIRMED", "PREPARING", "READY"];
const CANCELLABLE_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "PREPARING", "READY"];

export interface OrderRow {
  id: string;
  order_number: number;
  business_date: string;
  order_type: string;
  status: OrderStatus;
  kitchen_status: string;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal_paise: number;
  discount_paise: number;
  discount_type: DiscountType;
  discount_value: number;
  item_discount_total_paise: number;
  discount_reason: string | null;
  net_total_paise: number;
  cancel_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function getOrderOrThrow(id: string): OrderRow {
  const row = db.prepare("SELECT * FROM sales_orders WHERE id = ?").get(id) as OrderRow | undefined;
  if (!row) throw new NotFoundError("Order");
  return row;
}

export function getOrderItems(orderId: string) {
  return db.prepare("SELECT * FROM sales_order_items WHERE sales_order_id = ?").all(orderId);
}

export function getOrderPayments(orderId: string) {
  return db
    .prepare(
      `SELECT p.*, pm.name as payment_method_name, pm.type as payment_method_type
       FROM payments p JOIN payment_methods pm ON pm.id = p.payment_method_id
       WHERE p.sales_order_id = ? AND p.status = 'ACTIVE'`
    )
    .all(orderId);
}

export function getOrderFull(id: string) {
  const order = getOrderOrThrow(id);
  return { ...order, items: getOrderItems(id), payments: getOrderPayments(id) };
}

export function listOrders(filters: { status?: string; businessDate?: string; limit?: number } = {}) {
  let sql = "SELECT * FROM sales_orders WHERE 1=1";
  const params: unknown[] = [];
  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters.businessDate) {
    sql += " AND business_date = ?";
    params.push(filters.businessDate);
  }
  sql += " ORDER BY created_at DESC";
  if (filters.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }
  return db.prepare(sql).all(...params) as OrderRow[];
}

interface ResolvedOrderItem {
  menuItemId: string;
  itemName: string;
  priceType: "HALF" | "FULL" | "SINGLE";
  unitPricePaise: number;
  quantity: number;
  specialInstructions: string | null;
  discountType: DiscountType;
  discountValue: number;
  lineSubtotalPaise: number;
  itemDiscountPaise: number;
  lineNetPaise: number;
}

/** Resolves a FLAT (paise) or PERCENTAGE (0-100) discount against a base amount, with validation. */
function resolveDiscountAmount(basePaise: number, discountType: DiscountType, discountValue: number, subject: string): number {
  if (discountValue < 0) throw new ValidationError(`Discount for ${subject} cannot be negative.`);
  let amount: number;
  if (discountType === "PERCENTAGE") {
    if (discountValue > 100) throw new ValidationError(`Discount percentage for ${subject} cannot exceed 100%.`);
    amount = Math.round((basePaise * discountValue) / 100);
  } else {
    amount = Math.round(discountValue);
  }
  if (amount > basePaise) {
    throw new ValidationError(`Discount for ${subject} cannot be greater than its subtotal.`);
  }
  return amount;
}

function resolveOrderItems(items: OrderItemInput[]): ResolvedOrderItem[] {
  return items.map((item) => {
    const menuItem = getMenuItemOrThrow(item.menuItemId);
    if (menuItem.status !== "ACTIVE") {
      throw new ValidationError(`${menuItem.name} is not currently available.`);
    }
    if (item.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
    const price = getCurrentPrice(item.menuItemId, item.priceType);
    if (price == null) {
      throw new ValidationError(`${menuItem.name} has no price configured for ${item.priceType}.`);
    }

    const lineSubtotalPaise = price * item.quantity;
    const discountType = item.discountType ?? "FLAT";
    const discountValue = item.discountValue ?? 0;
    const itemDiscountPaise = discountValue > 0 ? resolveDiscountAmount(lineSubtotalPaise, discountType, discountValue, menuItem.name) : 0;

    return {
      menuItemId: item.menuItemId,
      itemName: menuItem.name,
      priceType: item.priceType,
      unitPricePaise: price,
      quantity: item.quantity,
      specialInstructions: item.specialInstructions ?? null,
      discountType,
      discountValue,
      lineSubtotalPaise,
      itemDiscountPaise,
      lineNetPaise: lineSubtotalPaise - itemDiscountPaise,
    };
  });
}

/**
 * Order-level discount is applied on top of (subtotal - sum of item-level
 * discounts) — i.e. item discounts are taken first, then the overall
 * discount applies to whatever remains.
 */
function computeOrderTotals(resolvedItems: ResolvedOrderItem[], orderDiscountType: DiscountType, orderDiscountValue: number) {
  const subtotal = resolvedItems.reduce((s, i) => s + i.lineSubtotalPaise, 0);
  const itemDiscountTotal = resolvedItems.reduce((s, i) => s + i.itemDiscountPaise, 0);
  const baseForOrderDiscount = subtotal - itemDiscountTotal;
  const orderDiscountPaise =
    orderDiscountValue > 0 ? resolveDiscountAmount(baseForOrderDiscount, orderDiscountType, orderDiscountValue, "the order") : 0;
  const net = baseForOrderDiscount - orderDiscountPaise;
  return { subtotal, itemDiscountTotal, orderDiscountPaise, net };
}

export function createOrder(input: CreateOrderInput, userId: string, role: Role): OrderRow {
  if (!input.items || input.items.length === 0) {
    throw new ValidationError("An order must have at least one item.");
  }
  const businessDate = input.businessDate || todayBusinessDate();
  assertBusinessDateWritable(businessDate, role);

  const resolvedItems = resolveOrderItems(input.items);

  const orderDiscountType: DiscountType = input.discountType ?? "FLAT";
  const orderDiscountValue = input.discountValue ?? 0;
  const { subtotal, itemDiscountTotal, orderDiscountPaise, net } = computeOrderTotals(
    resolvedItems,
    orderDiscountType,
    orderDiscountValue
  );

  const orderId = newId("order");
  const orderNumber = nextSequence("order_number");
  const now = nowIso();
  const status: OrderStatus = input.asDraft ? "DRAFT" : "CONFIRMED";

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO sales_orders
        (id, order_number, business_date, order_type, status, kitchen_status, customer_name, customer_phone,
         subtotal_paise, discount_paise, discount_type, discount_value, item_discount_total_paise, discount_reason,
         net_total_paise, notes, created_by, confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'NOT_SENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      orderNumber,
      businessDate,
      input.orderType,
      status,
      input.customerName ?? null,
      input.customerPhone ?? null,
      subtotal,
      orderDiscountPaise,
      orderDiscountType,
      orderDiscountValue,
      itemDiscountTotal,
      input.discountReason ?? null,
      net,
      input.notes ?? null,
      userId,
      status === "CONFIRMED" ? now : null,
      now,
      now
    );

    for (const item of resolvedItems) {
      const itemId = newId("item");
      db.prepare(
        `INSERT INTO sales_order_items
          (id, sales_order_id, menu_item_id, item_name_snapshot, price_type, unit_price_paise, quantity,
           line_subtotal_paise, discount_paise, discount_type, discount_value, line_net_paise, special_instructions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId,
        orderId,
        item.menuItemId,
        item.itemName,
        item.priceType,
        item.unitPricePaise,
        item.quantity,
        item.lineSubtotalPaise,
        item.itemDiscountPaise,
        item.discountType,
        item.discountValue,
        item.lineNetPaise,
        item.specialInstructions,
        now
      );

      if (item.itemDiscountPaise > 0) {
        db.prepare(
          `INSERT INTO discounts (id, sales_order_id, sales_order_item_id, amount_paise, discount_type, discount_value, reason, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(newId("disc"), orderId, itemId, item.itemDiscountPaise, item.discountType, item.discountValue, input.discountReason ?? null, userId, now);
      }
    }

    if (orderDiscountPaise > 0) {
      db.prepare(
        `INSERT INTO discounts (id, sales_order_id, amount_paise, discount_type, discount_value, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(newId("disc"), orderId, orderDiscountPaise, orderDiscountType, orderDiscountValue, input.discountReason ?? null, userId, now);
    }

    recordAudit({
      userId,
      action: "ORDER_CREATED",
      entityType: "sales_order",
      entityId: orderId,
      newValue: { orderNumber, subtotal, itemDiscountTotal, orderDiscountPaise, net, itemCount: resolvedItems.length },
    });
  });
  txn();

  return getOrderOrThrow(orderId);
}

export function updateOrderItems(orderId: string, input: CreateOrderInput, userId: string, role: Role): OrderRow {
  const order = getOrderOrThrow(orderId);
  if (!EDITABLE_STATUSES.includes(order.status)) {
    throw new ConflictError(`Cannot edit an order that is ${order.status.toLowerCase()}.`);
  }
  assertBusinessDateWritable(order.business_date, role);

  if (!input.items || input.items.length === 0) throw new ValidationError("An order must have at least one item.");

  const resolvedItems = resolveOrderItems(input.items);

  const orderDiscountType: DiscountType = input.discountType ?? "FLAT";
  const orderDiscountValue = input.discountValue ?? 0;
  const { subtotal, itemDiscountTotal, orderDiscountPaise, net } = computeOrderTotals(
    resolvedItems,
    orderDiscountType,
    orderDiscountValue
  );

  const editedAfterKitchenStarted = order.status === "PREPARING" || order.status === "READY";
  const now = nowIso();

  const txn = db.transaction(() => {
    db.prepare("DELETE FROM discounts WHERE sales_order_id = ?").run(orderId);
    db.prepare("DELETE FROM sales_order_items WHERE sales_order_id = ?").run(orderId);
    for (const item of resolvedItems) {
      const itemId = newId("item");
      db.prepare(
        `INSERT INTO sales_order_items
          (id, sales_order_id, menu_item_id, item_name_snapshot, price_type, unit_price_paise, quantity,
           line_subtotal_paise, discount_paise, discount_type, discount_value, line_net_paise, special_instructions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId,
        orderId,
        item.menuItemId,
        item.itemName,
        item.priceType,
        item.unitPricePaise,
        item.quantity,
        item.lineSubtotalPaise,
        item.itemDiscountPaise,
        item.discountType,
        item.discountValue,
        item.lineNetPaise,
        item.specialInstructions,
        now
      );

      if (item.itemDiscountPaise > 0) {
        db.prepare(
          `INSERT INTO discounts (id, sales_order_id, sales_order_item_id, amount_paise, discount_type, discount_value, reason, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(newId("disc"), orderId, itemId, item.itemDiscountPaise, item.discountType, item.discountValue, input.discountReason ?? null, userId, now);
      }
    }

    if (orderDiscountPaise > 0) {
      db.prepare(
        `INSERT INTO discounts (id, sales_order_id, amount_paise, discount_type, discount_value, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(newId("disc"), orderId, orderDiscountPaise, orderDiscountType, orderDiscountValue, input.discountReason ?? null, userId, now);
    }

    db.prepare(
      `UPDATE sales_orders SET subtotal_paise = ?, discount_paise = ?, discount_type = ?, discount_value = ?,
       item_discount_total_paise = ?, discount_reason = ?, net_total_paise = ?, notes = COALESCE(?, notes), updated_at = ?
       WHERE id = ?`
    ).run(
      subtotal,
      orderDiscountPaise,
      orderDiscountType,
      orderDiscountValue,
      itemDiscountTotal,
      input.discountReason ?? null,
      net,
      input.notes ?? null,
      now,
      orderId
    );

    recordAudit({
      userId,
      action: editedAfterKitchenStarted ? "ORDER_EDITED_AFTER_KITCHEN_STARTED" : "ORDER_EDITED",
      entityType: "sales_order",
      entityId: orderId,
      oldValue: { subtotal_paise: order.subtotal_paise, net_total_paise: order.net_total_paise },
      newValue: { subtotal, net },
    });
  });
  txn();

  return getOrderOrThrow(orderId);
}

export function cancelOrder(orderId: string, reason: string, userId: string, role: Role): OrderRow {
  if (!reason) throw new ValidationError("A reason is required to cancel an order.");
  const order = getOrderOrThrow(orderId);
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new ConflictError(
      `Cannot cancel an order that is ${order.status.toLowerCase()}. Use a refund instead for completed orders.`
    );
  }
  assertBusinessDateWritable(order.business_date, role);

  const activePayments = getOrderPayments(orderId) as { id: string; amount_paise: number; payment_method_id: string; payment_method_type: string }[];
  const now = nowIso();

  const txn = db.transaction(() => {
    for (const p of activePayments) {
      db.prepare("UPDATE payments SET status = 'VOIDED' WHERE id = ?").run(p.id);
      if (p.payment_method_type === "CASH") {
        recordCashTransaction({
          businessDate: order.business_date,
          txnType: "REFUND",
          direction: "OUT",
          amountPaise: p.amount_paise,
          referenceType: "ORDER_CANCELLATION",
          referenceId: orderId,
          reason: `Refunding pre-payment for cancelled order #${order.order_number}`,
          userId,
        });
      } else {
        recordBankTransaction({
          businessDate: order.business_date,
          txnType: "DEBIT",
          amountPaise: p.amount_paise,
          description: `Refund of pre-payment — cancelled order #${order.order_number}`,
          category: "BUSINESS",
          paymentMethodId: p.payment_method_id,
          userId,
        });
      }
    }

    db.prepare(
      "UPDATE sales_orders SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = ?, updated_at = ? WHERE id = ?"
    ).run(reason, now, now, orderId);

    recordAudit({
      userId,
      action: "ORDER_CANCELLED",
      entityType: "sales_order",
      entityId: orderId,
      oldValue: { status: order.status },
      newValue: { status: "CANCELLED" },
      reason,
    });
  });
  txn();

  return getOrderOrThrow(orderId);
}

export function updateKitchenStatus(orderId: string, kitchenStatus: string, userId: string): OrderRow {
  const order = getOrderOrThrow(orderId);
  if (order.status === "CANCELLED" || order.status === "COMPLETED" || order.status === "REFUNDED") {
    throw new ConflictError(`Cannot update kitchen status for an order that is ${order.status.toLowerCase()}.`);
  }
  const statusMap: Record<string, OrderStatus> = {
    PREPARING: "PREPARING",
    READY: "READY",
  };
  const now = nowIso();
  const newOrderStatus = statusMap[kitchenStatus] ?? order.status;

  db.prepare("UPDATE sales_orders SET kitchen_status = ?, status = ?, updated_at = ? WHERE id = ?").run(
    kitchenStatus,
    newOrderStatus,
    now,
    orderId
  );

  recordAudit({
    userId,
    action: "KITCHEN_STATUS_UPDATED",
    entityType: "sales_order",
    entityId: orderId,
    oldValue: { kitchenStatus: order.kitchen_status },
    newValue: { kitchenStatus },
  });

  return getOrderOrThrow(orderId);
}

export function completeOrder(orderId: string, input: CompleteOrderInput, userId: string, role: Role): OrderRow {
  const order = getOrderOrThrow(orderId);
  if (!COMPLETABLE_STATUSES.includes(order.status)) {
    throw new ConflictError(`Cannot complete an order that is ${order.status.toLowerCase()}.`);
  }
  const isClosedDay = assertBusinessDateWritable(order.business_date, role);

  if (input.allowNegativeStock && role !== "ADMIN") {
    throw new ForbiddenError("Only an Admin can override an insufficient-stock warning.");
  }
  if (input.allowNegativeStock && !input.overrideReason) {
    throw new ValidationError("A reason is required to override insufficient stock.");
  }

  const items = getOrderItems(orderId) as {
    id: string;
    menu_item_id: string;
    price_type: "HALF" | "FULL" | "SINGLE";
    quantity: number;
    status: string;
  }[];

  const existingPayments = getOrderPayments(orderId) as { amount_paise: number }[];
  const newPayments = input.payments ?? [];
  const alreadyPaid = existingPayments.reduce((s, p) => s + p.amount_paise, 0);
  const incomingPaid = newPayments.reduce((s, p) => s + p.amountPaise, 0);
  const totalPaid = alreadyPaid + incomingPaid;

  if (totalPaid !== order.net_total_paise) {
    throw new ValidationError(
      `Payment total does not match the order total. Order: ${order.net_total_paise} paise, received: ${totalPaid} paise.`
    );
  }

  const now = nowIso();

  const txn = db.transaction(() => {
    for (const p of newPayments) {
      const method = getPaymentMethodOrThrow(p.paymentMethodId);
      db.prepare(
        `INSERT INTO payments (id, sales_order_id, payment_method_id, amount_paise, reference, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(newId("pay"), orderId, p.paymentMethodId, p.amountPaise, p.reference ?? null, userId, now);

      if (method.type === "CASH") {
        recordCashTransaction({
          businessDate: order.business_date,
          txnType: "SALE",
          direction: "IN",
          amountPaise: p.amountPaise,
          referenceType: "ORDER",
          referenceId: orderId,
          userId,
        });
      } else {
        recordBankTransaction({
          businessDate: order.business_date,
          txnType: "CREDIT",
          amountPaise: p.amountPaise,
          description: `Sale — order #${order.order_number} (${method.name})`,
          category: "BUSINESS",
          paymentMethodId: p.paymentMethodId,
          userId,
        });
      }
    }

    for (const item of items) {
      if (item.status !== "ACTIVE") continue;
      const recipeVersion = getEffectiveRecipeVersion(item.menu_item_id, item.price_type, order.created_at);
      let cogsTotal = 0;

      if (!recipeVersion) {
        recordAudit({
          userId,
          action: "MISSING_RECIPE_AT_SALE",
          entityType: "sales_order_item",
          entityId: item.id,
          reason: "No recipe configured — sale completed with zero COGS for this line.",
        });
      } else {
        const recipeItems = getRecipeItems(recipeVersion.id);
        for (const ri of recipeItems) {
          const qtyNeeded = (ri.quantity_base * (1 + ri.wastage_pct / 100) * item.quantity) / (ri.yield_pct / 100);
          const result = recordMovement({
            inventoryItemId: ri.inventory_item_id,
            movementType: "SALE_CONSUMPTION",
            direction: "OUT",
            quantityBase: qtyNeeded,
            referenceType: "ORDER",
            referenceId: orderId,
            businessDate: order.business_date,
            userId,
            allowNegativeStock: !!input.allowNegativeStock,
            reason: input.allowNegativeStock ? input.overrideReason : null,
          });
          cogsTotal += result.totalCostPaise ?? 0;
        }
      }

      db.prepare("UPDATE sales_order_items SET cogs_paise = ?, recipe_version_id = ? WHERE id = ?").run(
        cogsTotal,
        recipeVersion?.id ?? null,
        item.id
      );
    }

    db.prepare(
      "UPDATE sales_orders SET status = 'COMPLETED', kitchen_status = 'SERVED', completed_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, orderId);

    recordAudit({
      userId,
      action: "ORDER_COMPLETED",
      entityType: "sales_order",
      entityId: orderId,
      newValue: { totalPaid, closedDayOverride: isClosedDay },
      reason: isClosedDay ? "Completed on an already-closed business day (Admin override)" : undefined,
    });
  });
  txn();

  return getOrderOrThrow(orderId);
}

export function refundOrder(
  orderId: string,
  input: { amountPaise: number; reason: string; refundType: "FULL" | "PARTIAL"; paymentMethodId: string },
  userId: string,
  role: Role
): OrderRow {
  const order = getOrderOrThrow(orderId);
  if (order.status !== "COMPLETED" && order.status !== "REFUNDED") {
    throw new ConflictError("Only a completed order can be refunded.");
  }
  if (!input.reason) throw new ValidationError("A reason is required to process a refund.");
  if (input.amountPaise <= 0) throw new ValidationError("Refund amount must be greater than zero.");
  assertBusinessDateWritable(order.business_date, role);

  const priorRefunds = db
    .prepare("SELECT COALESCE(SUM(amount_paise),0) as total FROM refunds WHERE sales_order_id = ?")
    .get(orderId) as { total: number };

  if (priorRefunds.total + input.amountPaise > order.net_total_paise) {
    throw new ValidationError("Refund amount exceeds the amount actually paid for this order.");
  }

  const method = getPaymentMethodOrThrow(input.paymentMethodId);
  const now = nowIso();

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO refunds (id, sales_order_id, amount_paise, refund_type, reason, payment_method_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId("refund"), orderId, input.amountPaise, input.refundType, input.reason, input.paymentMethodId, userId, now);

    if (method.type === "CASH") {
      recordCashTransaction({
        businessDate: order.business_date,
        txnType: "REFUND",
        direction: "OUT",
        amountPaise: input.amountPaise,
        referenceType: "REFUND",
        referenceId: orderId,
        reason: input.reason,
        userId,
      });
    } else {
      recordBankTransaction({
        businessDate: order.business_date,
        txnType: "DEBIT",
        amountPaise: input.amountPaise,
        description: `Refund — order #${order.order_number}: ${input.reason}`,
        category: "BUSINESS",
        paymentMethodId: input.paymentMethodId,
        userId,
      });
    }

    if (input.refundType === "FULL") {
      db.prepare("UPDATE sales_orders SET status = 'REFUNDED', updated_at = ? WHERE id = ?").run(now, orderId);
    }

    recordAudit({
      userId,
      action: "ORDER_REFUNDED",
      entityType: "sales_order",
      entityId: orderId,
      newValue: { amountPaise: input.amountPaise, refundType: input.refundType },
      reason: input.reason,
    });
  });
  txn();

  return getOrderOrThrow(orderId);
}
