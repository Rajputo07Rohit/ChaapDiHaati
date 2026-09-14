import { db } from "../db/connection";

const START_VALUES: Record<string, number> = {
  order_number: 1001,
  purchase_number: 1,
};

export function nextSequence(name: string): number {
  const row = db.prepare("SELECT next_value FROM sequences WHERE name = ?").get(name) as
    | { next_value: number }
    | undefined;

  if (!row) {
    const start = START_VALUES[name] ?? 1;
    db.prepare("INSERT INTO sequences (name, next_value) VALUES (?, ?)").run(name, start + 1);
    return start;
  }

  db.prepare("UPDATE sequences SET next_value = next_value + 1 WHERE name = ?").run(name);
  return row.next_value;
}

export function nextPurchaseNumber(): string {
  const n = nextSequence("purchase_number");
  return `PO-${String(n).padStart(5, "0")}`;
}
