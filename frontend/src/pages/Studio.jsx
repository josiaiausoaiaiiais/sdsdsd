import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Play, Pause, Volume2, VolumeX, Maximize, RotateCcw, RotateCw,
  Upload, Film, Sparkles, Palette, Type, Layers, Download, Share2, Check,
} from "lucide-react";
import DashboardLayout, { PageHeader } from "../components/DashboardLayout";
import { FilterPill } from "../components/brewly/MediaPrimitives";
import { useUploads, fmtDuration, savePreset, resolveVideoUrl } from "../lib/data";

/* Demo coral→mustard placeholder if user hasn't picked anything yet.
   Plays as a poster + animated SVG since we don't have real media. */
const DEMO_POSTER = "linear-gradient(135deg, hsl(8 85% 67%), hsl(45 95% 65%))";
const DEMO_VIDEO = "https://vjs.zencdn.net/v/oceans.mp4";

const ACCENT_PRESETS = [
  { id: "coral",   name: "Coral",   hsl: "8 85% 67%",   onColor: "40 50% 98%" },
  { id: "mustard", name: "Mustard", hsl: "45 95% 65%",  onColor: "170 40% 12%" },
  { id: "ink",     name: "Ink",     hsl: "170 40% 12%", onColor: "40 50% 98%" },
  { id: "berry",   name: "Berry",   hsl: "330 70% 65%", onColor: "40 50% 98%" },
  { id: "sea",     name: "Sea",     hsl: "190 65% 55%", onColor: "40 50% 98%" },
];

const THEMES = [
  { id: "cream", name: "Cream",  bg: "40 50% 98%",  fg: "170 40% 12%" },
  { id: "ink",   name: "Ink",    bg: "170 40% 12%", fg: "40 50% 98%" },
  { id: "mint",  name: "Mint",   bg: "152 45% 88%", fg: "170 40% 12%" },
];

const ICON_STYLES = [
  { id: "filled", name: "Filled" },
  { id: "outline", name: "Outline" },
];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function BrewlyVideoPlayer({ src, poster, accent, theme, iconStyle, lowerThird }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showCenter, setShowCenter] = useState(true);
  const [fading, setFading] = useState(false);
  const [ready, setReady] = useState(false);

  const accentVar = `hsl(${accent.hsl})`;
  const onAccent = `hsl(${accent.onColor})`;
  const bgVar = `hsl(${theme.bg})`;
  const fgVar = `hsl(${theme.fg})`;
  const filled = iconStyle.id === "filled";

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setProgress(v.currentTime);
    const onMeta = () => { setDuration(v.duration || 0); setReady(v.readyState >= 2); };
    const onCanPlay = () => setReady(true);
    const onPlay = () => { setPlaying(true); setFading(true); setTimeout(() => setShowCenter(false), 250); };
    const onPause = () => { setPlaying(false); setFading(false); setShowCenter(true); };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  // Reset when src changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setPlaying(false); setProgress(0); setShowCenter(true); setFading(false); setReady(false);
    v.load();
  }, [src]);

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } else {
      v.pause();
    }
  };
  const seek = (sec) => { const v = videoRef.current; if (v) v.currentTime = clamp(sec, 0, duration || 0); };
  const onScrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    seek(pct * (duration || 0));
  };
  const toggleMute = () => { const v = videoRef.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };
  const toggleFullscreen = () => {
    const el = videoRef.current?.parentElement?.parentElement;
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const fmt = (s) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, "0")}`;
  };

  const PlayIcon = filled ? <Play className="h-8 w-8 ml-1" fill={onAccent} stroke="none" /> : <Play className="h-8 w-8 ml-1" strokeWidth={2.5} />;
  const PauseIcon = filled ? <Pause className="h-8 w-8" fill={onAccent} stroke="none" /> : <Pause className="h-8 w-8" strokeWidth={2.5} />;

  return (
    <div
      className="relative w-full aspect-video rounded-[var(--radius)] border-2 border-secondary overflow-hidden shadow-doodle"
      style={{ background: bgVar, color: fgVar }}
      data-testid="brewly-player"
    >
      {/* Video */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover bg-black cursor-pointer"
        poster={undefined}
        playsInline
        onClick={togglePlay}
        data-testid="player-video"
      >
        <source src={src} />
      </video>

      {/* Poster overlay shown while video isn't ready yet */}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
             style={{ background: poster || DEMO_POSTER }}>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 340" fill="none" aria-hidden="true">
            <path d="M30 240 Q120 200 220 240 T420 240 T600 240" stroke="hsl(var(--surface))" strokeWidth="3" opacity="0.5" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {/* Click-to-play big center button */}
      <button
        onClick={togglePlay}
        className={`absolute inset-0 flex items-center justify-center transition-opacity ${
          showCenter ? "opacity-100" : "opacity-0 hover:opacity-100"
        }`}
        aria-label={playing ? "Pause" : "Play"}
        data-testid="player-center-btn"
      >
        <span
          className="h-20 w-20 md:h-24 md:w-24 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          style={{
            background: accentVar,
            color: onAccent,
            borderColor: "hsl(var(--secondary))",
            boxShadow: `4px 4px 0 0 hsl(var(--secondary))`,
          }}
        >
          {playing ? PauseIcon : PlayIcon}
        </span>
      </button>

      {/* Lower-third title chip */}
      {lowerThird && (
        <div className="absolute left-4 bottom-16 doodle-pill px-3 py-1.5 text-xs font-extrabold pointer-events-none"
             style={{ background: accentVar, color: onAccent, boxShadow: "2px 2px 0 0 hsl(var(--secondary))" }}>
          ✦ {lowerThird}
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 p-3 md:p-4 flex flex-col gap-2 bg-gradient-to-t from-black/55 to-transparent">
        {/* Scrubber */}
        <div className="cursor-pointer h-2 rounded-full relative"
             style={{ background: "rgba(255,255,255,0.25)" }}
             onClick={onScrub}
             data-testid="player-scrubber">
          <div className="h-full rounded-full transition-[width] duration-100"
               style={{ width: `${pct}%`, background: accentVar }} />
          <div className="absolute -top-1 h-4 w-4 rounded-full border-2"
               style={{ left: `calc(${pct}% - 8px)`, background: accentVar, borderColor: "hsl(var(--secondary))" }} />
        </div>
        <div className="flex items-center gap-2 text-surface">
          <button onClick={togglePlay} className="h-9 w-9 rounded-full inline-flex items-center justify-center hover:scale-110 transition-transform"
                  style={{ background: accentVar, color: onAccent, border: "2px solid hsl(var(--secondary))" }}
                  data-testid="player-play-btn" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-4 w-4" fill={filled ? onAccent : "none"} /> : <Play className="h-4 w-4 ml-0.5" fill={filled ? onAccent : "none"} />}
          </button>
          <button onClick={() => seek(progress - 10)} className="h-8 w-8 rounded-full inline-flex items-center justify-center bg-surface/20 hover:bg-surface/30" aria-label="Back 10s" data-testid="player-back">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => seek(progress + 10)} className="h-8 w-8 rounded-full inline-flex items-center justify-center bg-surface/20 hover:bg-surface/30" aria-label="Forward 10s" data-testid="player-forward">
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={toggleMute} className="h-8 w-8 rounded-full inline-flex items-center justify-center bg-surface/20 hover:bg-surface/30" aria-label="Mute" data-testid="player-mute">
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <span className="text-xs font-extrabold tabular-nums ml-1" data-testid="player-time">{fmt(progress)} / {fmt(duration)}</span>
          <span className="ml-auto" />
          <button onClick={toggleFullscreen} className="h-8 w-8 rounded-full inline-flex items-center justify-center bg-surface/20 hover:bg-surface/30" aria-label="Fullscreen" data-testid="player-fullscreen">
            <Maximize className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolPanel({ title, icon: Icon, children }) {
  return (
    <div className="doodle-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-8 w-8 rounded-full bg-accent border-2 border-secondary inline-flex items-center justify-center">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="font-display text-lg font-extrabold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function StudioPage() {
  const { items: uploads } = useUploads();
  const [selectedId, setSelectedId] = useState(null);
  const [customSrc, setCustomSrc] = useState("");
  const [accent, setAccent] = useState(ACCENT_PRESETS[0]);
  const [customAccent, setCustomAccent] = useState("#ff7a59");
  const [theme, setTheme] = useState(THEMES[0]);
  const [iconStyle, setIconStyle] = useState(ICON_STYLES[0]);
  const [lowerThird, setLowerThird] = useState("Brewly Studio");

  const selected = useMemo(() =>
    (uploads || []).find(u => u.id === selectedId) || null,
  [uploads, selectedId]);

  // Load preset when a library video is picked
  useEffect(() => {
    if (!selected?.preset) return;
    const p = selected.preset;
    if (p.accent_id) {
      const found = ACCENT_PRESETS.find(x => x.id === p.accent_id);
      if (found) setAccent(found);
      else if (p.accent_hsl) setAccent({ id: "custom", name: "Custom", hsl: p.accent_hsl, onColor: p.accent_on || "40 50% 98%" });
    }
    if (p.theme_id) {
      const t = THEMES.find(x => x.id === p.theme_id); if (t) setTheme(t);
    }
    if (p.icon_style) {
      const ic = ICON_STYLES.find(x => x.id === p.icon_style); if (ic) setIconStyle(ic);
    }
    if (typeof p.lower_third === "string") setLowerThird(p.lower_third);
  }, [selected?.id]);

  // Auto-save preset when selected video has changes (debounced)
  useEffect(() => {
    if (!selected?.id) return;
    const t = setTimeout(() => {
      savePreset(selected.id, {
        accent_id: accent.id, accent_hsl: accent.hsl, accent_on: accent.onColor,
        theme_id: theme.id, icon_style: iconStyle.id, lower_third: lowerThird,
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [selected?.id, accent, theme, iconStyle, lowerThird]);

  const playerSrc = customSrc || resolveVideoUrl(selected?.video_url) || DEMO_VIDEO;
  const posterBg = selected?.thumbnail || DEMO_POSTER;

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (customSrc && customSrc.startsWith("blob:")) URL.revokeObjectURL(customSrc);
    const url = URL.createObjectURL(f);
    setCustomSrc(url);
    setSelectedId(null);
  };

  const onCustomAccent = (hex) => {
    setCustomAccent(hex);
    // Convert hex → HSL approximation by just setting as raw hex via fallback HSL var
    const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s; const l = (max+min)/2;
    if (max === min) { h = s = 0; }
    else {
      const d = max-min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){case r: h=(g-b)/d+(g<b?6:0); break; case g: h=(b-r)/d+2; break; default: h=(r-g)/d+4;}
      h *= 60;
    }
    setAccent({ id: "custom", name: "Custom", hsl: `${Math.round(h)} ${Math.round(s*100)}% ${Math.round(l*100)}%`, onColor: l > 0.6 ? "170 40% 12%" : "40 50% 98%" });
  };

  return (
    <DashboardLayout searchPlaceholder="Search your studio…">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-3 w-3" /> Studio</span>}
        title={<>Make every video <span className="italic text-primary">unmistakably yours.</span></>}
        subtitle="Drop in a clip, brush in your colors, and ship a player that feels like your brand — not someone else's."
        action={
          <div className="flex gap-2">
            <button className="doodle-btn bg-surface h-11 px-4 text-sm" data-testid="studio-share"><Share2 className="h-4 w-4" /> Share</button>
            <button className="doodle-btn btn-primary h-11 px-5 text-sm" data-testid="studio-export"><Download className="h-4 w-4" /> Export</button>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        {/* Center: player + library */}
        <div className="space-y-6">
          {/* Player card */}
          <div className="doodle-card-lg p-4 md:p-5" data-testid="player-card">
            <BrewlyVideoPlayer
              src={playerSrc}
              poster={posterBg}
              accent={accent}
              theme={theme}
              iconStyle={iconStyle}
              lowerThird={lowerThird}
            />
            <div className="mt-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-primary">Now editing</div>
                <div className="font-display text-xl font-extrabold leading-tight">
                  {selected?.title || (customSrc ? "Custom upload" : "Demo · Brewly intro reel")}
                </div>
              </div>
              <div className="flex gap-2">
                <label htmlFor="studio-file" className="doodle-btn bg-surface h-10 px-4 text-sm cursor-pointer" data-testid="studio-upload">
                  <Upload className="h-4 w-4" /> Upload your video
                  <input id="studio-file" type="file" accept="video/*" className="hidden" onChange={handleFile} />
                </label>
              </div>
            </div>
          </div>

          {/* Pick from library */}
          <div className="doodle-card p-5" data-testid="studio-library">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-primary">From your library</div>
                <h2 className="font-display text-xl font-extrabold">Pick a video to brand</h2>
              </div>
              <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                {uploads === null ? "Loading…" : `${uploads.length} videos`}
              </span>
            </div>
            {uploads === null ? (
              <div className="text-center py-6 text-muted-foreground font-bold">Brewing your library…</div>
            ) : uploads.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground font-bold">Upload a video above to get started.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {uploads.slice(0, 8).map(v => {
                  const active = selectedId === v.id;
                  return (
                    <button key={v.id} onClick={() => { setSelectedId(v.id); setCustomSrc(""); }}
                            className={`relative aspect-video rounded-[calc(var(--radius)-6px)] border-2 overflow-hidden text-left transition-transform hover:-translate-y-0.5 ${
                              active ? "border-primary shadow-[3px_3px_0_0_hsl(var(--primary))]" : "border-secondary shadow-doodle-sm"
                            }`}
                            style={{ background: v.thumbnail }}
                            data-testid={`studio-pick-${v.id}`}>
                      {active && (
                        <span className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-primary border-2 border-secondary inline-flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3.5} />
                        </span>
                      )}
                      <span className="absolute bottom-1 right-1 text-[9px] font-extrabold bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                        {fmtDuration(v.duration_sec)}
                      </span>
                      <span className="absolute inset-x-2 bottom-2 text-surface text-[11px] font-extrabold leading-tight line-clamp-1 drop-shadow">
                        {v.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: customization rail */}
        <div className="space-y-5" data-testid="studio-rail">
          <ToolPanel title="Accent color" icon={Palette}>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map(p => (
                <button key={p.id} onClick={() => setAccent(p)}
                        className={`h-9 px-3 rounded-full border-2 border-secondary text-xs font-extrabold inline-flex items-center gap-1.5 transition-transform hover:-translate-y-0.5 ${
                          accent.id === p.id ? "shadow-[2px_2px_0_0_hsl(var(--secondary))]" : ""
                        }`}
                        style={{ background: `hsl(${p.hsl})`, color: `hsl(${p.onColor})` }}
                        data-testid={`accent-${p.id}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: `hsl(${p.onColor})` }} />
                  {p.name}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">Custom</span>
              <input type="color" value={customAccent} onChange={(e) => onCustomAccent(e.target.value)}
                     className="h-8 w-12 rounded-full border-2 border-secondary cursor-pointer bg-transparent"
                     data-testid="accent-custom" />
              <span className="text-xs font-bold text-muted-foreground">{customAccent}</span>
            </div>
          </ToolPanel>

          <ToolPanel title="Theme" icon={Layers}>
            <div className="flex gap-2">
              {THEMES.map(t => (
                <button key={t.id} onClick={() => setTheme(t)}
                        className={`flex-1 doodle-pill border-2 border-secondary text-xs font-extrabold py-2 transition-transform hover:-translate-y-0.5 ${
                          theme.id === t.id ? "shadow-[2px_2px_0_0_hsl(var(--secondary))]" : ""
                        }`}
                        style={{ background: `hsl(${t.bg})`, color: `hsl(${t.fg})` }}
                        data-testid={`theme-${t.id}`}>
                  {t.name}
                </button>
              ))}
            </div>
          </ToolPanel>

          <ToolPanel title="Icon style" icon={Film}>
            <div className="flex gap-2">
              {ICON_STYLES.map(s => (
                <FilterPill key={s.id} active={iconStyle.id === s.id} onClick={() => setIconStyle(s)} testId={`icon-${s.id}`}>
                  {s.name}
                </FilterPill>
              ))}
            </div>
            <p className="mt-3 text-xs font-bold text-muted-foreground">Click anywhere on the player to play / pause. Center button mirrors your accent.</p>
          </ToolPanel>

          <ToolPanel title="Lower-third title" icon={Type}>
            <input
              value={lowerThird}
              onChange={(e) => setLowerThird(e.target.value)}
              placeholder="e.g. Episode 03 · pricing"
              maxLength={32}
              className="w-full doodle-pill bg-background border-secondary/30 px-4 py-2.5 text-sm font-semibold focus:outline-none focus:border-secondary focus:ring-2 focus:ring-ring/40"
              data-testid="lower-third-input"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
              <span>Shows above the controls</span>
              <span>{lowerThird.length}/32</span>
            </div>
          </ToolPanel>

          {/* Live summary */}
          <div className="doodle-card p-5" data-testid="studio-summary">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-primary">Preview summary</div>
            <h3 className="font-display text-lg font-extrabold mt-1">Your player, briefly.</h3>
            <ul className="mt-3 space-y-1.5 text-sm font-bold">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Accent</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border border-secondary" style={{ background: `hsl(${accent.hsl})` }} />
                  {accent.name}
                </span>
              </li>
              <li className="flex items-center justify-between"><span className="text-muted-foreground">Theme</span><span>{theme.name}</span></li>
              <li className="flex items-center justify-between"><span className="text-muted-foreground">Icons</span><span>{iconStyle.name}</span></li>
              <li className="flex items-center justify-between truncate"><span className="text-muted-foreground">Title</span><span className="truncate ml-2">{lowerThird || "—"}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
