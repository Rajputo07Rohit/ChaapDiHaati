-- Rider role + delivery fields on orders.
-- roles.name has a CHECK constraint limited to the original three roles;
-- SQLite can't alter a CHECK constraint in place, so recreate the table.
-- users.role references roles(name), so foreign key enforcement must be
-- off for the drop/rename (it's back on for every other connection/session
-- via connection.ts; this only affects this one migration script run).
PRAGMA foreign_keys = OFF;

CREATE TABLE roles_new (
  name TEXT PRIMARY KEY CHECK (name IN ('ADMIN','MANAGER','STAFF','RIDER')),
  description TEXT NOT NULL
);
INSERT INTO roles_new SELECT * FROM roles;
DROP TABLE roles;
ALTER TABLE roles_new RENAME TO roles;

INSERT INTO roles (name, description) VALUES ('RIDER', 'Delivery only — no admin/staff access');

PRAGMA foreign_keys = ON;

ALTER TABLE sales_orders ADD COLUMN delivery_address TEXT;
ALTER TABLE sales_orders ADD COLUMN assigned_rider_id TEXT REFERENCES users(id);
ALTER TABLE sales_orders ADD COLUMN delivery_status TEXT
  CHECK (delivery_status IS NULL OR delivery_status IN ('ASSIGNED','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'));

CREATE INDEX idx_orders_rider ON sales_orders(assigned_rider_id);
