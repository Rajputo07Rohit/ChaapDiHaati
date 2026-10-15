import { getSetting, setSetting } from "../settings/settings.service";
import { AppError } from "../../utils/errors";

/**
 * AUTO follows the weekly opening/closing schedule, OPEN/CLOSED are manual
 * overrides for "we ran out of stock" / "staying open late" moments. An
 * override sticks until the admin switches back to AUTO.
 */
export type StoreMode = "AUTO" | "OPEN" | "CLOSED";

export interface DayHours {
  open: boolean; // false = closed all day
  openTime: string; // "HH:MM", 24h, Asia/Kolkata
  closeTime: string; // earlier than openTime = closes after midnight; equal = open all day
}

export interface StoreHours {
  mode: StoreMode;
  /** Used for every day when `days` isn't set (older saved settings). */
  openTime: string;
  closeTime: string;
  closedMessage: string;
  /** Per-day schedule, index 0 = Sunday … 6 = Saturday. */
  days?: DayHours[];
}

export interface WeekSummaryRow {
  label: string; // "Mon–Fri"
  hours: string; // "3 PM – 10:30 PM" | "Closed"
}

export interface StoreStatus extends StoreHours {
  isOpen: boolean;
  /** Human reason shown to customers when closed. */
  message: string | null;
  /** Next scheduled opening ("HH:MM") while closed on schedule — null otherwise. */
  opensAt: string | null;
  /** Seconds until the schedule flips open<->closed. Null when a manual override is on or there's nothing to count down to. */
  changesInSeconds: number | null;
  /** "HH:MM" of that flip (the next close while open, the next open while closed). */
  nextChangeTime: string | null;
  /** Today's window, for display. */
  todayOpenTime: string;
  todayCloseTime: string;
  weekSummary: WeekSummaryRow[];
}

const SETTING_KEY = "store_hours";
// 00:00–00:00 means "open all day", so nothing changes until an admin sets hours.
const DEFAULTS: StoreHours = { mode: "AUTO", openTime: "00:00", closeTime: "00:00", closedMessage: "" };

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** IST "wall clock" for an instant: weekday (0=Sun), minutes since midnight, seconds. */
function istParts(now: Date) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return { day: ist.getUTCDay(), minute: ist.getUTCHours() * 60 + ist.getUTCMinutes(), seconds: ist.getUTCSeconds() };
}

// Customer apps poll the status every few seconds, so keep a very short cache
// to spare the database. Saving clears it immediately; the TTL only matters if
// the setting is changed some other way or by another server instance.
const CACHE_TTL_MS = 3000;
let cache: { value: StoreHours; at: number } | null = null;

export async function getStoreHours(): Promise<StoreHours> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const stored = await getSetting<Partial<StoreHours> | null>(SETTING_KEY, null);
  const value = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  if (!["AUTO", "OPEN", "CLOSED"].includes(value.mode)) value.mode = "AUTO";
  if (typeof value.closedMessage !== "string") value.closedMessage = "";
  cache = { value, at: Date.now() };
  return value;
}

export async function saveStoreHours(input: StoreHours, userId: string): Promise<void> {
  await setSetting(SETTING_KEY, input, userId);
  cache = null;
}

const validDay = (d: unknown): d is DayHours =>
  !!d && typeof (d as DayHours).open === "boolean" && TIME_RE.test(String((d as DayHours).openTime)) && TIME_RE.test(String((d as DayHours).closeTime));

function effectiveDays(hours: StoreHours): DayHours[] {
  if (Array.isArray(hours.days) && hours.days.length === 7 && hours.days.every(validDay)) return hours.days;
  if (!TIME_RE.test(hours.openTime) || !TIME_RE.test(hours.closeTime)) return Array.from({ length: 7 }, () => ({ open: true, openTime: "00:00", closeTime: "00:00" }));
  return Array.from({ length: 7 }, () => ({ open: true, openTime: hours.openTime, closeTime: hours.closeTime }));
}

/** Is the schedule open at this weekday/minute? Includes the after-midnight tail of the previous day's late close. */
function isOpenAt(days: DayHours[], day: number, minute: number): boolean {
  const today = days[day];
  let open = false;
  if (today.open) {
    const o = toMinutes(today.openTime);
    const c = toMinutes(today.closeTime);
    open = o === c ? true : o < c ? minute >= o && minute < c : minute >= o;
  }
  if (open) return true;
  const yesterday = days[(day + 6) % 7];
  return yesterday.open && toMinutes(yesterday.openTime) > toMinutes(yesterday.closeTime) && minute < toMinutes(yesterday.closeTime);
}

function summarizeWeek(days: DayHours[]): WeekSummaryRow[] {
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
  const text = (d: DayHours) =>
    !d.open ? "Closed" : d.openTime === d.closeTime ? "Open 24 hours" : `${fmt12(d.openTime)} – ${fmt12(d.closeTime)}`;
  const rows: { from: number; to: number; hours: string }[] = [];
  order.forEach((dayIdx, pos) => {
    const hours = text(days[dayIdx]);
    const last = rows[rows.length - 1];
    if (last && last.hours === hours) last.to = pos;
    else rows.push({ from: pos, to: pos, hours });
  });
  return rows.map((r) => ({
    label: r.from === r.to ? DAY_SHORT[order[r.from]] : `${DAY_SHORT[order[r.from]]}–${DAY_SHORT[order[r.to]]}`,
    hours: r.hours,
  }));
}

/** Pure — takes `now` so it can be tested without faking the clock. Supports per-day hours and overnight windows (e.g. 18:00–02:00). */
export function computeStoreStatus(hours: StoreHours, now = new Date()): StoreStatus {
  const days = effectiveDays(hours);
  const { day, minute, seconds } = istParts(now);
  const scheduleOpen = isOpenAt(days, day, minute);
  const isOpen = hours.mode === "OPEN" ? true : hours.mode === "CLOSED" ? false : scheduleOpen;

  // Next time the schedule flips, scanning minute by minute up to a week ahead.
  let changesInSeconds: number | null = null;
  let nextChangeTime: string | null = null;
  let changeDayOffset = 0;
  if (hours.mode === "AUTO") {
    for (let k = 1; k <= 7 * 1440; k++) {
      const abs = minute + k;
      const d = (day + Math.floor(abs / 1440)) % 7;
      const m = abs % 1440;
      if (isOpenAt(days, d, m) !== scheduleOpen) {
        changesInSeconds = k * 60 - seconds;
        changeDayOffset = Math.floor(abs / 1440);
        nextChangeTime = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        break;
      }
    }
  }

  let message: string | null = null;
  if (!isOpen) {
    if (hours.closedMessage.trim()) message = hours.closedMessage.trim();
    else if (hours.mode === "CLOSED") message = "We're not taking orders right now. Please check back soon.";
    else if (nextChangeTime) {
      const when = changeDayOffset === 0 ? "at" : changeDayOffset === 1 ? "tomorrow at" : `on ${DAY_SHORT[(day + changeDayOffset) % 7]} at`;
      message = `We're closed right now. Orders open ${when} ${fmt12(nextChangeTime)}.`;
    } else message = "We're closed right now.";
  }

  const t = days[day];
  return {
    ...hours,
    isOpen,
    message,
    opensAt: hours.mode === "AUTO" && !scheduleOpen ? nextChangeTime : null,
    changesInSeconds,
    nextChangeTime,
    todayOpenTime: t.openTime,
    todayCloseTime: t.closeTime,
    weekSummary: summarizeWeek(days),
  };
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
