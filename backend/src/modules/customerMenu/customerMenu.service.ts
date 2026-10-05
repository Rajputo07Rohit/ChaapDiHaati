import { listMenu } from "../menu/menu.service";

// Internal/back-of-house categories that exist for staff POS use (e.g. a
// packaging-charge line item) but aren't real menu items — never shown to
// customers self-ordering.
const INTERNAL_CATEGORY_NAMES = new Set(["Packaging"]);

/**
 * Public menu: listMenu() already excludes DISCONTINUED items at the query
 * level. ACTIVE and UNAVAILABLE items both pass through here — the
 * customer app renders UNAVAILABLE ones disabled ("Currently unavailable")
 * instead of hiding them, so customers know an item exists but can't be
 * ordered right now.
 */
export async function listPublicMenu() {
  const categories = await listMenu();
  return categories.filter((cat) => !INTERNAL_CATEGORY_NAMES.has(cat.name));
}
