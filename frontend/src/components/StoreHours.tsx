import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Clock, Power, Store } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Button, Card, Input } from "./ui/Primitives";

export type StoreMode = "AUTO" | "OPEN" | "CLOSED";

export interface DayHours {
  open: boolean;
  openTime: string;
  closeTime: string;
}

export interface StoreStatus {
  mode: StoreMode;
  openTime: string;
  closeTime: string;
  closedMessage: string;
  days?: DayHours[]; // index 0 = Sunday
  isOpen: boolean;
  message: string | null;
  weekSummary: { label: string; hours: string }[];
}

const QUERY_KEY = ["store-hours"];

function useStoreStatus() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: () => api.get<StoreStatus>("/store-hours"), refetchInterval: 10_000 });
}

function useSaveStoreHours() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: Pick<StoreStatus, "mode" | "openTime" | "closeTime" | "closedMessage" | "days">) => api.put<StoreStatus>("/store-hours", v),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      toast.success(data.isOpen ? "Store is open for orders" : "Store is closed for orders");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save store hours"),
  });
}

/** Compact sidebar control — one tap to stop/resume online orders (e.g. "we're out of stock"). */
export function StoreQuickToggle() {
  const { data } = useStoreStatus();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (mode: StoreMode) => api.put<StoreStatus>("/store-hours/mode", { mode }),
    onSuccess: (d) => {
      queryClient.setQueryData(QUERY_KEY, d);
      toast.success(d.isOpen ? "Store is open for orders" : "Store is closed for orders");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not change store status"),
  });
  if (!data) return null;

  function toggle() {
    const s = data!;
    // Closing is always a manual override; reopening goes back to the schedule
    // unless the schedule itself says closed, in which case force open.
    const next: StoreMode = s.isOpen ? "CLOSED" : s.mode === "CLOSED" ? "AUTO" : "OPEN";
    save.mutate(next);
  }

  return (
    <div className="px-3 pb-2">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-1.5">Online orders</div>
      <button
        onClick={toggle}
        disabled={save.isPending}
        className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
          data.isOpen ? "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30" : "bg-rose-600/20 text-rose-300 hover:bg-rose-600/30"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${data.isOpen ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
        <span className="flex-1 text-left">{data.isOpen ? "Open" : "Closed"}</span>
        <span className="text-xs opacity-80">{data.isOpen ? "Tap to close" : "Tap to open"}</span>
      </button>
    </div>
  );
}

const MODES: { value: StoreMode; title: string; hint: string }[] = [
  { value: "AUTO", title: "Follow schedule", hint: "Opens and closes automatically" },
  { value: "OPEN", title: "Force open", hint: "Take orders even outside hours" },
  { value: "CLOSED", title: "Closed now", hint: "Out of stock / busy — pause orders" },
];

// Shown Monday first; `index` is the JS weekday (0 = Sunday) the server stores.
const WEEK: { index: number; name: string }[] = [
  { index: 1, name: "Monday" },
  { index: 2, name: "Tuesday" },
  { index: 3, name: "Wednesday" },
  { index: 4, name: "Thursday" },
  { index: 5, name: "Friday" },
  { index: 6, name: "Saturday" },
  { index: 0, name: "Sunday" },
];

export function StoreHoursSection() {
  const { data } = useStoreStatus();
  const save = useSaveStoreHours();

  const [mode, setMode] = useState<StoreMode>("AUTO");
  const [days, setDays] = useState<DayHours[]>(() => Array.from({ length: 7 }, () => ({ open: true, openTime: "15:00", closeTime: "22:30" })));
  const [closedMessage, setClosedMessage] = useState("");

  useEffect(() => {
    if (data) {
      setMode(data.mode);
      setDays(data.days?.length === 7 ? data.days : Array.from({ length: 7 }, () => ({ open: true, openTime: data.openTime, closeTime: data.closeTime })));
      setClosedMessage(data.closedMessage);
    }
  }, [data]);

  function patchDay(index: number, patch: Partial<DayHours>) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  // Copies one day's hours onto a set of days (e.g. Monday -> Tue–Fri).
  function copyFrom(sourceIndex: number, targets: number[]) {
    setDays((prev) => prev.map((d, i) => (targets.includes(i) ? { ...prev[sourceIndex] } : d)));
  }

  const dirty =
    !!data && (mode !== data.mode || closedMessage !== data.closedMessage || JSON.stringify(days) !== JSON.stringify(data.days ?? null));

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Store Hours &amp; Online Ordering</h2>
      <Card className="p-4 max-w-2xl space-y-5">
        <div
          className={`flex items-center gap-3 rounded-xl p-3 ${
            data?.isOpen ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-800 dark:bg-rose-900/20 dark:text-rose-300"
          }`}
        >
          <Store size={22} />
          <div className="flex-1">
            <div className="font-semibold">{data ? (data.isOpen ? "Store is open — customers can order" : "Store is closed — ordering is paused") : "Loading…"}</div>
            <div className="text-xs opacity-80">
              {data?.weekSummary?.length ? data.weekSummary.map((r) => `${r.label} ${r.hours}`).join(" · ") : "Set your weekly hours below"}
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Ordering mode</label>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`rounded-xl border p-3 text-left transition ${
                  mode === m.value
                    ? m.value === "CLOSED"
                      ? "border-rose-500 bg-rose-50 ring-1 ring-rose-500 dark:bg-rose-900/20"
                      : "border-brand-600 bg-brand-50 ring-1 ring-brand-600 dark:bg-brand-900/20"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  {m.value === "AUTO" ? <Clock size={14} /> : <Power size={14} />}
                  {m.title}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{m.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className={mode === "AUTO" ? "" : "opacity-50"}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs font-medium text-slate-500">Weekly timing (IST)</label>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => copyFrom(1, [2, 3, 4, 5])} className="font-semibold text-brand-600 hover:underline">
                Monday → Tue–Fri
              </button>
              <button type="button" onClick={() => copyFrom(6, [0])} className="font-semibold text-brand-600 hover:underline">
                Saturday → Sunday
              </button>
            </div>
          </div>
          <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {WEEK.map(({ index, name }) => {
              const d = days[index];
              return (
                <div key={index} className="flex items-center gap-3 px-3 py-2">
                  <label className="flex w-32 items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={d.open} onChange={(e) => patchDay(index, { open: e.target.checked })} className="h-4 w-4 accent-brand-600" />
                    {name}
                  </label>
                  {d.open ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input type="time" value={d.openTime} onChange={(e) => patchDay(index, { openTime: e.target.value })} />
                      <span className="text-slate-400">→</span>
                      <Input type="time" value={d.closeTime} onChange={(e) => patchDay(index, { closeTime: e.target.value })} />
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">Closed all day</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate-400">Untick a day to close it. Closing after midnight is fine (e.g. 6 PM → 2 AM). Same open and close time = open 24 hours.</p>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Message shown when closed (optional)</label>
          <Input
            value={closedMessage}
            maxLength={200}
            onChange={(e) => setClosedMessage(e.target.value)}
            placeholder="e.g. We're out of stock today — back tomorrow at 3 PM!"
            className="w-full"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              // openTime/closeTime stay as the Monday window — only read by older deploys that don't know about per-day hours.
              const monday = days[1];
              save.mutate({ mode, openTime: monday.openTime, closeTime: monday.closeTime, closedMessage, days });
            }}
            disabled={save.isPending || !dirty}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>
      </Card>
    </section>
  );
}
