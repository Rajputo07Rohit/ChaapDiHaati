-- Discount reason is no longer required (owner decision: staff shouldn't be
-- blocked from applying a quick discount for lack of a typed reason). SQLite
-- can't drop a NOT NULL constraint in place, so rebuild the table.

CREATE TABLE discounts_new (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  sales_order_item_id TEXT REFERENCES sales_order_items(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  discount_type TEXT NOT NULL DEFAULT 'FLAT' CHECK (discount_type IN ('FLAT','PERCENTAGE')),
  discount_value REAL NOT NULL DEFAULT 0,
  reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO discounts_new (id, sales_order_id, sales_order_item_id, amount_paise, discount_type, discount_value, reason, created_by, created_at)
SELECT id, sales_order_id, sales_order_item_id, amount_paise, discount_type, discount_value, reason, created_by, created_at FROM discounts;

DROP TABLE discounts;
ALTER TABLE discounts_new RENAME TO discounts;

CREATE INDEX idx_discounts_order ON discounts(sales_order_id);
