import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ImagePlus, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Badge, Button, Card, Input, PageHeader } from "../components/ui/Primitives";

interface Banner {
  id: string;
  image_url: string;
  title: string | null;
  link_url: string | null;
  active: boolean;
  sort_order: number;
}

/** Banner upload is multipart/form-data, not JSON — the shared `api` client
 * always JSON-encodes, so this is the one request in this file that talks
 * to fetch directly (same-origin cookie auth still applies via credentials). */
async function uploadBanner(file: File, title: string, linkUrl: string): Promise<Banner> {
  const form = new FormData();
  form.append("image", file);
  if (title) form.append("title", title);
  if (linkUrl) form.append("linkUrl", linkUrl);

  const res = await fetch("/api/banners", { method: "POST", credentials: "include", body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error?.message || "Upload failed", res.status, body?.error?.code);
  return body.banner;
}

export function Banners() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["banners"], queryFn: () => api.get<{ banners: Banner[] }>("/banners") });
  const banners = data?.banners ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["banners"] });

  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: () => uploadBanner(file!, title, linkUrl),
    onSuccess: () => {
      toast.success("Banner added");
      setTitle("");
      setLinkUrl("");
      setFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not upload banner"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/banners/${id}`, { active }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update banner"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/banners/${id}`),
    onSuccess: () => {
      toast.success("Banner removed");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove banner"),
  });

  function handleFileChange(f: File | null) {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  return (
    <div>
      <PageHeader
        title="Banners"
        description="Promotional images shown as a carousel at the top of the customer app's menu screen — new dishes, events, festive offers."
      />

      <Card className="p-4 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Add a banner</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500">Image</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 mt-1"
            />
            {preview && <img src={preview} alt="" className="mt-2 h-24 w-full rounded-lg object-cover" />}
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-slate-500">Title (optional)</label>
              <Input placeholder="e.g. Diwali Special — 20% off" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Link (optional — opened on tap)</label>
              <Input placeholder="e.g. a promo code page" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="w-full" />
            </div>
          </div>
        </div>
        <Button className="mt-3" disabled={!file || uploadMutation.isPending} onClick={() => uploadMutation.mutate()}>
          <ImagePlus size={14} /> {uploadMutation.isPending ? "Uploading…" : "Add Banner"}
        </Button>
      </Card>

      {banners.length === 0 ? (
        <p className="text-sm text-slate-400">No banners yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {banners.map((b) => (
            <Card key={b.id} className="overflow-hidden">
              <img src={b.image_url} alt="" className="h-32 w-full object-cover" />
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm font-medium text-slate-800 truncate">{b.title || "(no title)"}</div>
                  {b.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
                </div>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => toggleActive.mutate({ id: b.id, active: !b.active })}>
                    {b.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove.mutate(b.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
