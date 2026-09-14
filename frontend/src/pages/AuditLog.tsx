import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { AuditLogRow } from "../api/types";
import { Card, PageHeader } from "../components/ui/Primitives";

export function AuditLog() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => api.get<{ rows: AuditLogRow[] }>("/audit-logs?limit=200"),
  });

  return (
    <div>
      <PageHeader title="Audit Log" description="Every financial modification is recorded here. This log cannot be edited or deleted." />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Time</th>
                <th className="text-left px-4 py-2.5">User</th>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-left px-4 py-2.5">Entity</th>
                <th className="text-left px-4 py-2.5">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.rows ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 align-top">
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2.5">{r.full_name ?? "System"}</td>
                  <td className="px-4 py-2.5 font-medium">{r.action}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {r.entity_type}
                    {r.entity_id ? ` · ${r.entity_id.slice(0, 12)}…` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 max-w-md">{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (data?.rows.length ?? 0) === 0 && <p className="text-center text-slate-400 py-8">No audit entries yet.</p>}
        </div>
      </Card>
    </div>
  );
}
