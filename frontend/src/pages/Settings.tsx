import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { BusinessProfile, PaymentMethod, Role, User } from "../api/types";
import { Badge, Button, Card, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Admin controls: users, payment methods, backups." />
      <div className="space-y-8">
        <BusinessProfileSection />
        <UsersSection />
        <PaymentMethodsSection />
        <BackupSection />
      </div>
    </div>
  );
}

/** Powers the "from" name/tagline/address on the WhatsApp bill — kept
 * server-side (not hardcoded in the frontend) since it's real business
 * identity, not app config, and Staff/Manager only need to read it. */
function BusinessProfileSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["business-profile"], queryFn: () => api.get<BusinessProfile>("/settings/business-profile") });

  const [businessName, setBusinessName] = useState("");
  const [tagline, setTagline] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (data) {
      setBusinessName(data.businessName);
      setTagline(data.tagline);
      setAddress(data.address);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => api.put("/settings/business-profile", { businessName, tagline, address }),
    onSuccess: () => {
      toast.success("Business profile saved");
      queryClient.invalidateQueries({ queryKey: ["business-profile"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save business profile"),
  });

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Business Profile</h2>
      <Card className="p-4 max-w-lg space-y-3">
        <p className="text-xs text-slate-500">Used on the WhatsApp bill shared with customers.</p>
        <div>
          <label className="text-xs font-medium text-slate-500">Business name</label>
          <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Tagline (optional)</label>
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} className="w-full" placeholder="e.g. Authentic Taste of Delhi" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Address (optional)</label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full" placeholder="Shown at the bottom of the bill" />
        </div>
        <Button disabled={!businessName || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </Card>
    </section>
  );
}

function UsersSection() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: User[] }>("/auth/users") });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("STAFF");

  const createMutation = useMutation({
    mutationFn: () => api.post("/auth/users", { username, password, fullName, role }),
    onSuccess: () => {
      toast.success("User created");
      setModalOpen(false);
      setUsername("");
      setPassword("");
      setFullName("");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create user"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/auth/users/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Users</h2>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          Add User
        </Button>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Username</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-right px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.users ?? []).map((u: any) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5 font-medium">{u.username}</td>
                <td className="px-4 py-2.5">{u.full_name}</td>
                <td className="px-4 py-2.5">{u.role}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={u.active ? "green" : "gray"}>{u.active ? "Active" : "Inactive"}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="secondary" onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}>
                    {u.active ? "Deactivate" : "Activate"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add User">
        <div className="space-y-3">
          <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full" />
          <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" />
          <Input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full" />
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full">
            <option value="STAFF">Staff</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
          </Select>
          <Button className="w-full" disabled={!username || !password || !fullName || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Creating…" : "Create User"}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function PaymentMethodsSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["payment-methods-all"], queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods") });
  const [name, setName] = useState("");
  const [type, setType] = useState<"CASH" | "ONLINE">("ONLINE");

  const createMutation = useMutation({
    mutationFn: () => api.post("/payment-methods", { name, type }),
    onSuccess: () => {
      toast.success("Payment method added");
      setName("");
      queryClient.invalidateQueries({ queryKey: ["payment-methods-all"] });
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add payment method"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/payment-methods/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-methods-all"] });
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
    },
  });

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Payment Methods</h2>
      <Card className="p-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {(data?.methods ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
              <span>{m.name}</span>
              <Badge tone={m.type === "CASH" ? "blue" : "default"}>{m.type}</Badge>
              <button className="text-xs text-rose-500" onClick={() => toggleActive.mutate({ id: m.id, active: !m.active })}>
                {m.active ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="New payment method name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="ONLINE">Online</option>
            <option value="CASH">Cash</option>
          </Select>
          <Button disabled={!name || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Adding…" : "Add"}
          </Button>
        </div>
      </Card>
    </section>
  );
}

function BackupSection() {
  const { data } = useQuery({ queryKey: ["backups"], queryFn: () => api.get<{ backups: any[] }>("/backup") });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => api.post<{ filename: string }>("/backup"),
    onSuccess: () => {
      toast.success("Backup created");
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Backup failed"),
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Backup & Restore</h2>
        <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating…" : "Create Backup"}
        </Button>
      </div>
      <Card className="p-4">
        <p className="text-xs text-slate-500 mb-3">Restoring is destructive and requires re-entering your admin password. Do it from the API/README procedure.</p>
        <div className="space-y-1 text-sm">
          {(data?.backups ?? []).map((b: any) => (
            <div key={b.filename} className="flex justify-between border-b border-slate-50 py-1.5">
              <span>{b.filename}</span>
              <a className="text-brand-600 text-xs font-medium" href={`/api/backup/${b.filename}/download`}>
                Download
              </a>
            </div>
          ))}
          {(data?.backups ?? []).length === 0 && <p className="text-slate-400">No backups yet.</p>}
        </div>
      </Card>
    </section>
  );
}
