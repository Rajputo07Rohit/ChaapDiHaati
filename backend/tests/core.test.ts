import { beforeAll, describe, expect, it } from "vitest";
import { makeUser, makePaymentMethod, makeMenuItemWithRecipe, makeInventoryItem, getInventoryItem } from "./fixtures";
import {
  createOrder,
  completeOrder,
  cancelOrder,
  refundOrder,
  getOrderFull,
  assignRider,
  recordPayment,
  markDelivered,
} from "../src/modules/orders/orders.service";
import { recordMovement } from "../src/modules/inventory/inventory.service";
import { withTransaction } from "../src/db/mongoose";
import { setMenuPrice, getCurrentPrice } from "../src/modules/menu/menu.service";
import { recordExpense } from "../src/modules/expenses/expenses.service";
import { recordBankTransaction, getBankBalancePaise } from "../src/modules/bank/bank.service";
import { recordCashTransaction, getCashLedgerSummary } from "../src/modules/cash/cash.service";
import { getSalesSummary } from "../src/modules/reports/salesAggregate.service";
import { assertBusinessDateWritable } from "../src/utils/businessDate";
import { openBusinessDay, closeDay } from "../src/modules/dailyClosing/dailyClosing.service";
import { ValidationError, ForbiddenError } from "../src/utils/errors";
import { setSetting } from "../src/modules/settings/settings.service";

let ADMIN: string;
let CASH: string;
let ONLINE: string;

beforeAll(async () => {
  ADMIN = await makeUser("ADMIN");
  CASH = await makePaymentMethod("CASH");
  ONLINE = await makePaymentMethod("ONLINE");
});

describe("Spec accounting examples", () => {
  it("Example 1: Sale 1000, COGS 400, Expense 100 => Gross Profit 600, Net Profit 500", async () => {
    const date = "2020-01-01";
    const { menuItemId } = await makeMenuItemWithRecipe({
      priceType: "SINGLE",
      pricePaise: 100000, // ₹1000
      ingredientQtyBase: 1,
      ingredientCostPaisePerBase: 40000, // ₹400 COGS for qty=1
      userId: ADMIN,
    });

    const order = await createOrder(
      { orderType: "DINE_IN", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], businessDate: date },
      ADMIN,
      "ADMIN"
    );
    await completeOrder(order.id, { payments: [{ paymentMethodId: CASH, amountPaise: 100000 }] }, ADMIN, "ADMIN");
    await recordExpense({ businessDate: date, category: "Miscellaneous", description: "test expense", amountPaise: 10000, paymentMethodId: CASH }, ADMIN, "ADMIN");

    const summary = await getSalesSummary(date, date);
    const grossProfit = summary.netSalesPaise - summary.cogsPaise;
    const netProfit = grossProfit - 10000;

    expect(summary.netSalesPaise).toBe(100000);
    expect(summary.cogsPaise).toBe(40000);
    expect(grossProfit).toBe(60000);
    expect(netProfit).toBe(50000);
  });

  it("Example 2: Bank opening 10,000 + credit 5,000 - debit 2,000 = 13,000", async () => {
    // This is the first test in the suite to touch the bank ledger, so the
    // ledger is empty and the fallback opening balance is 0 — set an
    // explicit opening balance of ₹10,000 to match the worked example exactly.
    await setSetting("bank_opening_balance_paise", 1000000, ADMIN);

    await recordBankTransaction({ businessDate: "2020-02-01", txnType: "CREDIT", amountPaise: 500000, description: "credit", userId: ADMIN });
    await recordBankTransaction({ businessDate: "2020-02-01", txnType: "DEBIT", amountPaise: 200000, description: "debit", userId: ADMIN });

    expect(await getBankBalancePaise("2020-02-01")).toBe(1300000);
  });

  it("Example 3: Cash opening 5,000 + sales 2,000 - expenses 500 = expected 6,500", async () => {
    const date = "2020-03-01";
    const before = (await getCashLedgerSummary(date)).expectedCashPaise;
    await recordCashTransaction({ businessDate: date, txnType: "ADJUSTMENT", direction: "IN", amountPaise: 500000 - before, reason: "baseline to 5000", userId: ADMIN });
    const baseline = (await getCashLedgerSummary(date)).expectedCashPaise;
    expect(baseline).toBe(500000);

    await recordCashTransaction({ businessDate: date, txnType: "SALE", direction: "IN", amountPaise: 200000, userId: ADMIN });
    await recordCashTransaction({ businessDate: date, txnType: "EXPENSE", direction: "OUT", amountPaise: 50000, userId: ADMIN });

    const expected = (await getCashLedgerSummary(date)).expectedCashPaise;
    expect(expected).toBe(650000);
  });
});

describe("Order calculation, discounts, payments", () => {
  it("computes subtotal, discount and net correctly", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({
      priceType: "SINGLE",
      pricePaise: 20000,
      ingredientQtyBase: 1,
      ingredientCostPaisePerBase: 1,
      userId: ADMIN,
    });
    const order = await createOrder(
      {
        orderType: "TAKEAWAY",
        items: [{ menuItemId, priceType: "SINGLE", quantity: 3 }],
        discountType: "FLAT",
        discountValue: 5000,
        discountReason: "test",
        businessDate: "2020-01-05",
      },
      ADMIN,
      "ADMIN"
    );
    expect(order.subtotal_paise).toBe(60000);
    expect(order.discount_paise).toBe(5000);
    expect(order.net_total_paise).toBe(55000);
  });

  it("computes a percentage discount correctly", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 20000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const order = await createOrder(
      {
        orderType: "TAKEAWAY",
        items: [{ menuItemId, priceType: "SINGLE", quantity: 2 }],
        discountType: "PERCENTAGE",
        discountValue: 10,
        discountReason: "10% off promo",
        businessDate: "2020-01-05",
      },
      ADMIN,
      "ADMIN"
    );
    expect(order.subtotal_paise).toBe(40000);
    expect(order.discount_paise).toBe(4000); // 10% of 40000
    expect(order.net_total_paise).toBe(36000);
  });

  it("applies a per-item discount before the overall order discount", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 10000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const order = await createOrder(
      {
        orderType: "TAKEAWAY",
        items: [{ menuItemId, priceType: "SINGLE", quantity: 1, discountType: "PERCENTAGE", discountValue: 50 }],
        discountType: "FLAT",
        discountValue: 1000,
        discountReason: "item promo + loyalty flat off",
        businessDate: "2020-01-05",
      },
      ADMIN,
      "ADMIN"
    );
    // subtotal 10000, item discount 50% = 5000 -> base for order discount = 5000, minus flat 1000 = 4000
    expect(order.subtotal_paise).toBe(10000);
    expect(order.item_discount_total_paise).toBe(5000);
    expect(order.discount_paise).toBe(1000);
    expect(order.net_total_paise).toBe(4000);
  });

  it("rejects a discount greater than the subtotal", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 10000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    await expect(
      createOrder(
        { orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], discountType: "FLAT", discountValue: 20000, discountReason: "x", businessDate: "2020-01-05" },
        ADMIN,
        "ADMIN"
      )
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a discount percentage greater than 100", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 10000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    await expect(
      createOrder(
        { orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], discountType: "PERCENTAGE", discountValue: 150, discountReason: "x", businessDate: "2020-01-05" },
        ADMIN,
        "ADMIN"
      )
    ).rejects.toThrow(ValidationError);
  });

  it("rejects completion when payments do not sum to the order total", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 10000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const order = await createOrder({ orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], businessDate: "2020-01-06" }, ADMIN, "ADMIN");
    await expect(completeOrder(order.id, { payments: [{ paymentMethodId: CASH, amountPaise: 5000 }] }, ADMIN, "ADMIN")).rejects.toThrow(ValidationError);
  });

  it("supports split payment across two methods summing exactly to the total", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 10000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const order = await createOrder({ orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], businessDate: "2020-01-07" }, ADMIN, "ADMIN");
    const { order: completed } = await completeOrder(
      order.id,
      { payments: [{ paymentMethodId: CASH, amountPaise: 4000 }, { paymentMethodId: ONLINE, amountPaise: 6000 }] },
      ADMIN,
      "ADMIN"
    );
    expect(completed.status).toBe("COMPLETED");
  });
});

describe("Cancellation and refunds (RULE 2, RULE 3)", () => {
  it("excludes cancelled orders from sales aggregation entirely", async () => {
    const date = "2020-01-10";
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 30000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const before = (await getSalesSummary(date, date)).netSalesPaise;
    const order = await createOrder({ orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], businessDate: date }, ADMIN, "ADMIN");
    await cancelOrder(order.id, "customer changed mind", ADMIN, "ADMIN");
    const after = (await getSalesSummary(date, date)).netSalesPaise;
    expect(after).toBe(before);
  });

  it("refund creates a reversal transaction and never deletes the original completed sale", async () => {
    const date = "2020-01-11";
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 50000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const order = await createOrder({ orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], businessDate: date }, ADMIN, "ADMIN");
    await completeOrder(order.id, { payments: [{ paymentMethodId: CASH, amountPaise: 50000 }] }, ADMIN, "ADMIN");

    const refunded = await refundOrder(order.id, { amountPaise: 50000, reason: "customer complaint", refundType: "FULL", paymentMethodId: CASH }, ADMIN, "ADMIN");
    expect(refunded.status).toBe("REFUNDED");

    // Original sale is still there — the completed order record is never deleted.
    const full = await getOrderFull(order.id);
    expect(full.items?.length).toBe(1);
    expect(full.net_total_paise).toBe(50000);
  });

  it("rejects a refund larger than what was actually paid", async () => {
    const date = "2020-01-12";
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 10000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const order = await createOrder({ orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], businessDate: date }, ADMIN, "ADMIN");
    await completeOrder(order.id, { payments: [{ paymentMethodId: CASH, amountPaise: 10000 }] }, ADMIN, "ADMIN");
    await expect(refundOrder(order.id, { amountPaise: 20000, reason: "x", refundType: "FULL", paymentMethodId: CASH }, ADMIN, "ADMIN")).rejects.toThrow(ValidationError);
  });
});

describe("Inventory: weighted-average cost and negative stock", () => {
  it("computes weighted average cost across two purchases", async () => {
    const itemId = await makeInventoryItem({ openingQtyBase: 0, costPaisePerBase: 0 });
    // 10 units @ 100paise/unit, then 10 units @ 200paise/unit => avg should be 150
    await withTransaction((session) =>
      recordMovement({ inventoryItemId: itemId, movementType: "PURCHASE", direction: "IN", quantityBase: 10, unitCostPaisePerBase: 100, businessDate: "2020-01-01", userId: ADMIN }, session)
    );
    await withTransaction((session) =>
      recordMovement({ inventoryItemId: itemId, movementType: "PURCHASE", direction: "IN", quantityBase: 10, unitCostPaisePerBase: 200, businessDate: "2020-01-02", userId: ADMIN }, session)
    );
    const item = (await getInventoryItem(itemId))!;
    expect(item.currentQtyBase).toBe(20);
    expect(item.avgCostPaisePerBase).toBe(150);
  });

  it("blocks a consumption that would take stock negative, without an override", async () => {
    const itemId = await makeInventoryItem({ openingQtyBase: 5, costPaisePerBase: 10 });
    await expect(
      withTransaction((session) =>
        recordMovement({ inventoryItemId: itemId, movementType: "SALE_CONSUMPTION", direction: "OUT", quantityBase: 10, businessDate: "2020-01-01", userId: ADMIN }, session)
      )
    ).rejects.toThrow(ValidationError);
    // Stock must be unchanged after the rejected attempt.
    expect((await getInventoryItem(itemId))!.currentQtyBase).toBe(5);
  });

  it("allows negative stock only with an explicit override, and it is audited", async () => {
    const itemId = await makeInventoryItem({ openingQtyBase: 5, costPaisePerBase: 10 });
    const result = await withTransaction((session) =>
      recordMovement(
        {
          inventoryItemId: itemId,
          movementType: "SALE_CONSUMPTION",
          direction: "OUT",
          quantityBase: 10,
          businessDate: "2020-01-01",
          userId: ADMIN,
          allowNegativeStock: true,
          reason: "admin override for test",
        },
        session
      )
    );
    expect(result.wentNegative).toBe(true);
    expect((await getInventoryItem(itemId))!.currentQtyBase).toBe(-5);
  });

  it("computes recipe-based COGS at sale completion using the recipe's ingredient cost", async () => {
    const date = "2020-01-20";
    const { menuItemId, inventoryItemId } = await makeMenuItemWithRecipe({
      priceType: "FULL",
      pricePaise: 19000,
      ingredientQtyBase: 250, // grams
      ingredientCostPaisePerBase: 10.5, // paise/gram => ₹26.25 for 250g, matches the brief's chaap example
      userId: ADMIN,
    });
    const order = await createOrder({ orderType: "DINE_IN", items: [{ menuItemId, priceType: "FULL", quantity: 2 }], businessDate: date }, ADMIN, "ADMIN");
    await completeOrder(order.id, { payments: [{ paymentMethodId: CASH, amountPaise: order.net_total_paise }] }, ADMIN, "ADMIN");

    const full = await getOrderFull(order.id);
    const totalCogs = (full.items ?? []).reduce((s: number, i: any) => s + (i.cogs_paise ?? 0), 0);
    // 2 full plates * 250g * 10.5paise/g = 5250 paise = ₹52.50
    expect(totalCogs).toBe(5250);

    const invAfter = (await getInventoryItem(inventoryItemId))!;
    expect(invAfter.currentQtyBase).toBe(1_000_000 - 500); // opening minus 2*250g consumed
  });
});

describe("Historical price integrity (RULE 5)", () => {
  it("keeps a completed order's price unchanged after the menu price later changes", async () => {
    const { menuItemId } = await makeMenuItemWithRecipe({ priceType: "SINGLE", pricePaise: 10000, ingredientQtyBase: 1, ingredientCostPaisePerBase: 1, userId: ADMIN });
    const order = await createOrder({ orderType: "TAKEAWAY", items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }], businessDate: "2020-01-15" }, ADMIN, "ADMIN");
    expect(order.subtotal_paise).toBe(10000);

    await setMenuPrice(menuItemId, "SINGLE", 99999, ADMIN);
    expect(await getCurrentPrice(menuItemId, "SINGLE")).toBe(99999);

    const full = await getOrderFull(order.id);
    const items = full.items as { unit_price_paise: number }[];
    expect(items[0].unit_price_paise).toBe(10000); // unchanged historical price
  });
});

describe("Daily closing permissions", () => {
  it("blocks MANAGER from writing to an already-closed business day, but allows ADMIN", async () => {
    const MANAGER = await makeUser("MANAGER");
    const date = "2020-04-01";
    // The cash ledger is cumulative since day one (till cash carries forward,
    // it never resets), so earlier tests' transactions are already included —
    // close using whatever the system currently expects, not a hardcoded 0.
    const expected = (await getCashLedgerSummary(date)).expectedCashPaise;
    await openBusinessDay(date, 0, ADMIN);
    await closeDay({ businessDate: date, actualCashPaise: expected, userId: ADMIN });

    await expect(assertBusinessDateWritable(date, "MANAGER")).rejects.toThrow(ForbiddenError);
    await expect(assertBusinessDateWritable(date, "STAFF")).rejects.toThrow(ForbiddenError);
    await expect(assertBusinessDateWritable(date, "ADMIN")).resolves.not.toThrow();
    void MANAGER;
  });

  it("rejects closing with a cash difference unless a reason is given", async () => {
    const date = "2020-04-05";
    await openBusinessDay(date, 0, ADMIN);
    const before = (await getCashLedgerSummary(date)).expectedCashPaise;
    await recordCashTransaction({ businessDate: date, txnType: "SALE", direction: "IN", amountPaise: 1000, userId: ADMIN });
    const expected = (await getCashLedgerSummary(date)).expectedCashPaise;
    expect(expected).toBe(before + 1000);

    await expect(closeDay({ businessDate: date, actualCashPaise: before, userId: ADMIN })).rejects.toThrow(ValidationError);
    // Providing a reason allows it through, and the difference is stored, not silently zeroed.
    const closed = await closeDay({ businessDate: date, actualCashPaise: before, cashDiffReason: "shortage under investigation", userId: ADMIN });
    expect(closed.cash_difference_paise).toBe(-1000);
  });
});

describe("Delivery + COD payment flow", () => {
  async function makeDeliveryOrder(businessDate: string, pricePaise = 50000) {
    const { menuItemId } = await makeMenuItemWithRecipe({
      priceType: "SINGLE",
      pricePaise,
      ingredientQtyBase: 1,
      ingredientCostPaisePerBase: 1,
      userId: ADMIN,
    });
    return createOrder(
      {
        orderType: "DELIVERY",
        customerName: "Rahul Kumar",
        customerPhone: "9876543210",
        deliveryAddress: "BIT Mesra Gate, near XYZ shop",
        items: [{ menuItemId, priceType: "SINGLE", quantity: 1 }],
        businessDate,
      },
      ADMIN,
      "ADMIN"
    );
  }

  it("TEST 1 — COD: blocks delivery while unpaid, then completes and posts the cash ledger entry on collection", async () => {
    const date = "2020-05-01";
    const rider = await makeUser("RIDER");
    const order = await makeDeliveryOrder(date);
    // A rider already exists when the order is created, so it auto-dispatches
    // straight to OUT_FOR_DELIVERY — no kitchen staging, no manual assignment.
    expect(order.status).toBe("OUT_FOR_DELIVERY");
    expect(order.assigned_rider_id).toBe(rider);
    expect(order.payment_status).toBe("UNPAID");

    await expect(markDelivered(order.id, rider, "RIDER")).rejects.toThrow(ValidationError);

    const cashBefore = (await getCashLedgerSummary(date)).expectedCashPaise;
    const paid = await recordPayment(order.id, [{ paymentMethodId: CASH, amountPaise: 50000 }], rider, "RIDER");
    expect(paid.payment_status).toBe("PAID");

    const { order: delivered } = await markDelivered(order.id, rider, "RIDER");
    expect(delivered.status).toBe("COMPLETED");
    expect(delivered.payment_status).toBe("PAID");
    expect((await getCashLedgerSummary(date)).expectedCashPaise).toBe(cashBefore + 50000);
  });

  it("TEST 2 — Online prepaid: nothing left to collect, delivery completes immediately", async () => {
    const date = "2020-05-02";
    const rider = await makeUser("RIDER");
    const order = await makeDeliveryOrder(date);
    // Earlier tests' riders are still in the DB (no reset between tests), so
    // auto-dispatch could pick any of them — assign this test's rider
    // explicitly for a deterministic assertion below.
    await assignRider(order.id, rider, ADMIN);

    const paid = await recordPayment(order.id, [{ paymentMethodId: ONLINE, amountPaise: 50000 }], ADMIN, "ADMIN");
    expect(paid.payment_status).toBe("PAID");

    const { order: delivered } = await markDelivered(order.id, rider, "RIDER");
    expect(delivered.status).toBe("COMPLETED");
  });

  it("TEST 3 — Partial: ₹200 UPI + ₹300 cash reaches PAID and completes", async () => {
    const date = "2020-05-03";
    const rider = await makeUser("RIDER");
    const order = await makeDeliveryOrder(date, 50000);
    await assignRider(order.id, rider, ADMIN);

    const afterOnline = await recordPayment(order.id, [{ paymentMethodId: ONLINE, amountPaise: 20000 }], ADMIN, "ADMIN");
    expect(afterOnline.payment_status).toBe("PARTIAL");

    await expect(markDelivered(order.id, rider, "RIDER")).rejects.toThrow(ValidationError);

    const afterCash = await recordPayment(order.id, [{ paymentMethodId: CASH, amountPaise: 30000 }], rider, "RIDER");
    expect(afterCash.payment_status).toBe("PAID");

    const { order: delivered } = await markDelivered(order.id, rider, "RIDER");
    expect(delivered.status).toBe("COMPLETED");
  });

  it("TEST 4 — Wrong rider: rider B cannot touch rider A's order", async () => {
    const date = "2020-05-04";
    const riderA = await makeUser("RIDER");
    const riderB = await makeUser("RIDER");
    const order = await makeDeliveryOrder(date);
    // Two riders exist, so auto-dispatch could have picked either — assign
    // riderA explicitly so the "wrong rider" check below is deterministic.
    await assignRider(order.id, riderA, ADMIN);

    await expect(recordPayment(order.id, [{ paymentMethodId: CASH, amountPaise: 50000 }], riderB, "RIDER")).rejects.toThrow(ForbiddenError);
    await expect(markDelivered(order.id, riderB, "RIDER")).rejects.toThrow(ForbiddenError);
  });

  it("TEST 5 — COD not collected: cannot mark delivered while unpaid, order stays OUT_FOR_DELIVERY", async () => {
    const date = "2020-05-05";
    const rider = await makeUser("RIDER");
    const order = await makeDeliveryOrder(date);
    expect(order.status).toBe("OUT_FOR_DELIVERY");
    await assignRider(order.id, rider, ADMIN);

    await expect(markDelivered(order.id, rider, "RIDER")).rejects.toThrow(ValidationError);
    expect((await getOrderFull(order.id)).status).toBe("OUT_FOR_DELIVERY");
  });
});
