-- Chaap Di Haati RMS — initial schema
-- All money columns are INTEGER paise (₹1 = 100 paise). Never store money as REAL.
-- All inventory quantities are stored normalized into base units (g, ml, piece) as REAL.

PRAGMA foreign_keys = ON;

-- ============================================================
-- USERS & ROLES
-- ============================================================
CREATE TABLE roles (
  name TEXT PRIMARY KEY CHECK (name IN ('ADMIN','MANAGER','STAFF')),
  description TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES roles(name),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- SETTINGS
-- ============================================================
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- PAYMENT METHODS (admin-configurable, not hardcoded in frontend)
-- ============================================================
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('CASH','ONLINE')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- MENU
-- ============================================================
CREATE TABLE menu_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE menu_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES menu_categories(id),
  name TEXT NOT NULL,
  has_half INTEGER NOT NULL DEFAULT 0 CHECK (has_half IN (0,1)),
  has_full INTEGER NOT NULL DEFAULT 0 CHECK (has_full IN (0,1)),
  has_single INTEGER NOT NULL DEFAULT 0 CHECK (has_single IN (0,1)),
  unit_label TEXT NOT NULL DEFAULT 'plate',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','UNAVAILABLE','DISCONTINUED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);
CREATE INDEX idx_menu_items_status ON menu_items(status);

-- Price history: current price = row with effective_to IS NULL for (menu_item_id, price_type)
CREATE TABLE menu_prices (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  price_type TEXT NOT NULL CHECK (price_type IN ('HALF','FULL','SINGLE')),
  price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
  effective_from TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  effective_to TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_menu_prices_lookup ON menu_prices(menu_item_id, price_type, effective_to);

-- ============================================================
-- INVENTORY
-- ============================================================
-- Canonical unit conversions. "packet/tin/box/jar/roll/plate" are custom
-- per-item (a "packet" of Cream ≠ a "packet" of Kitchen King), so their
-- conversion factor lives on inventory_items.purchase_to_base_factor instead.
CREATE TABLE inventory_units (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('WEIGHT','VOLUME','COUNT')),
  base_code TEXT NOT NULL,
  factor_to_base REAL NOT NULL
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('RAW_MATERIAL','PACKAGING','DISPOSABLE','OTHER')),
  base_unit TEXT NOT NULL CHECK (base_unit IN ('g','ml','piece')),
  purchase_unit TEXT NOT NULL,
  purchase_to_base_factor REAL NOT NULL CHECK (purchase_to_base_factor > 0),
  current_qty_base REAL NOT NULL DEFAULT 0,
  min_stock_base REAL NOT NULL DEFAULT 0,
  reorder_level_base REAL NOT NULL DEFAULT 0,
  avg_cost_paise_per_base REAL NOT NULL DEFAULT 0,
  last_purchase_cost_paise_per_base REAL,
  supplier_id TEXT REFERENCES suppliers(id),
  price_pending INTEGER NOT NULL DEFAULT 0 CHECK (price_pending IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_inventory_items_category ON inventory_items(category);
CREATE INDEX idx_inventory_items_active ON inventory_items(active);

-- Stock is derived from movements; current_qty_base on inventory_items is a
-- maintained cache updated transactionally alongside each movement insert.
CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN
    ('PURCHASE','SALE_CONSUMPTION','WASTE','SPOILAGE','DAMAGE','STOCK_ADJUSTMENT','RETURN','TRANSFER','OPENING_STOCK')),
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  quantity_base REAL NOT NULL CHECK (quantity_base >= 0),
  unit_cost_paise_per_base REAL,
  total_cost_paise INTEGER,
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT,
  business_date TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_inv_mov_item ON inventory_movements(inventory_item_id);
CREATE INDEX idx_inv_mov_type ON inventory_movements(movement_type);
CREATE INDEX idx_inv_mov_date ON inventory_movements(business_date);
CREATE INDEX idx_inv_mov_reference ON inventory_movements(reference_type, reference_id);

CREATE TABLE wastage_records (
  id TEXT PRIMARY KEY,
  inventory_movement_id TEXT NOT NULL REFERENCES inventory_movements(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  quantity_base REAL NOT NULL,
  total_cost_paise INTEGER NOT NULL,
  wastage_type TEXT NOT NULL CHECK (wastage_type IN ('WASTE','SPOILAGE','DAMAGE')),
  reason TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_wastage_date ON wastage_records(business_date);

-- ============================================================
-- PURCHASES
-- ============================================================
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT REFERENCES suppliers(id),
  invoice_number TEXT,
  business_date TEXT NOT NULL,
  payment_method_id TEXT REFERENCES payment_methods(id),
  payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PAID','CREDIT','PARTIAL')),
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  amount_paid_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','VOID')),
  void_reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_purchase_date ON purchase_orders(business_date);
CREATE INDEX idx_purchase_status ON purchase_orders(payment_status);

CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  purchase_unit TEXT NOT NULL,
  quantity_base REAL NOT NULL,
  rate_paise INTEGER,
  amount_paise INTEGER,
  price_pending INTEGER NOT NULL DEFAULT 0 CHECK (price_pending IN (0,1)),
  notes TEXT
);
CREATE INDEX idx_purchase_items_po ON purchase_items(purchase_order_id);
CREATE INDEX idx_purchase_items_item ON purchase_items(inventory_item_id);

-- ============================================================
-- RECIPES
-- ============================================================
CREATE TABLE recipe_versions (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  price_type TEXT NOT NULL CHECK (price_type IN ('HALF','FULL','SINGLE')),
  version INTEGER NOT NULL,
  effective_from TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  effective_to TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_recipe_lookup ON recipe_versions(menu_item_id, price_type, effective_to);

CREATE TABLE recipe_items (
  id TEXT PRIMARY KEY,
  recipe_version_id TEXT NOT NULL REFERENCES recipe_versions(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  quantity_base REAL NOT NULL CHECK (quantity_base > 0),
  wastage_pct REAL NOT NULL DEFAULT 0,
  yield_pct REAL NOT NULL DEFAULT 100,
  optional INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0,1))
);
CREATE INDEX idx_recipe_items_version ON recipe_items(recipe_version_id);

-- ============================================================
-- SALES / ORDERS
-- ============================================================
CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN','TAKEAWAY','DELIVERY','ONLINE')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','CONFIRMED','PREPARING','READY','COMPLETED','CANCELLED','REFUNDED')),
  kitchen_status TEXT NOT NULL DEFAULT 'NOT_SENT' CHECK (kitchen_status IN
    ('NOT_SENT','PREPARING','READY','SERVED')),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  net_total_paise INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  notes TEXT,
  stock_override INTEGER NOT NULL DEFAULT 0 CHECK (stock_override IN (0,1)),
  created_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_orders_date ON sales_orders(business_date);
CREATE INDEX idx_orders_status ON sales_orders(status);
CREATE INDEX idx_orders_kitchen_status ON sales_orders(kitchen_status);
CREATE INDEX idx_orders_number ON sales_orders(order_number);

CREATE TABLE sales_order_items (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  item_name_snapshot TEXT NOT NULL,
  price_type TEXT NOT NULL CHECK (price_type IN ('HALF','FULL','SINGLE')),
  unit_price_paise INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_subtotal_paise INTEGER NOT NULL,
  recipe_version_id TEXT REFERENCES recipe_versions(id),
  cogs_paise INTEGER,
  special_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_order_items_order ON sales_order_items(sales_order_id);
CREATE INDEX idx_order_items_menu_item ON sales_order_items(menu_item_id);

CREATE TABLE discounts (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  reason TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','VOIDED')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_order ON payments(sales_order_id);
CREATE INDEX idx_payments_method ON payments(payment_method_id);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  refund_type TEXT NOT NULL CHECK (refund_type IN ('FULL','PARTIAL')),
  reason TEXT NOT NULL,
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_refunds_order ON refunds(sales_order_id);

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN
    ('Milk','Curd','Vegetables','Gas','Coal','Electricity','Repair','Maintenance',
     'Staff','Transport','Cleaning','Packaging','Miscellaneous','Other')),
  description TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  vendor TEXT,
  receipt_ref TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED','VOID')),
  void_reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_expenses_date ON expenses(business_date);
CREATE INDEX idx_expenses_category ON expenses(category);

-- ============================================================
-- CASH LEDGER
-- ============================================================
CREATE TABLE cash_transactions (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN
    ('OPENING','SALE','EXPENSE','PURCHASE','WITHDRAWAL','DEPOSIT','ADJUSTMENT','REFUND')),
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cash_date ON cash_transactions(business_date);
CREATE INDEX idx_cash_type ON cash_transactions(txn_type);

-- ============================================================
-- BANK LEDGER
-- ============================================================
CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  txn_type TEXT NOT NULL CHECK (txn_type IN ('CREDIT','DEBIT')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  description TEXT NOT NULL,
  reference TEXT,
  category TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (category IN
    ('BUSINESS','PERSONAL','TRANSFER','SUPPLIER','SALARY','REPAIR','UNKNOWN')),
  payment_method_id TEXT REFERENCES payment_methods(id),
  linked_reference_type TEXT,
  linked_reference_id TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0 CHECK (reconciled IN (0,1)),
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bank_date ON bank_transactions(business_date);
CREATE INDEX idx_bank_reconciled ON bank_transactions(reconciled);
CREATE INDEX idx_bank_category ON bank_transactions(category);

-- ============================================================
-- DAILY CLOSING
-- ============================================================
CREATE TABLE daily_closings (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opening_cash_paise INTEGER NOT NULL DEFAULT 0,
  gross_sales_paise INTEGER,
  discounts_paise INTEGER,
  net_sales_paise INTEGER,
  cogs_paise INTEGER,
  gross_profit_paise INTEGER,
  expenses_paise INTEGER,
  net_profit_paise INTEGER,
  expected_cash_paise INTEGER,
  actual_cash_paise INTEGER,
  cash_difference_paise INTEGER,
  cash_diff_reason TEXT,
  bank_balance_paise INTEGER,
  stock_value_paise INTEGER,
  opened_by TEXT REFERENCES users(id),
  closed_by TEXT REFERENCES users(id),
  closed_at TEXT,
  reopened_by TEXT REFERENCES users(id),
  reopened_at TEXT,
  reopen_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_closings_date ON daily_closings(business_date);
CREATE INDEX idx_closings_status ON daily_closings(status);

-- ============================================================
-- STOCK COUNT
-- ============================================================
CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','COMPLETED')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE INDEX idx_stock_counts_date ON stock_counts(business_date);

CREATE TABLE stock_count_items (
  id TEXT PRIMARY KEY,
  stock_count_id TEXT NOT NULL REFERENCES stock_counts(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  system_qty_base REAL NOT NULL,
  physical_qty_base REAL,
  difference_base REAL,
  unit_cost_paise_per_base REAL,
  estimated_value_diff_paise INTEGER,
  reason TEXT CHECK (reason IN ('WASTE','SPILLAGE','UNRECORDED_CONSUMPTION','THEFT','COUNTING_ERROR','OTHER')),
  notes TEXT
);
CREATE INDEX idx_stock_count_items_count ON stock_count_items(stock_count_id);

-- ============================================================
-- STAFF (payroll records — distinct from login users)
-- ============================================================
CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  salary_paise INTEGER NOT NULL CHECK (salary_paise >= 0),
  salary_method TEXT NOT NULL DEFAULT 'FIXED_30' CHECK (salary_method IN
    ('CALENDAR_DAY','FIXED_30','WORKING_26','CUSTOM')),
  custom_days INTEGER,
  joining_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- AUDIT LOG (append-only; no UPDATE/DELETE exposed via API)
-- ============================================================
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_date ON audit_logs(created_at);

-- ============================================================
-- SEQUENCES (order numbers, purchase numbers)
-- ============================================================
CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1
);
