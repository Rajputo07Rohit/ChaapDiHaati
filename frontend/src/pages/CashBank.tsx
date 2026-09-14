import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { Badge, Button, Card, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function CashBank() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"cash" | "bank">("cash");

  return (
    <div>
      <PageHeader title="Cash & Bank" description="Independent ledgers reconciled against real transactions — never derived as sales minus purchases." />
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("cash")} className={`px-3.5 py-2 rounded-lg text-sm font-medium ${tab === "cash" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
          Cash Ledger
        </button>
        {user?.role === "ADMIN" && (
          <button onClick={() => setTab("bank")} className={`px-3.5 py-2 rounded-lg text-sm font-medium ${tab === "bank" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            Bank Ledger
          </button>
        )}
      </div>
      {tab === "cash" ? <CashTab /> : <BankTab />}
    </div>
  );
}

function CashTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [txnType, setTxnType] = useState<"WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT">("ADJUSTMENT");
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const { data } = useQuery({ queryKey: ["cash", today()], queryFn: () => api.get<any>(`/cash?businessDate=${today()}`) });

  const mutation = useMutation({
    mutationFn: () => api.post("/cash/transaction", { txnType, direction, amountPaise: rupeesToPaise(parseFloat(amount) || 0), reason }),
    onSuccess: () => {
      toast.success("Cash transaction recorded");
      setModalOpen(false);
      setAmount("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["cash"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not record transaction"),
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <Card className="p-4 inline-block">
          <div className="text-xs text-slate-500 uppercase">Expected Cash (all-time)</div>
          <div className="text-2xl font-semibold mt-1">{formatPaise(data?.expectedCashPaise)}</div>
        </Card>
        <Button onClick={() => setModalOpen(true)}>New Transaction</Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Direction</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.todayTransactions ?? []).map((t: any) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5 text-slate-500">{t.business_date}</td>
                  <td className="px-4 py-2.5">{t.txn_type}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={t.direction === "IN" ? "green" : "red"}>{t.direction}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(t.amount_paise)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{t.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Cash Transaction">
        <div className="space-y-3">
          <Select value={txnType} onChange={(e) => setTxnType(e.target.value as any)} className="w-full">
            <option value="WITHDRAWAL">Withdrawal (cash added back from bank)</option>
            <option value="DEPOSIT">Deposit (cash sent to bank)</option>
            <option value="ADJUSTMENT">Manual adjustment</option>
          </Select>
          <Select value={direction} onChange={(e) => setDirection(e.target.value as any)} className="w-full">
            <option value="IN">Cash in</option>
            <option value="OUT">Cash out</option>
          </Select>
          <Input placeholder="Amount ₹" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full" />
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
          <Button className="w-full" disabled={!amount || !reason || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function BankTab() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["bank"], queryFn: () => api.get<any>("/bank") });
  const { data: unreconciled } = useQuery({ queryKey: ["bank-unreconciled"], queryFn: () => api.get<any>("/bank/unreconciled") });

  const reconcileMutation = useMutation({
    mutationFn: (id: string) => api.post(`/bank/reconcile/${id}`, { category: "BUSINESS" }),
    onSuccess: () => {
      toast.success("Marked reconciled");
      queryClient.invalidateQueries({ queryKey: ["bank-unreconciled"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reconcile"),
  });

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4">
        <Card className="p-4 inline-block">
          <div className="text-xs text-slate-500 uppercase">Bank Balance (Ledger)</div>
          <div className="text-2xl font-semibold mt-1">{formatPaise(data?.balancePaise)}</div>
          <div className="text-[11px] text-slate-400 mt-1">Opening + confirmed credits − debits. Never sales minus purchases.</div>
        </Card>
        {data?.reconciliation?.hasStatement ? (
          <Card className="p-4 inline-block">
            <div className="text-xs text-slate-500 uppercase">Last Confirmed Bank Statement</div>
            <div className="text-2xl font-semibold mt-1">{formatPaise(data.reconciliation.statementBalancePaise)}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              As of {data.reconciliation.statementDate} · Ledger showed {formatPaise(data.reconciliation.ledgerBalanceAsOfStatementPaise)} that day ·
              {" "}
              <span className={data.reconciliation.differencePaise === 0 ? "text-emerald-600" : "text-amber-600"}>
                Difference {formatPaise(data.reconciliation.differencePaise)}
              </span>
            </div>
            {data.reconciliation.reconciliationPending && (
              <div className="text-[11px] text-amber-600 font-medium mt-1">Reconciliation pending — nothing after {data.reconciliation.statementDate} has been checked against a real statement yet.</div>
            )}
          </Card>
        ) : (
          <Card className="p-4 inline-block">
            <div className="text-xs text-slate-500 uppercase">Bank Statement</div>
            <div className="text-sm text-amber-600 font-medium mt-1">No statement confirmed — reconciliation pending</div>
          </Card>
        )}
      </div>

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Unreconciled Transactions</h2>
      <Card className="overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-left px-4 py-2.5">Category</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-right px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(unreconciled?.transactions ?? []).map((t: any) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5 text-slate-500">{t.business_date}</td>
                  <td className="px-4 py-2.5">{t.description}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={t.category === "UNKNOWN" ? "yellow" : "default"}>{t.category}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {t.txn_type === "CREDIT" ? "+" : "-"}
                    {formatPaise(t.amount_paise)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="secondary" onClick={() => reconcileMutation.mutate(t.id)}>
                      Reconcile
                    </Button>
                  </td>
                </tr>
              ))}
              {(unreconciled?.transactions ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-slate-400 py-6">
                    All transactions reconciled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Transactions</h2>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Reconciled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.transactions ?? []).map((t: any) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5 text-slate-500">{t.business_date}</td>
                  <td className="px-4 py-2.5">{t.description}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {t.txn_type === "CREDIT" ? "+" : "-"}
                    {formatPaise(t.amount_paise)}
                  </td>
                  <td className="px-4 py-2.5">{t.reconciled ? <Badge tone="green">Yes</Badge> : <Badge tone="gray">No</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
