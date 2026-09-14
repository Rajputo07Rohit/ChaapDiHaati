/**
 * Formats a base-unit quantity (g / ml / piece — always stored in base units
 * internally for calculation precision) into the mixed kg+g / L+ml display
 * a restaurant actually reads off a shelf, e.g. "3 kg 180 g" rather than
 * "3180 g" or "3.18 kg".
 */
export function formatQty(qtyBase: number, baseUnit: string): string {
  if (baseUnit === "g") return formatMixed(qtyBase, 1000, "kg", "g");
  if (baseUnit === "ml") return formatMixed(qtyBase, 1000, "L", "ml");
  return `${trimNumber(qtyBase)} ${qtyBase === 1 ? "piece" : "pieces"}`;
}

/** Short form for tight spaces (tables) — same mixed units, shorter piece label. */
export function formatQtyShort(qtyBase: number, baseUnit: string): string {
  if (baseUnit === "g") return formatMixed(qtyBase, 1000, "kg", "g");
  if (baseUnit === "ml") return formatMixed(qtyBase, 1000, "L", "ml");
  return `${trimNumber(qtyBase)} pc`;
}

function formatMixed(qty: number, factor: number, bigUnit: string, smallUnit: string): string {
  const sign = qty < 0 ? "-" : "";
  const abs = Math.abs(qty);
  const bigPart = Math.floor(abs / factor);
  const smallPart = abs - bigPart * factor;

  if (bigPart === 0) return `${sign}${trimNumber(smallPart)} ${smallUnit}`;
  if (smallPart < 0.05) return `${sign}${bigPart} ${bigUnit}`; // ignore sub-gram/ml rounding noise
  return `${sign}${bigPart} ${bigUnit} ${trimNumber(smallPart)} ${smallUnit}`;
}

/** The unit a cost-per-base-unit figure should be shown against, matching formatQty's units. */
export function displayUnitFor(baseUnit: string): string {
  if (baseUnit === "g") return "kg";
  if (baseUnit === "ml") return "L";
  return "piece";
}

/** Converts a paise-per-base-unit cost (e.g. paise/g) to paise-per-display-unit (paise/kg), for readability. */
export function costPerDisplayUnit(costPaisePerBase: number, baseUnit: string): number {
  if (baseUnit === "g" || baseUnit === "ml") return costPaisePerBase * 1000;
  return costPaisePerBase;
}

/** Inverse of displayUnitFor's conversion — turns a quantity typed in kg/L/piece back into base units (g/ml/piece) for the API. */
export function toBaseFromDisplay(qtyDisplay: number, baseUnit: string): number {
  if (baseUnit === "g" || baseUnit === "ml") return qtyDisplay * 1000;
  return qtyDisplay;
}

/** Inverse of costPerDisplayUnit — turns a paise-per-kg/L/piece cost back into paise-per-base-unit for the API. */
export function costPerBaseFromDisplay(costPaisePerDisplay: number, baseUnit: string): number {
  if (baseUnit === "g" || baseUnit === "ml") return costPaisePerDisplay / 1000;
  return costPaisePerDisplay;
}

function trimNumber(n: number): string {
  // Up to 2 decimals, no trailing zeros (e.g. 4.850 -> "4.85", 400.0 -> "400").
  return Number(n.toFixed(2)).toString();
}
