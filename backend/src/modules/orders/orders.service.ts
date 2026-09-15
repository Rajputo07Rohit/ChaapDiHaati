import { ClientSession, HydratedDocument } from "mongoose";
import { MenuCategory, Order, OrderDoc, OrderDiscountSub, OrderItemSub, OrderPaymentSub, PaymentMethod, Refund, User } from "../../db/models";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { nextSequence } from "../../utils/sequence";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import { assertBusinessDateWritable } from "../../utils/businessDate";
import { getCurrentPrice, getMenuItemOrThrow } from "../menu/menu.service";
import { getEffectiveRecipeVersion, getRecipeItems } from "../recipes/recipe.service";
import { recordMovement, getInventoryItemOrThrow } from "../inventory/inventory.service";
import { recordCashTransaction } from "../cash/cash.service";
import { recordBankTransaction } from "../bank/bank.service";
import { getPaymentMethodOrThrow } from "../paymentMethods/paymentMethods.service";
import { formatPaise } from "../../utils/money";
import { Role } from "../../types/express";
import { CompleteOrderInput, CreateOrderInput, DiscountType, OrderItemInput, OrderStatus, PaymentInput, PaymentStatus } from "./orders.types";

const EDITABLE_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "PREPARING", "READY"];
const COMPLETABLE_STATUSES: OrderStatus[] = ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
const CANCELLABLE_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

/** Single-step forward-only stages a staff member can push an order through by hand. */
const STATUS_ADVANCE_MAP: Record<string, OrderStatus> = {
  CONFIRMED: "PREPARING",
  PREPARING: "READY",
  READY: "OUT_FOR_DELIVERY",
};

export interface OrderRow {
  id: string;
  order_number: number;
  business_date: string;
  order_type: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  assigned_rider_id: string | null;
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
  confirmed_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

function toOrderRow(doc: OrderDoc): OrderRow {
  return {
    id: doc._id,
    order_number: doc.orderNumber,
    business_date: doc.businessDate,
    order_type: doc.orderType,
    status: doc.status,
    payment_status: doc.paymentStatus,
    customer_name: doc.customerName,
    customer_phone: doc.customerPhone,
    delivery_address: doc.deliveryAddress,
    assigned_rider_id: doc.assignedRiderId,
    subtotal_paise: doc.subtotalPaise,
    discount_paise: doc.discountPaise,
    discount_type: doc.discountType,
    discount_value: doc.discountValue,
    item_discount_total_paise: doc.itemDiscountTotalPaise,
    discount_reason: doc.discountReason,
    net_total_paise: doc.netTotalPaise,
    cancel_reason: doc.cancelReason,
    notes: doc.notes,
    created_by: doc.createdBy,
    confirmed_at: doc.confirmedAt,
    delivered_at: doc.deliveredAt,
    completed_at: doc.completedAt,
    cancelled_at: doc.cancelledAt,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

function toItemRow(item: OrderItemSub) {
  return {
    id: item._id,
    menu_item_id: item.menuItemId,
    item_name_snapshot: item.itemNameSnapshot,
    category_name: item.categoryName,
    price_type: item.priceType,
    unit_price_paise: item.unitPricePaise,
    quantity: item.quantity,
    line_subtotal_paise: item.lineSubtotalPaise,
    recipe_version_id: item.recipeVersionId,
    cogs_paise: item.cogsPaise,
    special_instructions: item.specialInstructions,
    status: item.status,
    discount_paise: item.discountPaise,
    discount_type: item.discountType,
    discount_value: item.discountValue,
    line_net_paise: item.lineNetPaise,
  };
}

async function toPaymentRows(payments: OrderPaymentSub[]) {
  const active = payments.filter((p) => p.status === "ACTIVE");
  const methodIds = [...new Set(active.map((p) => p.paymentMethodId))];
  const methods = await PaymentMethod.find({ _id: { $in: methodIds } });
  const byId = new Map(methods.map((m) => [m._id, m]));
  return active.map((p) => {
    const method = byId.get(p.paymentMethodId);
    return {
      id: p._id,
      payment_method_id: p.paymentMethodId,
      payment_method_name: method?.name ?? "",
      payment_method_type: method?.type ?? "CASH",
      amount_paise: p.amountPaise,
    };
  });
}

export async function getOrderOrThrow(id: string, session?: ClientSession): Promise<OrderRow> {
  const doc = await Order.findById(id).session(session ?? null);
  if (!doc) throw new NotFoundError("Order");
  return toOrderRow(doc);
}

export async function getOrderItems(orderId: string) {
  const doc = await Order.findById(orderId);
  if (!doc) return [];
  return doc.items.map(toItemRow);
}

export async function getOrderPayments(orderId: string) {
  const doc = await Order.findById(orderId);
  if (!doc) return [];
  return toPaymentRows(doc.payments);
}

export async function getOrderFull(id: string) {
  const doc = await Order.findById(id);
  if (!doc) throw new NotFoundError("Order");
  return { ...toOrderRow(doc), items: doc.items.map(toItemRow), payments: await toPaymentRows(doc.payments) };
}

export async function listOrders(filters: { status?: string; businessDate?: string; limit?: number } = {}): Promise<OrderRow[]> {
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.businessDate) query.businessDate = filters.businessDate;
  let q = Order.find(query).sort({ createdAt: -1 });
  if (filters.limit) q = q.limit(filters.limit);
  const docs = await q;
  return docs.map(toOrderRow);
}

interface ResolvedOrderItem {
  menuItemId: string;
  itemName: string;
  categoryName: string | null;
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

async function resolveOrderItems(items: OrderItemInput[]): Promise<ResolvedOrderItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const menuItem = await getMenuItemOrThrow(item.menuItemId);
      if (menuItem.status !== "ACTIVE") {
        throw new ValidationError(`${menuItem.name} is not currently available.`);
      }
      if (item.quantity <= 0) throw new ValidationError("Quantity must be greater than zero.");
      const price = await getCurrentPrice(item.menuItemId, item.priceType);
      if (price == null) {
        throw new ValidationError(`${menuItem.name} has no price configured for ${item.priceType}.`);
      }

      const lineSubtotalPaise = price * item.quantity;
      const discountType = item.discountType ?? "FLAT";
      const discountValue = item.discountValue ?? 0;
      const itemDiscountPaise = discountValue > 0 ? resolveDiscountAmount(lineSubtotalPaise, discountType, discountValue, menuItem.name) : 0;

      const category = await MenuCategory.findById(menuItem.category_id);

      return {
        menuItemId: item.menuItemId,
        itemName: menuItem.name,
        categoryName: category?.name ?? null,
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
    })
  );
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

function buildItemSubs(resolvedItems: ResolvedOrderItem[], now: string, discountReason: string | undefined): { items: OrderItemSub[]; discounts: OrderDiscountSub[] } {
  const items: OrderItemSub[] = [];
  const discounts: OrderDiscountSub[] = [];

  for (const item of resolvedItems) {
    const itemId = newId("item");
    items.push({
      _id: itemId,
      menuItemId: item.menuItemId,
      itemNameSnapshot: item.itemName,
      categoryName: item.categoryName,
      priceType: item.priceType,
      unitPricePaise: item.unitPricePaise,
      quantity: item.quantity,
      lineSubtotalPaise: item.lineSubtotalPaise,
      recipeVersionId: null,
      cogsPaise: null,
      specialInstructions: item.specialInstructions,
      status: "ACTIVE",
      discountPaise: item.itemDiscountPaise,
      discountType: item.discountType,
      discountValue: item.discountValue,
      lineNetPaise: item.lineNetPaise,
      createdAt: now,
    } as OrderItemSub);

    if (item.itemDiscountPaise > 0) {
      discounts.push({
        _id: newId("disc"),
        salesOrderItemId: itemId,
        amountPaise: item.itemDiscountPaise,
        discountType: item.discountType,
        discountValue: item.discountValue,
        reason: discountReason ?? null,
        createdBy: null,
        createdAt: now,
      } as OrderDiscountSub);
    }
  }

  return { items, discounts };
}

/**
 * Auto-assignment for delivery orders: whichever active rider currently has
 * the fewest orders still in flight gets the next one — keeps it fair as
 * more riders are added, and needs no owner configuration. Returns null
 * (order stays unassigned, same as before) if there are no active riders
 * yet — staff can still assign one by hand from the Orders page.
 */
async function pickLeastBusyRider(): Promise<string | null> {
  const riders = await User.find({ role: "RIDER", active: true });
  if (riders.length === 0) return null;

  const counts = await Order.aggregate([
    { $match: { assignedRiderId: { $ne: null }, status: { $nin: ["DELIVERED", "CANCELLED", "REFUNDED", "COMPLETED"] } } },
    { $group: { _id: "$assignedRiderId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map<string, number>(counts.map((c) => [c._id as string, c.count as number]));

  let best = riders[0];
  let bestCount = countMap.get(String(riders[0]._id)) ?? 0;
  for (const r of riders.slice(1)) {
    const c = countMap.get(String(r._id)) ?? 0;
    if (c < bestCount) {
      best = r;
      bestCount = c;
    }
  }
  return String(best._id);
}

export async function createOrder(input: CreateOrderInput, userId: string, role: Role): Promise<OrderRow> {
  if (!input.items || input.items.length === 0) {
    throw new ValidationError("An order must have at least one item.");
  }
  const businessDate = input.businessDate || todayBusinessDate();
  await assertBusinessDateWritable(businessDate, role);

  const resolvedItems = await resolveOrderItems(input.items);

  const orderDiscountType: DiscountType = input.discountType ?? "FLAT";
  const orderDiscountValue = input.discountValue ?? 0;
  const { subtotal, itemDiscountTotal, orderDiscountPaise, net } = computeOrderTotals(resolvedItems, orderDiscountType, orderDiscountValue);

  const now = nowIso();
  const status: OrderStatus = input.asDraft ? "DRAFT" : "CONFIRMED";
  const autoAssignedRiderId = input.orderType === "DELIVERY" && !input.asDraft ? await pickLeastBusyRider() : null;

  const orderId = await withTransaction(async (session) => {
    const orderNumber = await nextSequence("order_number", session);
    const newOrderId = newId("order");
    const { items, discounts } = buildItemSubs(resolvedItems, now, input.discountReason);
    for (const d of discounts) d.createdBy = userId;

    if (orderDiscountPaise > 0) {
      discounts.push({
        _id: newId("disc"),
        salesOrderItemId: null,
        amountPaise: orderDiscountPaise,
        discountType: orderDiscountType,
        discountValue: orderDiscountValue,
        reason: input.discountReason ?? null,
        createdBy: userId,
        createdAt: now,
      } as OrderDiscountSub);
    }

    await Order.create(
      [
        {
          _id: newOrderId,
          orderNumber,
          businessDate,
          orderType: input.orderType,
          status,
          paymentStatus: "UNPAID",
          customerName: input.customerName ?? null,
          customerPhone: input.customerPhone ?? null,
          deliveryAddress: input.deliveryAddress ?? null,
          assignedRiderId: autoAssignedRiderId,
          subtotalPaise: subtotal,
          discountPaise: orderDiscountPaise,
          discountType: orderDiscountType,
          discountValue: orderDiscountValue,
          itemDiscountTotalPaise: itemDiscountTotal,
          discountReason: input.discountReason ?? null,
          netTotalPaise: net,
          notes: input.notes ?? null,
          createdBy: userId,
          confirmedAt: status === "CONFIRMED" ? now : null,
          createdAt: now,
          updatedAt: now,
          items,
          payments: [],
          discounts,
        },
      ],
      { session }
    );

    await recordAudit(
      {
        userId,
        action: "ORDER_CREATED",
        entityType: "sales_order",
        entityId: newOrderId,
        newValue: { orderNumber, subtotal, itemDiscountTotal, orderDiscountPaise, net, itemCount: resolvedItems.length },
      },
      session
    );

    if (autoAssignedRiderId) {
      await recordAudit(
        {
          userId,
          action: "RIDER_ASSIGNED",
          entityType: "sales_order",
          entityId: newOrderId,
          oldValue: { assignedRiderId: null },
          newValue: { assignedRiderId: autoAssignedRiderId, auto: true },
          reason: "Auto-assigned to the least-busy active rider on order creation",
        },
        session
      );
    }

    return newOrderId;
  });

  return getOrderOrThrow(orderId);
}

export async function updateOrderItems(orderId: string, input: CreateOrderInput, userId: string, role: Role): Promise<OrderRow> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (!EDITABLE_STATUSES.includes(order.status)) {
    throw new ConflictError(`Cannot edit an order that is ${order.status.toLowerCase()}.`);
  }
  await assertBusinessDateWritable(order.businessDate, role);

  if (!input.items || input.items.length === 0) throw new ValidationError("An order must have at least one item.");

  const resolvedItems = await resolveOrderItems(input.items);

  const orderDiscountType: DiscountType = input.discountType ?? "FLAT";
  const orderDiscountValue = input.discountValue ?? 0;
  const { subtotal, itemDiscountTotal, orderDiscountPaise, net } = computeOrderTotals(resolvedItems, orderDiscountType, orderDiscountValue);

  const editedAfterKitchenStarted = order.status === "PREPARING" || order.status === "READY";
  const now = nowIso();
  const oldSubtotal = order.subtotalPaise;
  const oldNet = order.netTotalPaise;

  await withTransaction(async (session) => {
    const doc = (await Order.findById(orderId).session(session))!;
    const { items, discounts } = buildItemSubs(resolvedItems, now, input.discountReason);
    for (const d of discounts) d.createdBy = userId;

    if (orderDiscountPaise > 0) {
      discounts.push({
        _id: newId("disc"),
        salesOrderItemId: null,
        amountPaise: orderDiscountPaise,
        discountType: orderDiscountType,
        discountValue: orderDiscountValue,
        reason: input.discountReason ?? null,
        createdBy: userId,
        createdAt: now,
      } as OrderDiscountSub);
    }

    doc.items = items as typeof doc.items;
    doc.discounts = discounts as typeof doc.discounts;
    doc.subtotalPaise = subtotal;
    doc.discountPaise = orderDiscountPaise;
    doc.discountType = orderDiscountType;
    doc.discountValue = orderDiscountValue;
    doc.itemDiscountTotalPaise = itemDiscountTotal;
    doc.discountReason = input.discountReason ?? null;
    doc.netTotalPaise = net;
    if (input.notes !== undefined) doc.notes = input.notes;
    doc.updatedAt = now;
    await doc.save({ session });

    await recordAudit(
      {
        userId,
        action: editedAfterKitchenStarted ? "ORDER_EDITED_AFTER_KITCHEN_STARTED" : "ORDER_EDITED",
        entityType: "sales_order",
        entityId: orderId,
        oldValue: { subtotal_paise: oldSubtotal, net_total_paise: oldNet },
        newValue: { subtotal, net },
      },
      session
    );
  });

  return getOrderOrThrow(orderId);
}

export async function cancelOrder(orderId: string, reason: string, userId: string, role: Role): Promise<OrderRow> {
  if (!reason) throw new ValidationError("A reason is required to cancel an order.");
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new ConflictError(`Cannot cancel an order that is ${order.status.toLowerCase()}. Use a refund instead for completed orders.`);
  }
  await assertBusinessDateWritable(order.businessDate, role);

  const now = nowIso();

  await withTransaction(async (session) => {
    const doc = (await Order.findById(orderId).session(session))!;
    const activePayments = doc.payments.filter((p) => p.status === "ACTIVE");
    const methodIds = [...new Set(activePayments.map((p) => p.paymentMethodId))];
    const methods = await PaymentMethod.find({ _id: { $in: methodIds } }).session(session);
    const methodById = new Map(methods.map((m) => [m._id, m]));

    for (const p of activePayments) {
      p.status = "VOIDED";
      const method = methodById.get(p.paymentMethodId);
      if (method?.type === "CASH") {
        await recordCashTransaction(
          {
            businessDate: doc.businessDate,
            txnType: "REFUND",
            direction: "OUT",
            amountPaise: p.amountPaise,
            referenceType: "ORDER_CANCELLATION",
            referenceId: orderId,
            reason: `Refunding pre-payment for cancelled order #${doc.orderNumber}`,
            userId,
          },
          session
        );
      } else {
        await recordBankTransaction(
          {
            businessDate: doc.businessDate,
            txnType: "DEBIT",
            amountPaise: p.amountPaise,
            description: `Refund of pre-payment — cancelled order #${doc.orderNumber}`,
            category: "BUSINESS",
            paymentMethodId: p.paymentMethodId,
            userId,
          },
          session
        );
      }
    }

    const oldStatus = doc.status;
    doc.status = "CANCELLED";
    doc.cancelReason = reason;
    doc.cancelledAt = now;
    doc.updatedAt = now;
    await doc.save({ session });

    await recordAudit(
      {
        userId,
        action: "ORDER_CANCELLED",
        entityType: "sales_order",
        entityId: orderId,
        oldValue: { status: oldStatus },
        newValue: { status: "CANCELLED" },
        reason,
      },
      session
    );
  });

  return getOrderOrThrow(orderId);
}

/** Posts each payment to the cash or bank ledger and pushes it onto the
 * order's embedded `payments[]`. Pure side-effecting helper — never touches
 * order status; callers decide what payment_status/order status should
 * become. Mutates `doc` in place; caller is responsible for `doc.save()`. */
async function postPayments(doc: HydratedDocument<OrderDoc>, payments: PaymentInput[], userId: string, session: ClientSession): Promise<void> {
  const now = nowIso();
  for (const p of payments) {
    const method = await getPaymentMethodOrThrow(p.paymentMethodId);
    doc.payments.push({
      _id: newId("pay"),
      paymentMethodId: p.paymentMethodId,
      amountPaise: p.amountPaise,
      reference: p.reference ?? null,
      status: "ACTIVE",
      createdBy: userId,
      createdAt: now,
    } as OrderPaymentSub);

    if (method.type === "CASH") {
      await recordCashTransaction(
        {
          businessDate: doc.businessDate,
          txnType: "SALE",
          direction: "IN",
          amountPaise: p.amountPaise,
          referenceType: "ORDER",
          referenceId: doc._id,
          userId,
        },
        session
      );
    } else {
      await recordBankTransaction(
        {
          businessDate: doc.businessDate,
          txnType: "CREDIT",
          amountPaise: p.amountPaise,
          description: `Sale — order #${doc.orderNumber} (${method.name})`,
          category: "BUSINESS",
          paymentMethodId: p.paymentMethodId,
          userId,
        },
        session
      );
    }
  }
}

function paymentStatusFor(totalPaid: number, netTotalPaise: number): PaymentStatus {
  if (totalPaid <= 0) return "UNPAID";
  if (totalPaid >= netTotalPaise) return "PAID";
  return "PARTIAL";
}

/**
 * Records payment against an order at any point before it's finished — the
 * COD/rider-collection step, or a staff member logging a phone payment ahead
 * of dispatch. Never consumes stock or changes the order's status; only
 * `payment_status` moves. A rider may only pay down an order assigned to them.
 */
export async function recordPayment(orderId: string, payments: PaymentInput[], userId: string, role: Role): Promise<OrderRow> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (order.status === "CANCELLED" || order.status === "COMPLETED" || order.status === "REFUNDED") {
    throw new ConflictError(`Cannot record a payment against an order that is ${order.status.toLowerCase()}.`);
  }
  if (role === "RIDER" && order.assignedRiderId !== userId) {
    throw new ForbiddenError("This order isn't assigned to you.");
  }
  if (!payments || payments.length === 0) {
    throw new ValidationError("At least one payment is required.");
  }

  const alreadyPaid = order.payments.filter((p) => p.status === "ACTIVE").reduce((s, p) => s + p.amountPaise, 0);
  const incoming = payments.reduce((s, p) => s + p.amountPaise, 0);
  const totalPaid = alreadyPaid + incoming;

  if (totalPaid > order.netTotalPaise) {
    throw new ValidationError(`Payment exceeds the remaining balance. Remaining: ${formatPaise(order.netTotalPaise - alreadyPaid)}.`);
  }

  const now = nowIso();
  const newPaymentStatus = paymentStatusFor(totalPaid, order.netTotalPaise);
  const oldPaymentStatus = order.paymentStatus;

  await withTransaction(async (session) => {
    const doc = (await Order.findById(orderId).session(session))!;
    await postPayments(doc, payments, userId, session);
    doc.paymentStatus = newPaymentStatus;
    doc.updatedAt = now;
    await doc.save({ session });

    await recordAudit(
      {
        userId,
        action: "PAYMENT_RECORDED",
        entityType: "sales_order",
        entityId: orderId,
        oldValue: { paymentStatus: oldPaymentStatus, totalPaid: alreadyPaid },
        newValue: { paymentStatus: newPaymentStatus, totalPaid },
      },
      session
    );
  });

  return getOrderOrThrow(orderId);
}

/**
 * Consumes stock/COGS for every active line and marks the order COMPLETED.
 * Shared by the one-step counter-sale flow (`completeOrder`) and the rider's
 * "mark delivered" step (`markDelivered`) — both call this only once payment
 * is already settled. Mutates and saves `doc` itself.
 */
async function finalizeOrder(
  doc: HydratedDocument<OrderDoc>,
  userId: string,
  role: Role,
  session: ClientSession,
  opts: { allowNegativeStock?: boolean; overrideReason?: string } = {}
): Promise<string[]> {
  const isClosedDay = await assertBusinessDateWritable(doc.businessDate, role);
  const now = nowIso();
  // Running out of a recipe ingredient never blocks the sale — it just goes
  // negative and gets flagged back to the till as a warning, so staff can
  // still ring up the order and restock later instead of turning the
  // customer away.
  const stockWarnings: string[] = [];

  for (const item of doc.items) {
    if (item.status !== "ACTIVE") continue;
    const recipeVersion = await getEffectiveRecipeVersion(item.menuItemId, item.priceType, doc.createdAt);
    let cogsTotal = 0;

    if (!recipeVersion) {
      await recordAudit(
        {
          userId,
          action: "MISSING_RECIPE_AT_SALE",
          entityType: "sales_order_item",
          entityId: item._id,
          reason: "No recipe configured — sale completed with zero COGS for this line.",
        },
        session
      );
    } else {
      const recipeItems = await getRecipeItems(recipeVersion.id);
      for (const ri of recipeItems) {
        const qtyNeeded = (ri.quantity_base * (1 + ri.wastage_pct / 100) * item.quantity) / (ri.yield_pct / 100);
        const result = await recordMovement(
          {
            inventoryItemId: ri.inventory_item_id,
            movementType: "SALE_CONSUMPTION",
            direction: "OUT",
            quantityBase: qtyNeeded,
            referenceType: "ORDER",
            referenceId: doc._id,
            businessDate: doc.businessDate,
            userId,
            allowNegativeStock: true,
            reason: opts.overrideReason ?? "Sold out of stock — allowed through, flagged for restock.",
          },
          session
        );
        cogsTotal += result.totalCostPaise ?? 0;
        if (result.wentNegative) {
          const invItem = await getInventoryItemOrThrow(ri.inventory_item_id, session);
          const label = `${item.itemNameSnapshot}: ${invItem.name} is now short (${result.resultingQtyBase}${invItem.base_unit})`;
          if (!stockWarnings.includes(label)) stockWarnings.push(label);
        }
      }
    }

    item.cogsPaise = cogsTotal;
    item.recipeVersionId = recipeVersion?.id ?? null;
  }

  doc.status = "COMPLETED";
  doc.completedAt = now;
  doc.updatedAt = now;
  await doc.save({ session });

  await recordAudit(
    {
      userId,
      action: "ORDER_COMPLETED",
      entityType: "sales_order",
      entityId: doc._id,
      newValue: { closedDayOverride: isClosedDay },
      reason: isClosedDay ? "Completed on an already-closed business day (Admin override)" : undefined,
    },
    session
  );

  return stockWarnings;
}

/** Counter-sale path: pay in full and finish in one step (dine-in/takeaway/
 * online, or a delivery order staff decide to close out directly). */
export async function completeOrder(
  orderId: string,
  input: CompleteOrderInput,
  userId: string,
  role: Role
): Promise<{ order: OrderRow; stockWarnings: string[] }> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (!COMPLETABLE_STATUSES.includes(order.status)) {
    throw new ConflictError(`Cannot complete an order that is ${order.status.toLowerCase()}.`);
  }

  const newPayments = input.payments ?? [];
  const alreadyPaid = order.payments.filter((p) => p.status === "ACTIVE").reduce((s, p) => s + p.amountPaise, 0);
  const incomingPaid = newPayments.reduce((s, p) => s + p.amountPaise, 0);
  const totalPaid = alreadyPaid + incomingPaid;

  if (totalPaid !== order.netTotalPaise) {
    throw new ValidationError(`Payment total does not match the order total. Order: ${order.netTotalPaise} paise, received: ${totalPaid} paise.`);
  }

  let stockWarnings: string[] = [];
  await withTransaction(async (session) => {
    const doc = (await Order.findById(orderId).session(session))!;
    if (newPayments.length > 0) {
      await postPayments(doc, newPayments, userId, session);
      doc.paymentStatus = "PAID";
    }
    stockWarnings = await finalizeOrder(doc, userId, role, session, { overrideReason: input.overrideReason });
  });

  return { order: await getOrderOrThrow(orderId), stockWarnings };
}

/** Single-step forward transitions a staff member drives by hand: kitchen
 * prep stages, and — for a delivery order with a rider already assigned —
 * sending it out. Never skips a stage. */
export async function updateOrderStatus(orderId: string, status: OrderStatus, userId: string): Promise<OrderRow> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  const expectedNext = STATUS_ADVANCE_MAP[order.status];
  if (!expectedNext || expectedNext !== status) {
    throw new ConflictError(`Cannot move an order from ${order.status.toLowerCase()} to ${status.toLowerCase()}.`);
  }
  if (status === "OUT_FOR_DELIVERY") {
    if (order.orderType !== "DELIVERY") {
      throw new ValidationError("Only delivery orders can be sent out for delivery.");
    }
    if (!order.assignedRiderId) {
      throw new ValidationError("Assign a rider before sending this order out for delivery.");
    }
  }

  const now = nowIso();
  const oldStatus = order.status;
  order.status = status;
  order.updatedAt = now;
  await order.save();

  await recordAudit({
    userId,
    action: "ORDER_STATUS_UPDATED",
    entityType: "sales_order",
    entityId: orderId,
    oldValue: { status: oldStatus },
    newValue: { status },
  });

  return getOrderOrThrow(orderId);
}

/**
 * The rider's (or staff's, as a fallback) final action on a delivery: only
 * allowed once payment is fully settled, so a COD order can never be closed
 * out with money still outstanding. Consumes stock/COGS and completes the
 * order in the same step as marking it delivered.
 */
export async function markDelivered(orderId: string, userId: string, role: Role): Promise<{ order: OrderRow; stockWarnings: string[] }> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (order.status !== "OUT_FOR_DELIVERY") {
    throw new ConflictError(`Cannot mark delivered an order that is ${order.status.toLowerCase()}.`);
  }
  if (role === "RIDER" && order.assignedRiderId !== userId) {
    throw new ForbiddenError("This order isn't assigned to you.");
  }
  if (order.paymentStatus !== "PAID") {
    const paid = order.payments.filter((p) => p.status === "ACTIVE").reduce((s, p) => s + p.amountPaise, 0);
    const remaining = order.netTotalPaise - paid;
    throw new ValidationError(`Collect the remaining ${formatPaise(remaining)} before marking this order delivered.`);
  }

  const now = nowIso();

  let stockWarnings: string[] = [];
  await withTransaction(async (session) => {
    const doc = (await Order.findById(orderId).session(session))!;
    doc.deliveredAt = now;
    doc.updatedAt = now;
    await recordAudit({ userId, action: "ORDER_DELIVERED", entityType: "sales_order", entityId: orderId, newValue: { deliveredAt: now } }, session);
    stockWarnings = await finalizeOrder(doc, userId, role, session);
  });

  return { order: await getOrderOrThrow(orderId), stockWarnings };
}

export async function refundOrder(
  orderId: string,
  input: { amountPaise: number; reason: string; refundType: "FULL" | "PARTIAL"; paymentMethodId: string },
  userId: string,
  role: Role
): Promise<OrderRow> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (order.status !== "COMPLETED" && order.status !== "REFUNDED") {
    throw new ConflictError("Only a completed order can be refunded.");
  }
  if (!input.reason) throw new ValidationError("A reason is required to process a refund.");
  if (input.amountPaise <= 0) throw new ValidationError("Refund amount must be greater than zero.");
  await assertBusinessDateWritable(order.businessDate, role);

  const priorRefunds = await Refund.aggregate([{ $match: { salesOrderId: orderId } }, { $group: { _id: null, total: { $sum: "$amountPaise" } } }]);
  const priorTotal = priorRefunds[0]?.total ?? 0;

  if (priorTotal + input.amountPaise > order.netTotalPaise) {
    throw new ValidationError("Refund amount exceeds the amount actually paid for this order.");
  }

  const method = await getPaymentMethodOrThrow(input.paymentMethodId);
  const now = nowIso();

  await withTransaction(async (session) => {
    await Refund.create(
      [
        {
          _id: newId("refund"),
          salesOrderId: orderId,
          amountPaise: input.amountPaise,
          refundType: input.refundType,
          reason: input.reason,
          paymentMethodId: input.paymentMethodId,
          createdBy: userId,
          createdAt: now,
        },
      ],
      { session }
    );

    if (method.type === "CASH") {
      await recordCashTransaction(
        {
          businessDate: order.businessDate,
          txnType: "REFUND",
          direction: "OUT",
          amountPaise: input.amountPaise,
          referenceType: "REFUND",
          referenceId: orderId,
          reason: input.reason,
          userId,
        },
        session
      );
    } else {
      await recordBankTransaction(
        {
          businessDate: order.businessDate,
          txnType: "DEBIT",
          amountPaise: input.amountPaise,
          description: `Refund — order #${order.orderNumber}: ${input.reason}`,
          category: "BUSINESS",
          paymentMethodId: input.paymentMethodId,
          userId,
        },
        session
      );
    }

    if (input.refundType === "FULL") {
      await Order.updateOne({ _id: orderId }, { status: "REFUNDED", paymentStatus: "REFUNDED", updatedAt: now }, { session });
    }

    await recordAudit(
      {
        userId,
        action: "ORDER_REFUNDED",
        entityType: "sales_order",
        entityId: orderId,
        newValue: { amountPaise: input.amountPaise, refundType: input.refundType },
        reason: input.reason,
      },
      session
    );
  });

  return getOrderOrThrow(orderId);
}

// ============================================================
// Rider delivery flow
// ============================================================

/** A rider's actionable queue by default (assigned, dispatched, not yet
 * delivered); `includeAll` adds their completed/cancelled history too. */
export async function listOrdersForRider(riderId: string, includeAll = false) {
  const query: Record<string, unknown> = { assignedRiderId: riderId };
  if (!includeAll) query.status = "OUT_FOR_DELIVERY";
  const docs = await Order.find(query).sort({ createdAt: -1 });
  return Promise.all(
    docs.map(async (o) => ({ ...toOrderRow(o), items: o.items.map(toItemRow), payments: await toPaymentRows(o.payments) }))
  );
}

export async function listRiders() {
  const docs = await User.find({ role: "RIDER", active: true }).sort({ fullName: 1 });
  return docs.map((u) => ({ id: u._id, username: u.username, fullName: u.fullName }));
}

export async function assignRider(orderId: string, riderId: string, userId: string): Promise<OrderRow> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (order.orderType !== "DELIVERY") {
    throw new ValidationError("Only delivery orders can have a rider assigned.");
  }
  if (order.status === "CANCELLED" || order.status === "REFUNDED" || order.status === "COMPLETED") {
    throw new ValidationError(`Cannot assign a rider to a ${order.status.toLowerCase()} order.`);
  }
  const rider = await User.findOne({ _id: riderId, role: "RIDER", active: true });
  if (!rider) throw new ValidationError("That user is not an active rider.");

  const oldRiderId = order.assignedRiderId;
  order.assignedRiderId = riderId;
  order.updatedAt = nowIso();
  await order.save();

  await recordAudit({
    userId,
    action: "RIDER_ASSIGNED",
    entityType: "sales_order",
    entityId: orderId,
    oldValue: { assignedRiderId: oldRiderId },
    newValue: { assignedRiderId: riderId },
  });

  return getOrderOrThrow(orderId);
}
