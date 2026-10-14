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
    enabled: !!user && user.role !== "RIDER",
  });
}

export function usePendingCount() {
  return usePendingWebOrders().data?.orders.length ?? 0;
}

/** One soft chime for the whole queue (not one per order). */
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio blocked until the user interacts with the page — ignore */
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
    }
    seenIds.current = ids;
  }, [orders]);

  const hasPending = (orders?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasPending) return;
    playChime();
    const t = setInterval(playChime, 20_000);
    return () => clearInterval(t);
  }, [hasPending]);

  return null;
}
