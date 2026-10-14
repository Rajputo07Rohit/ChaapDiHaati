import { getSetting, setSetting } from "../settings/settings.service";
import { AppError } from "../../utils/errors";

/**
 * AUTO follows the daily opening/closing time, OPEN/CLOSED are manual
 * overrides for "we ran out of stock" / "staying open late" moments. An
 * override sticks until the admin switches back to AUTO.
 */
export type StoreMode = "AUTO" | "OPEN" | "CLOSED";

export interface StoreHours {
  mode: StoreMode;
  openTime: string; // "HH:MM", 24h, Asia/Kolkata
  closeTime: string;
  closedMessage: string;
}

export interface StoreStatus extends StoreHours {
  isOpen: boolean;
  /** Human reason shown to customers when closed. */
  message: string | null;
  /** Next scheduled opening, e.g. "11:00" — null when manually closed with no schedule relevance. */
  opensAt: string | null;
}

const SETTING_KEY = "store_hours";
// 00:00–00:00 means "open all day", so nothing changes until an admin sets hours.
const DEFAULTS: StoreHours = { mode: "AUTO", openTime: "00:00", closeTime: "00:00", closedMessage: "" };

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function istMinutesNow(now: Date): number {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export async function getStoreHours(): Promise<StoreHours> {
  const stored = await getSetting<Partial<StoreHours> | null>(SETTING_KEY, null);
  return { ...DEFAULTS, ...(stored ?? {}) };
}

export async function saveStoreHours(input: StoreHours, userId: string): Promise<void> {
  await setSetting(SETTING_KEY, input, userId);
}

/** Pure — takes `now` so it can be tested without faking the clock. Supports overnight windows (e.g. 18:00–02:00). */
export function computeStoreStatus(hours: StoreHours, now = new Date()): StoreStatus {
  let isOpen: boolean;
  if (hours.mode === "OPEN") isOpen = true;
  else if (hours.mode === "CLOSED") isOpen = false;
  else {
    const cur = istMinutesNow(now);
    const open = toMinutes(hours.openTime);
    const close = toMinutes(hours.closeTime);
    if (open === close) isOpen = true; // same time = open all day
    else isOpen = open < close ? cur >= open && cur < close : cur >= open || cur < close;
  }

  let message: string | null = null;
  if (!isOpen) {
    if (hours.closedMessage.trim()) message = hours.closedMessage.trim();
    else if (hours.mode === "CLOSED") message = "We're not taking orders right now. Please check back soon.";
    else message = `We're closed right now. Orders open at ${hours.openTime}.`;
  }

  return { ...hours, isOpen, message, opensAt: hours.mode === "AUTO" ? hours.openTime : null };
}

export async function getStoreStatus(): Promise<StoreStatus> {
  return computeStoreStatus(await getStoreHours());
}

export async function assertStoreOpen(): Promise<void> {
  const status = await getStoreStatus();
  if (!status.isOpen) throw new AppError(403, status.message ?? "We're not taking orders right now.", "STORE_CLOSED");
}

/**
 * Rumali roti is an accompaniment to the tandoori dishes. It can only be
 * ordered when the cart has an item from Soya Tandoori (Chaap), Paneer
 * Tandoori, Mushroom Tandoori or Momo. Extras, beverages, rolls etc. can be
 * ordered on their own but do NOT unlock rumali. Matched by category name
 * (rumali items live in the shared "Breads" category, so by item name).
 */
const MAIN_CATEGORY_RE = /tandoori|momo/i;

export function assertRumaliHasMain(items: { itemName: string; categoryName: string | null }[]): void {
  const hasRumali = items.some((i) => /rumali/i.test(i.itemName));
  const hasMain = items.some((i) => !/rumali/i.test(i.itemName) && MAIN_CATEGORY_RE.test(i.categoryName ?? ""));
  if (hasRumali && !hasMain) {
    throw new AppError(
      400,
      "Rumali roti can only be ordered with Soya Tandoori, Paneer Tandoori, Mushroom Tandoori or Momo. Please add one of them.",
      "RUMALI_NEEDS_MAIN"
    );
  }
}
