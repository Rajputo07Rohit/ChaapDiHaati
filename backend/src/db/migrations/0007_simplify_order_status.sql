-- Collapses the old kitchen_status + delivery_status side-tracks into the
-- single `status` column (now including OUT_FOR_DELIVERY, DELIVERED), and
-- adds an independent `payment_status` so a delivery order can move through
-- prep/dispatch while still unpaid, with payment collected as its own step.
-- SQLite can't alter a CHECK constraint or drop a column's constraint in
-- place, so the table is rebuilt (same technique as 0006_rider.sql).
PRAGMA foreign_keys = OFF;

CREATE TABLE sales_orders_new (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('DINE_IN','TAKEAWAY','DELIVERY','ONLINE')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','CONFIRMED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCELLED','REFUNDED')),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PARTIAL','PAID','REFUNDED')),
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  assigned_rider_id TEXT REFERENCES users(id),
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'FLAT' CHECK (discount_type IN ('FLAT','PERCENTAGE')),
  discount_value REAL NOT NULL DEFAULT 0,
  item_discount_total_paise INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  net_total_paise INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  notes TEXT,
  stock_override INTEGER NOT NULL DEFAULT 0 CHECK (stock_override IN (0,1)),
  created_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  delivered_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO sales_orders_new
  (id, order_number, business_date, order_type, status, payment_status,
   customer_name, customer_phone, delivery_address, assigned_rider_id,
   subtotal_paise, discount_paise, discount_type, discount_value,
   item_discount_total_paise, discount_reason, net_total_paise,
   cancel_reason, notes, stock_override, created_by,
   confirmed_at, delivered_at, completed_at, cancelled_at, created_at, updated_at)
SELECT
  id, order_number, business_date, order_type,
  CASE
    WHEN status NOT IN ('COMPLETED','CANCELLED','REFUNDED') AND delivery_status = 'OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY'
    WHEN status NOT IN ('COMPLETED','CANCELLED','REFUNDED') AND delivery_status = 'DELIVERED' THEN 'DELIVERED'
    ELSE status
  END,
  CASE
    WHEN status = 'COMPLETED' THEN 'PAID'
    WHEN status = 'REFUNDED' THEN 'REFUNDED'
    ELSE 'UNPAID'
  END,
  customer_name, customer_phone, delivery_address, assigned_rider_id,
  subtotal_paise, discount_paise, discount_type, discount_value,
  item_discount_total_paise, discount_reason, net_total_paise,
  cancel_reason, notes, stock_override, created_by,
  confirmed_at, NULL, completed_at, cancelled_at, created_at, updated_at
FROM sales_orders;

DROP TABLE sales_orders;
ALTER TABLE sales_orders_new RENAME TO sales_orders;

CREATE INDEX idx_orders_date ON sales_orders(business_date);
CREATE INDEX idx_orders_status ON sales_orders(status);
CREATE INDEX idx_orders_number ON sales_orders(order_number);
CREATE INDEX idx_orders_rider ON sales_orders(assigned_rider_id);

PRAGMA foreign_keys = ON;
