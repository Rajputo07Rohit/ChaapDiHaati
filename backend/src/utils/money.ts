/**
 * All money is handled as INTEGER paise. Never use floating-point for money.
 * rupeesToPaise/paiseToRupees are the ONLY places allowed to cross the
 * rupee/paise boundary, and only for display or user-input parsing.
 */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const cents = abs % 100;
  const withCommas = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₹${withCommas}.${cents.toString().padStart(2, "0")}`;
}

export function addPaise(...values: (number | null | undefined)[]): number {
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

export function isValidPaise(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}
