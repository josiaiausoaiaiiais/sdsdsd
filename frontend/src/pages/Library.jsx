import React, { useState, useMemo } from "react";
import { Search, Upload, Folder, Grid2x2, List, Plus, MoreHorizontal, Play, Trash2 } from "lucide-react";import DashboardLayout, { PageHeader } from "../components/DashboardLayout";
import { VideoCard, FilterPill, EmptyState } from "../components/brewly/MediaPrimitives";
import { useUploads, useFavorites, relTime, fmtDuration } from "../lib/data";

const FOLDERS = [
  { id: "all", name: "All videos" },
  { id: "ai", name: "AI generated" },
  { id: "upload", name: "Uploads" },
  { id: "shorts", name: "Shorts (9:16)" },
  { id: "wide", name: "Wide (16:9)" },
];

export default function LibraryPage() {
  const [folder, setFolder] = useState("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState("grid");
  const { items, add, addFile, remove } = useUploads();
  const { items: favs, toggle } = useFavorites();
  const favSet = useMemo(() => new Set((favs || []).map(f => f.id)), [favs]);
  const [uploading, setUploading] = useState(false);
  const fileRef = React.useRef(null);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((v) => {
      const matchesFolder =
        folder === "all" ||
        (folder === "ai" && v.source === "ai") ||
        (folder === "upload" && v.source === "upload") ||
        (folder === "shorts" && v.ratio === "9:16") ||
        (folder === "wide" && v.ratio === "16:9");
      const matchesQ = q === "" || v.title.toLowerCase().includes(q.toLowerCase());
      return matchesFolder && matchesQ;
    });
  }, [items, folder, q]);

  const handleQuickAdd = async () => {
    const titles = ["Fresh take — fan Q&A", "Cozy Friday-payday recap", "Quick tip: pricing pep talk", "New ritual for focus"];
    const ratios = ["16:9", "9:16", "1:1"];
    const sources = ["ai", "upload"];
    await add({
      title: titles[Math.floor(Math.random() * titles.length)],
      source: sources[Math.floor(Math.random() * sources.length)],
      ratio: ratios[Math.floor(Math.random() * ratios.length)],
      duration_sec: 30 + Math.floor(Math.random() * 600),
    });
  };

  const handleFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await addFile(f, f.name.replace(/\.[^/.]+$/, ""), "16:9");
    } catch (err) {
      alert("Upload failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toCardItem = (v) => ({
    title: v.title, ratio: v.ratio, time: relTime(v.created_at),
    views: `${v.views}`, duration: fmtDuration(v.duration_sec),
    badge: v.source === "ai" ? "AI" : "Upload",
    badgeColor: v.source === "ai" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
    gradient: v.thumbnail,
  });

  return (
    <DashboardLayout searchPlaceholder="Search videos, folders, tags…">
      <PageHeader
        eyebrow="Your library"
        title={<>Every sip, <span className="italic text-primary">neatly shelved.</span></>}
        subtitle="Search, organize, and brew your archive into something fans can binge."
        action={
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} data-testid="library-file-input" />
            <button className="doodle-btn bg-surface h-11 px-4 text-sm" data-testid="library-new-folder"><Plus className="h-4 w-4" /> New folder</button>
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="doodle-btn btn-primary h-11 px-5 text-sm disabled:opacity-60" data-testid="library-upload">
              <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        }
      />

      <div className="doodle-card p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="relative flex-1 w-full max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your videos by title or tag…"
            className="w-full doodle-pill bg-background border-secondary/30 pl-11 pr-4 py-2.5 text-sm font-semibold focus:outline-none focus:border-secondary focus:ring-2 focus:ring-ring/40"
            data-testid="library-search" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">View</span>
          <div className="doodle-pill bg-background p-1 flex">
            <button onClick={() => setView("grid")} className={`h-9 w-9 rounded-full flex items-center justify-center ${view === "grid" ? "bg-primary text-primary-foreground" : ""}`} data-testid="view-grid"><Grid2x2 className="h-4 w-4" /></button>
            <button onClick={() => setView("list")} className={`h-9 w-9 rounded-full flex items-center justify-center ${view === "list" ? "bg-primary text-primary-foreground" : ""}`} data-testid="view-list"><List className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <section data-testid="folders">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl font-extrabold flex items-center gap-2"><Folder className="h-5 w-5" /> Folders</h2>
          <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{FOLDERS.length} collections</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {FOLDERS.map((f) => {
            const count = !items ? "·" : f.id === "all" ? items.length :
              f.id === "ai" ? items.filter(v => v.source === "ai").length :
              f.id === "upload" ? items.filter(v => v.source === "upload").length :
              f.id === "shorts" ? items.filter(v => v.ratio === "9:16").length :
              items.filter(v => v.ratio === "16:9").length;
            return (
              <FilterPill key={f.id} active={folder === f.id} onClick={() => setFolder(f.id)} testId={`folder-${f.id}`}>
                {f.name} <span className="ml-1.5 opacity-60">· {count}</span>
              </FilterPill>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl font-extrabold">{filtered.length} video{filtered.length === 1 ? "" : "s"}</h2>
          <button className="doodle-pill bg-surface text-sm font-extrabold px-4 py-2">Sort: Recent</button>
        </div>
        {items === null ? (
          <div className="doodle-card p-10 text-center text-muted-foreground font-bold">Loading your videos…</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Upload} title="Nothing brewing yet"
            subtitle={q ? "No matches — try a different search." : "Upload or AI-generate your first video to fill this shelf."}
            cta={<button onClick={handleQuickAdd} className="doodle-btn btn-primary h-11 px-5 text-sm"><Plus className="h-4 w-4" /> Add a video</button>} />
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5" data-testid="library-grid">
            {filtered.map((v, i) => (
              <div key={v.id} className="relative">
                <VideoCard item={toCardItem(v)} testId={`library-video-${i}`} />
                <div className="absolute top-6 right-6 flex gap-1.5">
                  <button onClick={() => toggle(v.id, favSet.has(v.id))} className="h-9 w-9 rounded-full bg-surface border-2 border-secondary inline-flex items-center justify-center shadow-doodle-sm" aria-label="Favorite" data-testid={`library-fav-${i}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={favSet.has(v.id) ? "hsl(var(--primary))" : "none"} stroke="hsl(var(--secondary))" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  </button>
                  <button onClick={() => remove(v.id)} className="h-9 w-9 rounded-full bg-surface border-2 border-secondary inline-flex items-center justify-center shadow-doodle-sm" aria-label="Delete" data-testid={`library-del-${i}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="doodle-card p-3 divide-y-2 divide-secondary/10" data-testid="library-list">
            {filtered.map((v, i) => (
              <div key={v.id} className="flex items-center gap-4 p-3 hover:bg-muted/30 rounded-[calc(var(--radius)-8px)]">
                <div className="h-14 w-24 rounded-lg border-2 border-secondary shrink-0 relative overflow-hidden" style={{ background: v.thumbnail }}>
                  <Play className="h-5 w-5 absolute inset-0 m-auto text-surface" />
                  <span className="absolute bottom-0.5 right-1 text-[10px] font-extrabold bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-sm">{fmtDuration(v.duration_sec)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-base md:text-lg font-extrabold truncate">{v.title}</div>
                  <div className="text-xs font-bold text-muted-foreground mt-0.5 flex items-center gap-2">
                    <span className="doodle-pill bg-surface px-2 py-0.5">{v.ratio}</span>
                    <span>• {relTime(v.created_at)} • {v.views} views</span>
                  </div>
                </div>
                <button onClick={() => remove(v.id)} className="doodle-pill bg-surface h-9 w-9 inline-flex items-center justify-center" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </section>
    </DashboardLayout>
  );
}
