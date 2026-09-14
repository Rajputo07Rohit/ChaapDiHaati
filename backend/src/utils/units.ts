import { ValidationError } from "./errors";

const WEIGHT: Record<string, number> = { g: 1, kg: 1000 };
const VOLUME: Record<string, number> = { ml: 1, L: 1000 };

/** Converts a quantity between compatible units (kg<->g, L<->ml). Same unit is a no-op. */
export function convertQuantity(fromUnit: string, toUnit: string, qty: number): number {
  if (fromUnit === toUnit) return qty;
  if (fromUnit in WEIGHT && toUnit in WEIGHT) {
    return (qty * WEIGHT[fromUnit]) / WEIGHT[toUnit];
  }
  if (fromUnit in VOLUME && toUnit in VOLUME) {
    return (qty * VOLUME[fromUnit]) / VOLUME[toUnit];
  }
  throw new ValidationError(
    `Cannot convert ${fromUnit} to ${toUnit}. These units are not compatible for this item.`
  );
}
