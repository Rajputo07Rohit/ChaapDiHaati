/** All money crosses the wire as integer paise. These are the ONLY functions
 * allowed to convert between paise and rupees for display/input purposes. */

export function formatPaise(paise: number | null | undefined): string {
  if (paise == null || Number.isNaN(paise)) return "—";
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const cents = abs % 100;
  const withCommas = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}₹${withCommas}${cents ? "." + cents.toString().padStart(2, "0") : ""}`;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise == null) return "";
  return (paise / 100).toString();
}
