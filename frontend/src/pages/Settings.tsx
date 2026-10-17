import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { BusinessProfile, PaymentMethod, Role, User } from "../api/types";
import { StoreHoursSection } from "../components/StoreHours";
import { Badge, Button, Card, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Admin controls: users, payment methods, backups." />
      <div className="space-y-8">
        <StoreHoursSection />
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
  const [phone, setPhone] = useState("");
  const [instagram, setInstagram] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [pureVeg, setPureVeg] = useState(false);
  const [supportWhatsapp, setSupportWhatsapp] = useState("");

  useEffect(() => {
    if (data) {
      setBusinessName(data.businessName);
      setTagline(data.tagline);
      setAddress(data.address);
      setPhone(data.phone ?? "");
      setInstagram(data.instagram ?? "");
      setMapsUrl(data.mapsUrl ?? "");
      setReviewUrl(data.reviewUrl ?? "");
      setPureVeg(!!data.pureVeg);
      setSupportWhatsapp(data.supportWhatsapp ?? "");
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => api.put("/settings/business-profile", { businessName, tagline, address, phone, instagram, mapsUrl, reviewUrl, pureVeg, supportWhatsapp }),
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
        <p className="text-xs text-slate-500">Used on the WhatsApp bill and in the customer app footer.</p>
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
          <Input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full" placeholder="Shown on the bill and in the customer app footer" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Phone (optional)</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full" placeholder="Customer app footer — tap to call" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Instagram (optional)</label>
          <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} className="w-full" placeholder="@username or full profile link" />
          {instagram.trim() && !/^(@?[A-Za-z0-9._]{1,30}|.*instagram\.com\/[A-Za-z0-9._]+.*)$/.test(instagram.trim()) && (
            <p className="mt-1 text-xs text-amber-600">That looks like a display name. Use the @username (no spaces) or paste the profile link from Instagram.</p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Google Maps link</label>
          <Input value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} className="w-full" placeholder="https://maps.app.goo.gl/…" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Google review link</label>
          <Input value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} className="w-full" placeholder="Opened by the “Rate us on Google” popup after delivery" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Support WhatsApp number (optional)</label>
          <Input value={supportWhatsapp} onChange={(e) => setSupportWhatsapp(e.target.value)} className="w-full" placeholder="Customers' “WhatsApp us” button — defaults to the phone above" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={pureVeg} onChange={(e) => setPureVeg(e.target.checked)} />
          Show a “Pure Veg” badge in the customer app
        </label>
        <Button disabled={!businessName || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </Card>
    </section>
  );
}

/** Riders' numbers are shown to the customer whose order they're bringing, so they can call. */
function UserPhoneCell({ user }: { user: { id: string; phone?: string | null; role: string } }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(user.phone ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/auth/users/${user.id}`, { phone: value.trim() || null }),
    onSuccess: () => {
      toast.success("Phone saved");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save phone"),
  });
  const dirty = value.trim() !== (user.phone ?? "");
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={user.role === "RIDER" ? "Needed — shown to customers" : "Optional"}
        className={`w-40 ${user.role === "RIDER" && !value.trim() ? "border-amber-400" : ""}`}
      />
      {dirty && (
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      )}
    </div>
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
  const [newPhone, setNewPhone] = useState("");

  const createMutation = useMutation({
    mutationFn: () => api.post("/auth/users", { username, password, fullName, role, phone: newPhone.trim() || null }),
    onSuccess: () => {
      toast.success("User created");
      setModalOpen(false);
      setUsername("");
      setPassword("");
      setFullName("");
      setNewPhone("");
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
              <th className="text-left px-4 py-2.5">Phone</th>
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
                  <UserPhoneCell user={u} />
                </td>
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
          <Input
            placeholder={role === "RIDER" ? "Phone (customers call the rider on this)" : "Phone (optional)"}
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className="w-full"
          />
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full">
            <option value="STAFF">Staff</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
            <option value="RIDER">Rider</option>
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
