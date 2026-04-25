import React, { useState } from "react";
import { Wand2, Sparkles, Scissors, Upload, Play, Download, Share2, Clock, Check, Zap, Loader2, AlertCircle } from "lucide-react";
import DashboardLayout, { PageHeader } from "../components/DashboardLayout";
import { FilterPill } from "../components/brewly/MediaPrimitives";
import { generateRemix, resolveVideoUrl } from "../lib/data";

const STYLES = ["Bold & Punchy", "Cozy Tutorial", "Story Arc", "Quote Reel", "Fan Moments"];
const RATIOS = ["9:16 · TikTok/Reels", "1:1 · Feed", "16:9 · YouTube"];

export default function RemixPage() {
  const [style, setStyle] = useState(STYLES[1]);
  const [ratio, setRatio] = useState(RATIOS[0]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [clips, setClips] = useState([]);

  const handleGenerate = async () => {
    if (!prompt.trim()) { setErr("Add a prompt — what should we brew?"); return; }
    setErr(""); setBusy(true);
    try {
      const ratioCode = ratio.split(" ")[0];
      const out = await generateRemix(prompt, style, ratioCode);
      setClips(prev => [out, ...prev]);
      setPrompt("");
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || "Generation failed");
    } finally { setBusy(false); }
  };

  return (
    <DashboardLayout searchPlaceholder="Search remixes…">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3" /> Remix · AI powered</span>}
        title={<>Slice long videos into <span className="italic text-primary">scroll-stopping</span> clips.</>}
        subtitle="Drop a prompt — Brewly's AI brews a captioned, on-brand short for your feed."
        action={<button onClick={handleGenerate} disabled={busy} className="doodle-btn btn-primary h-11 px-5 text-sm disabled:opacity-60" data-testid="remix-quick-generate">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} {busy ? "Brewing…" : "New remix"}
        </button>}
      />

      {/* Banner */}
      <div className="relative doodle-card-lg p-7 md:p-9 overflow-hidden" data-testid="remix-banner">
        <div className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -left-16 -bottom-16 h-72 w-72 rounded-full bg-accent/40 blur-3xl" />
        <div className="relative grid lg:grid-cols-[1fr_1fr] gap-8 items-center">
          <div>
            <div className="doodle-pill bg-accent inline-flex items-center gap-1.5 px-3 py-1 text-xs font-extrabold" style={{ boxShadow: "2px 2px 0 0 hsl(var(--secondary))" }}>
              <Sparkles className="h-3.5 w-3.5" /> Live · powered by fal.ai
            </div>
            <h2 className="mt-3 font-display text-3xl md:text-4xl font-extrabold leading-tight">
              Type your idea. <span className="italic text-primary">Get a clip.</span>
            </h2>
            <p className="mt-2 text-muted-foreground">Describe the moment you want — our AI generates a 6-second short with your vibe baked in.</p>

            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. A cozy creator pouring coffee at sunrise, soft warm light, hands close-up"
              className="mt-5 w-full rounded-[var(--radius)] border-2 border-secondary bg-surface/80 p-4 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring/40 min-h-[110px] resize-none"
              maxLength={500}
              data-testid="remix-prompt"
            />
            <div className="mt-2 text-right text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">{prompt.length}/500</div>

            <div className="mt-3 space-y-3">
              <div>
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mb-2">Clip style</div>
                <div className="flex flex-wrap gap-2">
                  {STYLES.map((s) => (
                    <FilterPill key={s} active={style === s} onClick={() => setStyle(s)} testId={`remix-style-${s.split(" ")[0].toLowerCase()}`}>{s}</FilterPill>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mb-2">Aspect</div>
                <div className="flex flex-wrap gap-2">
                  {RATIOS.map((r) => (
                    <FilterPill key={r} active={ratio === r} onClick={() => setRatio(r)} testId={`remix-ratio-${r.split(" ")[0].replace(":","x")}`}>{r}</FilterPill>
                  ))}
                </div>
              </div>
            </div>

            {err && <div className="mt-4 doodle-pill bg-destructive/10 px-4 py-2 text-sm font-bold text-destructive inline-flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {err}</div>}

            <button onClick={handleGenerate} disabled={busy} className="mt-5 doodle-btn btn-primary h-12 px-6 disabled:opacity-60" data-testid="remix-generate">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {busy ? "Brewing your clip…" : "Remix with AI"}
            </button>
          </div>

          <div className="relative hidden lg:block">
            <div className="aspect-square rounded-[calc(var(--radius)+4px)] border-2 border-secondary overflow-hidden relative shadow-doodle-lg"
                 style={{ background: "linear-gradient(135deg, hsl(8 85% 67%), hsl(45 95% 65%))" }}>
              <div className="absolute inset-0 flex items-center justify-center animate-float">
                <div className="h-24 w-24 rounded-full bg-surface border-2 border-secondary flex items-center justify-center shadow-doodle">
                  {busy ? <Loader2 className="h-10 w-10 animate-spin" /> : <Scissors className="h-10 w-10" />}
                </div>
              </div>
            </div>
            <div className="absolute -top-3 -left-3 doodle-pill bg-surface px-3 py-1.5 text-xs font-extrabold" style={{ boxShadow: "2px 2px 0 0 hsl(var(--secondary))" }}>
              ✂ {clips.length} clip{clips.length === 1 ? "" : "s"}
            </div>
            <div className="absolute -bottom-3 -right-3 doodle-pill bg-accent px-3 py-1.5 text-xs font-extrabold animate-wiggle" style={{ boxShadow: "2px 2px 0 0 hsl(var(--secondary))" }}>
              ✨ AI live
            </div>
          </div>
        </div>
      </div>

      {/* Generated clips */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-primary">Your remixes</div>
            <h2 className="font-display text-2xl font-extrabold">{clips.length === 0 ? "Brew your first clip" : "Freshly clipped"}</h2>
          </div>
          {clips.length > 0 && (
            <div className="doodle-pill bg-accent px-3 py-1.5 text-xs font-extrabold inline-flex items-center gap-1.5" style={{ boxShadow: "2px 2px 0 0 hsl(var(--secondary))" }}>
              <Check className="h-3.5 w-3.5" /> Auto-saved to library
            </div>
          )}
        </div>

        {clips.length === 0 ? (
          <div className="doodle-card p-10 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-accent border-2 border-secondary flex items-center justify-center shadow-doodle-sm"><Sparkles className="h-7 w-7" /></div>
            <h3 className="mt-4 font-display text-2xl font-extrabold">Nothing brewing yet</h3>
            <p className="mt-2 text-muted-foreground max-w-md mx-auto">Type a prompt above and tap <b>Remix with AI</b>. Your generated clip will land here and in your library.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5" data-testid="remix-clips">
            {clips.map((c, i) => (
              <div key={c.id} className="doodle-card p-4" data-testid={`remix-clip-${i}`}>
                <div className="relative aspect-[9/16] rounded-[calc(var(--radius)-4px)] border-2 border-secondary overflow-hidden shadow-doodle-sm bg-black">
                  {c.video_url ? (
                    <video src={resolveVideoUrl(c.video_url)} className="absolute inset-0 h-full w-full object-cover" controls playsInline />
                  ) : (
                    <div className="absolute inset-0" style={{ background: c.thumbnail }} />
                  )}
                  <div className="absolute top-2.5 left-2.5 doodle-pill bg-surface px-2 py-0.5 text-[10px] font-extrabold pointer-events-none">{c.ratio}</div>
                </div>
                <div className="mt-3 font-display text-sm font-extrabold leading-tight line-clamp-2">{c.title}</div>
                <div className="mt-3 flex gap-1.5">
                  <a href={resolveVideoUrl(c.video_url)} download className="doodle-pill bg-surface flex-1 py-1.5 text-xs font-extrabold inline-flex items-center justify-center gap-1"><Download className="h-3.5 w-3.5" /> Save</a>
                  <button className="doodle-pill bg-primary text-primary-foreground px-2 py-1.5 text-xs font-extrabold inline-flex items-center gap-1" style={{ boxShadow: "2px 2px 0 0 hsl(var(--secondary))" }}><Share2 className="h-3.5 w-3.5" /> Share</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

