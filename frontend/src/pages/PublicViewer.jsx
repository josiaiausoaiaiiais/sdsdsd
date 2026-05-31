import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Play, Pause, Volume2, VolumeX, Maximize, RotateCcw } from "lucide-react";
import { useVideoPlayer, fmtTime } from "@/hooks/useVideoPlayer";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const BACKEND = process.env.REACT_APP_BACKEND_URL;

/** Public viewer page used for /v/:id (shareable) AND /embed/:id (iframe). No auth required. */
export default function PublicViewer({ embed = false }) {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [pwError, setPwError] = useState(false);
  const [leadFields, setLeadFields] = useState({});
  const [submittedCtas, setSubmittedCtas] = useState(new Set());

  useEffect(() => {
    axios.get(`${API}/public/videos/${id}${window.location.search || ""}`)
      .then(r => {
        setData(r.data);
        setLocked(!!r.data.password_protected);
      })
      .catch(e => setErr(e?.response?.data?.detail || "Video not found"));
  }, [id]);

  const unlock = async () => {
    setUnlocking(true);
    setPwError(false);
    try {
      const r = await axios.post(`${API}/public/videos/${id}/unlock${window.location.search || ""}`, { password: pwInput });
      setData(prev => ({ ...prev, url: r.data.url || prev.url, password_protected: false }));
      setLocked(false);
    } catch {
      setPwError(true);
    } finally {
      setUnlocking(false);
    }
  };

  const {
    ref, playing, progress, duration, muted, ended, heatmap,
    onLoadedMetadata, onTimeUpdate, toggle, seek, reset, toggleMute, requestFullscreen, containerRef,
  } = useVideoPlayer({ videoId: id });

  if (err) return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6">
      <div className="nb-card text-center">
        <h1 className="font-heading text-2xl mb-2">Oh no — video unavailable</h1>
        <p className="text-ink/70">{err}</p>
      </div>
    </div>
  );
  if (!data) return <div className="min-h-screen bg-cream flex items-center justify-center font-heading">Loading…</div>;

  if (locked) return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6" data-testid="password-gate">
      <div className="nb-card max-w-sm w-full text-center">
        <div className="font-heading text-2xl mb-2" data-testid="password-gate-title">This video is protected</div>
        <p className="text-ink/70 text-sm mb-5">Enter the password to watch.</p>
        <input
          type="password"
          className="nb-input mb-3"
          value={pwInput}
          onChange={e => setPwInput(e.target.value)}
          placeholder="Password"
          onKeyDown={e => e.key === "Enter" && unlock()}
          data-testid="password-gate-input"
        />
        {pwError && <p className="text-coral text-xs mb-3" data-testid="password-gate-error">Wrong password. Try again.</p>}
        <button onClick={unlock} disabled={unlocking || !pwInput.trim()} className="nb-btn w-full" data-testid="password-gate-submit">
          {unlocking ? "Checking…" : "Unlock video"}
        </button>
      </div>
    </div>
  );

  const src = data.url?.startsWith("/api/") ? `${BACKEND}${data.url}` : data.url;
  const brandColor = data.brand?.color || "#FF6B6B";
  const logoText = data.brand?.logo_text || "Looma";
  const logoPosition = data.brand?.logo_position || "top-right";
  const logoPos = { "top-left": "top-4 left-4", "top-right": "top-4 right-4", "bottom-left": "bottom-4 left-4", "bottom-right": "bottom-4 right-4" }[logoPosition] || "top-4 right-4";
  const bucket = 40;
  const heatmapDisplay = Array.from({ length: bucket }, (_, i) => heatmap.find(h => h.index === i)?.intensity ?? 0.08);
  const currentTime = duration ? (progress / 100) * duration : 0;
  const activeCta = (data.ctas || []).filter(c => !submittedCtas.has(c.id)).slice().reverse().find(c => currentTime >= Number(c.timestamp || 0));
  const submitLead = async (cta) => {
    try {
      await axios.post(`${API}/public/videos/${id}/leads`, { cta_id: cta.id, email: leadFields.email, name: leadFields.name || "", fields: leadFields });
      setSubmittedCtas(prev => new Set([...prev, cta.id]));
    } catch {
      setLeadFields(f => ({ ...f, error: "Please enter a valid email." }));
    }
  };
  // End-screen conversion CTA: prefer a form (lead capture), else the latest CTA by timestamp.
  const sortedCtas = (data.ctas || []).slice().sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  const endCta = sortedCtas.find(c => c.type === "form") || sortedCtas[0] || null;
  const endCtaDone = endCta ? submittedCtas.has(endCta.id) : false;

  const player = (
    <div ref={containerRef} style={{ "--brand": brandColor }}
      className="player-shell relative w-full aspect-video bg-ink rounded-2xl nb-border nb-shadow-lg overflow-hidden group" data-testid="public-player">
      <video ref={ref} src={src} poster={data.thumbnail || undefined}
        className="w-full h-full object-contain bg-black"
        onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate}
        onClick={toggle} playsInline crossOrigin="anonymous"/>
      <div className={`absolute ${logoPos} bg-white/90 backdrop-blur px-3 py-1.5 rounded-full nb-border text-sm font-heading font-black flex items-center gap-1.5`} data-testid="public-player-brand">
        <span className="w-2 h-2 rounded-full" style={{ background: brandColor }}/>{logoText}
      </div>
      {activeCta && (
        <div className="absolute left-4 right-4 bottom-20 bg-white/95 nb-border rounded-2xl p-4 nb-shadow-sm" data-testid="public-cta-overlay">
          <div className="font-heading text-base mb-2">{activeCta.text}</div>
          {activeCta.type === "form" ? (
            <div className="space-y-2">
              {(activeCta.form_fields || ["email"]).map(f => <input key={f} className="nb-input text-xs" placeholder={f} value={leadFields[f] || ""} onChange={e=>setLeadFields(prev=>({...prev,[f]:e.target.value,error:""}))} data-testid={`public-lead-field-${f}`}/>) }
              {leadFields.error && <p className="text-coral text-xs" data-testid="public-lead-error">{leadFields.error}</p>}
              <button onClick={()=>submitLead(activeCta)} className="nb-btn text-xs py-2 px-3 w-full" data-testid="public-lead-submit">Submit</button>
            </div>
          ) : (
            <a href={activeCta.url || "#"} target="_blank" rel="noreferrer" className="nb-btn text-xs py-2 px-3 inline-flex" data-testid="public-cta-link">{activeCta.button_label || "Learn more"}</a>
          )}
        </div>
      )}
      {!playing && !ended && (
        <button onClick={toggle} aria-label="Play" data-testid="public-play"
          className="absolute inset-0 m-auto w-20 h-20 rounded-full nb-border text-white flex items-center justify-center shadow-[6px_6px_0_0_rgba(0,0,0,0.6)] transition-transform hover:scale-110"
          style={{ background: brandColor }}>
          <Play size={32} fill="white"/>
        </button>
      )}
      {ended && (
        <div className="absolute inset-0 bg-ink/90 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6" data-testid="public-end-screen">
          <div className="flex items-center gap-2 mb-4 bg-white/95 nb-border rounded-full px-4 py-2 font-heading font-black">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: brandColor }}/> {logoText}
          </div>
          {endCta && !endCtaDone ? (
            <div className="bg-white nb-border nb-shadow-lg rounded-2xl p-5 max-w-md w-full" data-testid="public-end-cta">
              <div className="font-heading text-xl mb-3 text-ink">{endCta.text || "Want to learn more?"}</div>
              {endCta.type === "form" ? (
                <div className="space-y-2">
                  {(endCta.form_fields || ["email"]).map(f => (
                    <input key={f} className="nb-input text-sm" placeholder={f}
                      value={leadFields[f] || ""} onChange={e => setLeadFields(prev => ({ ...prev, [f]: e.target.value, error: "" }))}
                      data-testid={`public-end-field-${f}`}/>
                  ))}
                  {leadFields.error && <p className="text-coral text-xs" data-testid="public-end-error">{leadFields.error}</p>}
                  <button onClick={() => submitLead(endCta)} className="nb-btn w-full text-sm" style={{ background: brandColor }} data-testid="public-end-submit">Submit</button>
                </div>
              ) : (
                <a href={endCta.url || "#"} target="_blank" rel="noreferrer" className="nb-btn w-full justify-center text-sm" style={{ background: brandColor }} data-testid="public-end-link">{endCta.button_label || "Learn more"}</a>
              )}
            </div>
          ) : (
            <div className="text-white font-heading text-xl mb-4">{endCtaDone ? "Thanks — we'll be in touch!" : "Thanks for watching!"}</div>
          )}
          <button onClick={reset} className="mt-5 nb-btn nb-btn-ghost bg-white text-sm" data-testid="public-end-replay"><RotateCcw size={16}/> Watch again</button>
        </div>
      )}
      <div className={`absolute bottom-0 left-0 right-0 p-3 transition-opacity opacity-0 group-hover:opacity-100 ${!playing ? 'opacity-100' : ''} bg-gradient-to-t from-black/80 to-transparent`}>
        <div className="flex items-end gap-[2px] h-5 mb-1 px-1">
          {heatmapDisplay.map((h, i) => (
            <div key={`seg-${i}`} className="flex-1 rounded-sm"
              style={{ height: `${Math.max(h*100,8)}%`, background: `hsla(168,47%,72%,${0.35 + h*0.6})` }}/>
          ))}
        </div>
        <div className="relative h-3 bg-white/25 rounded-full cursor-pointer mb-2" onClick={seek}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progress}%`, background: brandColor }}/>
          <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full nb-border bg-white" style={{ left: `calc(${progress}% - 8px)` }}/>
        </div>
        <div className="flex items-center justify-between text-white text-sm font-bold">
          <div className="flex items-center gap-2">
            <button onClick={toggle} className="player-ctrl p-2 rounded-full nb-border">{playing ? <Pause size={18}/> : <Play size={18} fill="white"/>}</button>
            <button onClick={reset} className="player-ctrl p-2 rounded-full nb-border"><RotateCcw size={16}/></button>
            <button onClick={toggleMute} className="player-ctrl p-2 rounded-full nb-border">{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>
            <span className="ml-2 font-heading tracking-tight">{fmtTime((progress/100)*duration)} / {fmtTime(duration)}</span>
          </div>
          <button onClick={requestFullscreen} className="player-ctrl p-2 rounded-full nb-border"><Maximize size={16}/></button>
        </div>
      </div>
    </div>
  );

  if (embed) {
    return <div className="w-screen h-screen bg-black flex items-center justify-center">{player}</div>;
  }
  return (
    <div className="min-h-screen bg-cream py-10 px-4">
      <script type="application/ld+json">{JSON.stringify({ "@context": "https://schema.org", "@type": "VideoObject", name: data.title, description: data.description || "", thumbnailUrl: data.thumbnail || "", uploadDate: data.created_at || new Date().toISOString(), embedUrl: `${window.location.origin}/embed/${id}${window.location.search || ""}` })}</script>
      <div className="max-w-4xl mx-auto">
        <a href="/" className="inline-flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-2xl bg-coral nb-border flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <span className="font-heading text-xl">Looma</span>
        </a>
        <h1 className="font-heading text-3xl md:text-4xl mb-2">{data.title}</h1>
        {data.description && <p className="text-ink/70 mb-5">{data.description}</p>}
        {player}
        {data.ctas?.some(c => c.type === "form") && <p className="text-xs text-ink/50 mt-3" data-testid="email-gate-note">This video may ask for an email at selected moments so the creator can follow up.</p>}
        {data.chapters?.length > 0 && <div className="nb-card mt-6" data-testid="public-chapters"><h3 className="font-heading text-lg mb-2">Table of contents</h3><div className="space-y-2">{data.chapters.map((c,i)=><button key={`${c.start}-${i}`} onClick={()=>{ if(ref.current) ref.current.currentTime=c.start; }} className="block w-full text-left nb-border rounded-xl bg-white px-3 py-2 text-sm hover:bg-mint/40" data-testid={`public-chapter-${i}`}><b className="text-coral mr-2">{Math.floor(c.start/60)}:{Math.floor(c.start%60).toString().padStart(2,"0")}</b>{c.text.slice(0,90)}</button>)}</div></div>}
        <div className="text-center mt-8">
          <a href="/signup" className="nb-btn">Create your own with Looma →</a>
        </div>
      </div>
    </div>
  );
}
