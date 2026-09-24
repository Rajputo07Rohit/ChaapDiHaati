import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Smartphone, LogOut } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Button, Card, Modal, PageHeader } from "../components/ui/Primitives";
import { describeUserAgent } from "../utils/userAgent";

interface LoginActivityRow {
  id: string;
  username?: string;
  full_name?: string;
  role?: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

interface ActiveDeviceRow {
  user_id: string;
  username?: string;
  full_name?: string;
  role?: string;
  active_devices: number;
}

export function LoginActivity() {
  const queryClient = useQueryClient();
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["login-activity"],
    queryFn: () => api.get<{ rows: LoginActivityRow[]; activeDevices: ActiveDeviceRow[] }>("/auth/login-activity"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["login-activity"] });

  const logoutOneMutation = useMutation({
    mutationFn: (userId: string) => api.post<{ revoked: number }>(`/auth/users/${userId}/logout-all`),
    onSuccess: (res, userId) => {
      const target = data?.activeDevices.find((d) => d.user_id === userId);
      toast.success(`${target?.full_name ?? "Account"} logged out from ${res.revoked} device${res.revoked === 1 ? "" : "s"}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not log out that account"),
  });

  const logoutAllMutation = useMutation({
    mutationFn: () => api.post<{ revoked: number }>("/auth/logout-all-accounts"),
    onSuccess: (res) => {
      toast.success(`Logged out ${res.revoked} device${res.revoked === 1 ? "" : "s"} across every account`);
      setConfirmAllOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not log out all accounts"),
  });

  return (
    <div>
      <PageHeader
        title="Login Activity"
        description="Every successful login across every account — device, browser, and IP address."
        actions={
          <Button variant="danger" size="sm" onClick={() => setConfirmAllOpen(true)} disabled={(data?.activeDevices.length ?? 0) === 0}>
            <LogOut size={14} /> Log out everyone, everywhere
          </Button>
        }
      />

      <div className="mb-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Currently logged in — devices per account</div>
        {(data?.activeDevices.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-400">No active sessions right now.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(data?.activeDevices ?? []).map((d) => (
              <Card key={d.user_id} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm text-slate-800">{d.full_name ?? "Unknown"}</div>
                    <div className="text-xs text-slate-400">
                      {d.username} · {d.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-lg font-extrabold text-brand-600">
                    <Smartphone size={16} /> {d.active_devices}
                  </div>
                </div>
                <button
                  disabled={logoutOneMutation.isPending}
                  onClick={() => logoutOneMutation.mutate(d.user_id)}
                  className="w-full text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                >
                  Log out this account everywhere
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Time</th>
                <th className="text-left px-4 py-2.5">User</th>
                <th className="text-left px-4 py-2.5">Device</th>
                <th className="text-left px-4 py-2.5">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-medium">
                    {r.full_name ?? "Unknown"}
                    {r.username && <span className="text-slate-400 font-normal"> ({r.username})</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{describeUserAgent(r.user_agent)}</td>
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums">{r.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (data?.rows.length ?? 0) === 0 && (
            <p className="text-center text-slate-400 py-8">No login activity recorded yet — this only tracks logins from now on.</p>
          )}
        </div>
      </Card>

      <Modal open={confirmAllOpen} onClose={() => setConfirmAllOpen(false)} title="Log out everyone, everywhere?">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            This immediately signs out every device on every account, including your own — everyone (yourself included) will need to log back in.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmAllOpen(false)} disabled={logoutAllMutation.isPending}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => logoutAllMutation.mutate()} disabled={logoutAllMutation.isPending}>
              {logoutAllMutation.isPending ? "Logging out…" : "Yes, log out everyone"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
