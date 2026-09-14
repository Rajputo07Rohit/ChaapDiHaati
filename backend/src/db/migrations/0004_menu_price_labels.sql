-- Some items sell in two tiers that aren't "half/full portions" — e.g. momo
-- sells as 5-piece vs 8-piece. The HALF/FULL price_type slots are reused for
-- this (same underlying mechanism), but the UI needs the real label ("5 pc" /
-- "8 pc") instead of always showing "Half"/"Full".
ALTER TABLE menu_items ADD COLUMN half_label TEXT NOT NULL DEFAULT 'Half';
ALTER TABLE menu_items ADD COLUMN full_label TEXT NOT NULL DEFAULT 'Full';
