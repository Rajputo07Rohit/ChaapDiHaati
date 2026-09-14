-- Per-item daily consumption counts transcribed from the owner's paper
-- register (4-12 Sept 2026), predating the app's own order-by-order sales
-- tracking. Kept separate from sales_order_items (which needs a real order,
-- integer quantities, and a single price_type per line) because register
-- entries are half-plate/full-plate fractions rolled up per day, not
-- individual transactions.
CREATE TABLE historical_item_sales (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  category TEXT NOT NULL,
  item_name TEXT NOT NULL,
  full_count REAL,
  half_count REAL,
  qty_equivalent REAL NOT NULL CHECK (qty_equivalent > 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_hist_item_sales_date ON historical_item_sales(business_date);
CREATE INDEX idx_hist_item_sales_item ON historical_item_sales(item_name);
