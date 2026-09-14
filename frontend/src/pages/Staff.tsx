import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { ActionMenu, Badge, Button, Card, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

interface StaffMember {
  id: string;
  full_name: string;
  role_title: string;
  salary_paise: number;
  salary_method: string;
  custom_days: number | null;
  joining_date: string;
  active: number;
  phone: string | null;
}

export function Staff() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);

  const { data } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get<{ staff: StaffMember[]; monthlySalaryTotalPaise: number }>("/staff"),
  });

  const [fullName, setFullName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [salary, setSalary] = useState("");
  const [salaryMethod, setSalaryMethod] = useState("FIXED_30");
  const [joiningDate, setJoiningDate] = useState(new Date().toISOString().slice(0, 10));

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/staff", { fullName, roleTitle, salaryPaise: rupeesToPaise(parseFloat(salary) || 0), salaryMethod, joiningDate }),
    onSuccess: () => {
      toast.success("Staff member added");
      setModalOpen(false);
      setFullName("");
      setRoleTitle("");
      setSalary("");
      queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add staff member"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/staff/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update staff member"),
  });

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Monthly salary allocation method is configurable per employee."
        actions={isAdmin && <Button onClick={() => setModalOpen(true)}>Add Staff</Button>}
      />

      <Card className="p-4 mb-6 inline-block">
        <div className="text-xs text-slate-500 uppercase">Monthly Salary Total (active staff)</div>
        <div className="text-2xl font-semibold mt-1">{formatPaise(data?.monthlySalaryTotalPaise)}</div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Role</th>
                <th className="text-right px-4 py-2.5">Salary</th>
                <th className="text-left px-4 py-2.5">Method</th>
                <th className="text-left px-4 py-2.5">Status</th>
                {isAdmin && <th className="text-right px-4 py-2.5">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.staff ?? []).map((s) => (
                <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                  <td className="px-4 py-2.5 font-medium">{s.full_name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{s.role_title}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(s.salary_paise)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{s.salary_method.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={s.active ? "green" : "gray"}>{s.active ? "Active" : "Inactive"}</Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right">
                      <ActionMenu
                        items={[
                          { label: "Edit", onClick: () => setEditing(s) },
                          {
                            label: s.active ? "Deactivate" : "Activate",
                            onClick: () => toggleActive.mutate({ id: s.id, active: !s.active }),
                            tone: s.active ? "danger" : "default",
                          },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Staff Member">
        <div className="space-y-3">
          <Input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full" />
          <Input placeholder="Role title (e.g. Chef)" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} className="w-full" />
          <Input placeholder="Monthly salary ₹" type="number" value={salary} onChange={(e) => setSalary(e.target.value)} className="w-full" />
          <Select value={salaryMethod} onChange={(e) => setSalaryMethod(e.target.value)} className="w-full">
            <option value="CALENDAR_DAY">Calendar days in month</option>
            <option value="FIXED_30">Fixed 30 days</option>
            <option value="WORKING_26">Working 26 days</option>
            <option value="CUSTOM">Custom</option>
          </Select>
          <Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className="w-full" />
          <Button className="w-full" disabled={!fullName || !roleTitle || !salary || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Modal>

      <EditStaffModal staff={editing} onClose={() => setEditing(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["staff"] })} />
    </div>
  );
}

function EditStaffModal({ staff, onClose, onSaved }: { staff: StaffMember | null; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [salary, setSalary] = useState("");
  const [salaryMethod, setSalaryMethod] = useState("FIXED_30");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (staff) {
      setFullName(staff.full_name);
      setRoleTitle(staff.role_title);
      setSalary((staff.salary_paise / 100).toString());
      setSalaryMethod(staff.salary_method);
      setPhone(staff.phone ?? "");
    }
  }, [staff]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/staff/${staff!.id}`, {
        fullName,
        roleTitle,
        salaryPaise: rupeesToPaise(parseFloat(salary) || 0),
        salaryMethod,
        phone: phone || undefined,
      }),
    onSuccess: () => {
      toast.success("Staff member updated");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update staff member"),
  });

  if (!staff) return null;

  return (
    <Modal open={!!staff} onClose={onClose} title={`Edit ${staff.full_name}`}>
      <div className="space-y-3">
        <Input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full" />
        <Input placeholder="Role title (e.g. Chef)" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} className="w-full" />
        <Input placeholder="Monthly salary ₹" type="number" value={salary} onChange={(e) => setSalary(e.target.value)} className="w-full" />
        <Select value={salaryMethod} onChange={(e) => setSalaryMethod(e.target.value)} className="w-full">
          <option value="CALENDAR_DAY">Calendar days in month</option>
          <option value="FIXED_30">Fixed 30 days</option>
          <option value="WORKING_26">Working 26 days</option>
          <option value="CUSTOM">Custom</option>
        </Select>
        <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full" />
        <Button className="w-full" disabled={!fullName || !roleTitle || !salary || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </Modal>
  );
}
