import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, ImagePlus, Trash2, X } from "lucide-react";
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

interface QueuedImage {
  key: string;
  file: File;
  preview: string;
  title: string;
}

const MAX_BATCH = 10;
const MAX_BYTES = 5 * 1024 * 1024;

export function Banners() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["banners"], queryFn: () => api.get<{ banners: Banner[] }>("/banners") });
  const banners = data?.banners ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["banners"] });

  const [queue, setQueue] = useState<QueuedImage[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    if (images.length < incoming.length) toast.error("Only image files were added.");
    const tooBig = images.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) toast.error(`${tooBig.length} image(s) over 5 MB were skipped.`);
    const ok = images.filter((f) => f.size <= MAX_BYTES);
    setQueue((prev) => {
      const room = MAX_BATCH - prev.length;
      if (ok.length > room) toast.error(`You can add up to ${MAX_BATCH} images at a time.`);
      const added = ok.slice(0, Math.max(0, room)).map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        preview: URL.createObjectURL(file),
        title: "",
      }));
      return [...prev, ...added];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeQueued(key: string) {
    setQueue((prev) => {
      const gone = prev.find((q) => q.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((q) => q.key !== key);
    });
  }

  // One request per image (the upload endpoint takes a single file) — run in
  // order so the carousel order matches the order shown here, and so one bad
  // file doesn't sink the rest.
  async function uploadAll() {
    const batch = queue;
    setProgress({ done: 0, total: batch.length });
    let failed = 0;
    const remaining: QueuedImage[] = [];
    for (let i = 0; i < batch.length; i++) {
      try {
        await uploadBanner(batch[i].file, batch[i].title, linkUrl);
        URL.revokeObjectURL(batch[i].preview);
      } catch (err) {
        failed++;
        remaining.push(batch[i]);
        toast.error(`${batch[i].file.name}: ${err instanceof ApiError ? err.message : "upload failed"}`);
      }
      setProgress({ done: i + 1, total: batch.length });
    }
    setQueue(remaining);
    setProgress(null);
    if (failed < batch.length) toast.success(`${batch.length - failed} banner${batch.length - failed > 1 ? "s" : ""} added`);
    if (failed === 0) setLinkUrl("");
    invalidate();
  }

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

  // Rewrites every banner's sort_order to its new position, so duplicates
  // left over from earlier deletes can't make an arrow click do nothing.
  const move = useMutation({
    mutationFn: async ({ index, dir }: { index: number; dir: -1 | 1 }) => {
      const next = [...banners];
      const [item] = next.splice(index, 1);
      next.splice(index + dir, 0, item);
      await Promise.all(next.map((b, i) => (b.sort_order !== i ? api.patch(`/banners/${b.id}`, { sortOrder: i }) : null)));
    },
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reorder banners"),
  });

  const activeCount = banners.filter((b) => b.active).length;
  const uploading = progress !== null;

  return (
    <div>
      <PageHeader
        title="Banners"
        description="Promotional images shown as a swipeable carousel at the top of the customer app's menu — new dishes, events, festive offers."
      />

      <Card className="p-4 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Add banners</h3>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
            dragOver ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-slate-400"
          }`}
        >
          <ImagePlus size={24} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Choose images or drop them here</span>
          <span className="text-xs text-slate-400">Select several at once · up to {MAX_BATCH} images · max 5 MB each</span>
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} className="sr-only" />
        </label>

        {queue.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {queue.map((q) => (
                <div key={q.key} className="flex gap-3 rounded-xl border border-slate-200 p-2">
                  <img src={q.preview} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <span className="truncate text-xs text-slate-500">{q.file.name}</span>
                      <button
                        onClick={() => removeQueued(q.key)}
                        disabled={uploading}
                        aria-label="Remove image"
                        className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <Input
                      placeholder="Title (optional)"
                      value={q.title}
                      disabled={uploading}
                      onChange={(e) => setQueue((prev) => prev.map((x) => (x.key === q.key ? { ...x, title: e.target.value } : x)))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 max-w-md">
              <label className="text-xs font-medium text-slate-500">Link for these banners (optional — opened on tap)</label>
              <Input placeholder="e.g. https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="w-full" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button disabled={uploading} onClick={uploadAll}>
                <ImagePlus size={14} />
                {uploading ? `Uploading ${progress!.done}/${progress!.total}…` : `Add ${queue.length} banner${queue.length > 1 ? "s" : ""}`}
              </Button>
              {!uploading && (
                <button
                  onClick={() => {
                    queue.forEach((q) => URL.revokeObjectURL(q.preview));
                    setQueue([]);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear all
                </button>
              )}
            </div>
          </>
        )}
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Carousel order <span className="font-normal text-slate-400">· {activeCount} active of {banners.length}</span>
        </h3>
        <span className="text-xs text-slate-400">Use the arrows to reorder</span>
      </div>

      {banners.length === 0 ? (
        <p className="text-sm text-slate-400">No banners yet — customers see a default welcome banner until you add some.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {banners.map((b, i) => (
            <Card key={b.id} className={`overflow-hidden ${b.active ? "" : "opacity-70"}`}>
              <div className="relative">
                <img src={b.image_url} alt="" className="h-32 w-full object-cover" />
                <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs font-bold text-white">{i + 1}</span>
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm font-medium text-slate-800 truncate">{b.title || "(no title)"}</div>
                  {b.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
                </div>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="secondary" disabled={i === 0 || move.isPending} onClick={() => move.mutate({ index: i, dir: -1 })} aria-label="Move earlier">
                    <ArrowUp size={14} />
                  </Button>
                  <Button size="sm" variant="secondary" disabled={i === banners.length - 1 || move.isPending} onClick={() => move.mutate({ index: i, dir: 1 })} aria-label="Move later">
                    <ArrowDown size={14} />
                  </Button>
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
