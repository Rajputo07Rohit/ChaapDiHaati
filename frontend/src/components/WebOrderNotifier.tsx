import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../api/client";
import { SalesOrder } from "../api/types";
import { useAuth } from "../context/AuthContext";

export const PENDING_WEB_ORDERS_KEY = ["pending-customer-orders"];

/** Customer (web) orders waiting to be accepted or denied, polled every 10s. */
export function usePendingWebOrders() {
  const { user } = useAuth();
  return useQuery({
    queryKey: PENDING_WEB_ORDERS_KEY,
    queryFn: () => api.get<{ orders: SalesOrder[] }>("/orders?status=PENDING_ACCEPTANCE&limit=50"),
    refetchInterval: 10_000,
    // Keep checking while the tab is in the background (staff are often on another
    // tab or the POS) — otherwise a new order makes no sound until someone looks.
    refetchIntervalInBackground: true,
    enabled: !!user && user.role !== "RIDER",
  });
}

export function usePendingCount() {
  return usePendingWebOrders().data?.orders.length ?? 0;
}

// Browsers keep audio muted until the page has been clicked once; one shared
// context is unlocked on the first tap and reused for every chime after that.
let audioCtx: AudioContext | null = null;
function getAudio(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new Ctx();
    }
    return audioCtx;
  } catch {
    return null;
  }
}
if (typeof window !== "undefined") {
  const unlock = () => {
    getAudio()?.resume().catch(() => undefined);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => undefined);
    window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
}

/** One loud three-note chime for the whole queue (not one per order) — audible in a busy kitchen. */
export function playChime() {
  const ctx = getAudio();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    [0, 0.25, 0.5].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = [880, 1175, 1568][i];
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    /* audio blocked until the user interacts with the page — ignore */
  }
}

/** System notification when the staff screen isn't the visible tab/window. */
function notifyBrowser(newCount: number, total: number) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  try {
    const n = new Notification(`${newCount} new web order${newCount > 1 ? "s" : ""}`, {
      body: `${total} waiting to be accepted`,
      tag: "web-orders",
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      window.location.assign("/web-orders");
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

/**
 * Headless, always mounted in Layout: one toast per batch of new web orders
 * and a chime every 20s while any are waiting. Never opens a modal.
 */
export function WebOrderNotifier() {
  const orders = usePendingWebOrders().data?.orders;
  const seenIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!orders) return;
    const ids = new Set(orders.map((o) => o.id));
    const newCount = [...ids].filter((id) => !seenIds.current?.has(id)).length;
    if (newCount > 0) {
      toast(`${newCount} new web order${newCount > 1 ? "s" : ""} — ${ids.size} waiting`, { icon: "🔔", duration: 6000 });
      notifyBrowser(newCount, ids.size);
    }
    seenIds.current = ids;
  }, [orders]);

  const pendingCount = orders?.length ?? 0;
  const hasPending = pendingCount > 0;
  useEffect(() => {
    if (!hasPending) return;
    playChime();
    const t = setInterval(playChime, 15_000);
    return () => clearInterval(t);
  }, [hasPending]);

  // Flashing tab title so a waiting order is visible from any other tab.
  useEffect(() => {
    if (!hasPending) return;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 (${pendingCount}) New web order` : original;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [hasPending, pendingCount]);

  return null;
}
