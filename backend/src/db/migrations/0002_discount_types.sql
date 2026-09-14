-- Adds percentage-or-flat discounts at both the order level and the
-- individual line-item level. discount_paise on sales_orders remains the
-- ORDER-LEVEL discount only; item_discount_total_paise is the sum of all
-- per-item discounts, tracked separately so both are independently visible
-- and reports can report the true total given away (their sum).

ALTER TABLE sales_orders ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'FLAT' CHECK (discount_type IN ('FLAT','PERCENTAGE'));
ALTER TABLE sales_orders ADD COLUMN discount_value REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN item_discount_total_paise INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sales_order_items ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_order_items ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'FLAT' CHECK (discount_type IN ('FLAT','PERCENTAGE'));
ALTER TABLE sales_order_items ADD COLUMN discount_value REAL NOT NULL DEFAULT 0;
ALTER TABLE sales_order_items ADD COLUMN line_net_paise INTEGER NOT NULL DEFAULT 0;

-- Backfill line_net_paise for any pre-existing rows (none yet in a fresh
-- install, but keeps the migration correct for an already-seeded database).
UPDATE sales_order_items SET line_net_paise = line_subtotal_paise WHERE line_net_paise = 0;

ALTER TABLE discounts ADD COLUMN sales_order_item_id TEXT REFERENCES sales_order_items(id);
ALTER TABLE discounts ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'FLAT' CHECK (discount_type IN ('FLAT','PERCENTAGE'));
ALTER TABLE discounts ADD COLUMN discount_value REAL NOT NULL DEFAULT 0;
