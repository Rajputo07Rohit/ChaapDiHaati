/** yyyy-mm-dd (business_date / a native date input's value) -> dd/mm/yyyy for display. */
export function toDdMmYyyy(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
