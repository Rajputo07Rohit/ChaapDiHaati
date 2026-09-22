export type Role = "ADMIN" | "MANAGER" | "STAFF" | "RIDER";

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export type PriceType = "HALF" | "FULL" | "SINGLE";
export type DiscountType = "FLAT" | "PERCENTAGE";

export interface MenuPrice {
  price_type: PriceType;
  price_paise: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  has_half: number;
  has_full: number;
  has_single: number;
  unit_label: string;
  half_label: string;
  full_label: string;
  status: "ACTIVE" | "UNAVAILABLE" | "DISCONTINUED";
  prices: MenuPrice[];
}

export interface MenuCategory {
  id: string;
  name: string;
  sort_order: number;
  items: MenuItem[];
}

export interface DiscountRule {
  id: string;
  name: string;
  menuItemIds: string[];
  categoryIds: string[];
  discountType: DiscountType;
  discountValue: number;
  active: boolean;
  createdAt: string;
}

export type StockStatus = "OUT_OF_STOCK" | "CRITICAL" | "LOW" | "HEALTHY";

export interface InventoryItem {
  id: string;
  name: string;
  category: "RAW_MATERIAL" | "PACKAGING" | "DISPOSABLE" | "OTHER";
  base_unit: string;
  purchase_unit: string;
  purchase_to_base_factor: number;
  current_qty_base: number;
  min_stock_base: number;
  reorder_level_base: number;
  avg_cost_paise_per_base: number;
  last_purchase_cost_paise_per_base: number | null;
  price_pending: number;
  active: number;
  stockStatus: StockStatus;
}

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
export type OrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";

export interface SalesOrderItem {
  id: string;
  menu_item_id: string;
  item_name_snapshot: string;
  price_type: PriceType;
  unit_price_paise: number;
  quantity: number;
  line_subtotal_paise: number;
  discount_paise: number;
  discount_type: DiscountType;
  discount_value: number;
  line_net_paise: number;
  cogs_paise: number | null;
  special_instructions: string | null;
  status: string;
}

export interface Payment {
  id: string;
  payment_method_id: string;
  payment_method_name: string;
  payment_method_type: "CASH" | "ONLINE";
  amount_paise: number;
}

export interface SalesOrder {
  id: string;
  order_number: number;
  business_date: string;
  order_type: OrderType;
  status: OrderStatus;
  payment_status: PaymentStatus;
  kitchen_status: "PENDING" | "READY";
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  assigned_rider_id: string | null;
  delivered_at: string | null;
  subtotal_paise: number;
  discount_paise: number;
  discount_type: DiscountType;
  discount_value: number;
  item_discount_total_paise: number;
  discount_reason: string | null;
  net_total_paise: number;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
  items?: SalesOrderItem[];
  payments?: Payment[];
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: "CASH" | "ONLINE";
  active: number;
  sort_order: number;
}

export interface BusinessProfile {
  businessName: string;
  tagline: string;
  address: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string | null;
}

export interface PurchaseOrder {
  id: string;
  purchase_number: string;
  supplier_id: string | null;
  invoice_number: string | null;
  business_date: string;
  payment_status: string;
  subtotal_paise: number;
  tax_paise: number;
  discount_paise: number;
  total_paise: number;
  amount_paid_paise: number;
  status: string;
  void_reason?: string | null;
  notes: string | null;
}

export interface PurchaseItem {
  id: string;
  purchase_order_id: string;
  inventory_item_id: string;
  item_name: string;
  quantity: number;
  purchase_unit: string;
  quantity_base: number;
  rate_paise: number | null;
  amount_paise: number | null;
  price_pending: number;
  notes: string | null;
}

export interface Expense {
  id: string;
  business_date: string;
  category: string;
  description: string;
  amount_paise: number;
  payment_method_id: string;
  payment_method_name?: string;
  vendor: string | null;
  status: string;
  void_reason?: string | null;
}

export interface DashboardData {
  today: {
    grossSalesPaise: number;
    discountsPaise: number;
    netSalesPaise: number;
    cashSalesPaise: number;
    onlineSalesPaise: number;
    orderCount: number;
    avgOrderValuePaise: number;
    cogsPaise: number;
    grossProfitPaise: number;
    expensesPaise: number;
    netProfitPaise: number;
    cashAvailablePaise: number;
    bankLedgerBalancePaise: number;
    bankReconciliation:
      | { hasStatement: false; reconciliationPending: true }
      | {
          hasStatement: true;
          statementDate: string;
          statementBalancePaise: number;
          ledgerBalanceAsOfStatementPaise: number;
          differencePaise: number;
          reconciliationPending: boolean;
        };
    lowStockCount: number;
    outOfStockCount: number;
  };
  last7Days: {
    date: string;
    netSalesPaise: number;
    ordersCount: number;
    cashPaise: number;
    onlinePaise: number;
    grossProfitPaise: number;
    netProfitPaise: number;
  }[];
  mtd: {
    salesPaise: number;
    expensesPaise: number;
    cogsPaise: number;
    grossProfitPaise: number;
    netProfitPaise: number;
  };
  stockValuePaise: number;
  lowStockItems: InventoryItem[];
}

export interface DailyClosing {
  id: string;
  business_date: string;
  status: "OPEN" | "CLOSED";
  opening_cash_paise: number;
  gross_sales_paise: number | null;
  discounts_paise: number | null;
  net_sales_paise: number | null;
  cogs_paise: number | null;
  gross_profit_paise: number | null;
  expenses_paise: number | null;
  net_profit_paise: number | null;
  expected_cash_paise: number | null;
  actual_cash_paise: number | null;
  cash_difference_paise: number | null;
  cash_diff_reason: string | null;
  bank_balance_paise: number | null;
  stock_value_paise: number | null;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  username?: string;
  full_name?: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  created_at: string;
}
