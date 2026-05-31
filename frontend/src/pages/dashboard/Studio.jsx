import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import axios from "axios";
import VideoPlayer from "@/components/VideoPlayer";
import { Sparkles, Scissors, Palette, FileText, Share2, ArrowLeft, Copy, RefreshCw, Loader2, MessageCircle, MousePointerClick, ShieldCheck, ListTree } from "lucide-react";
import { toast } from "sonner";
import { CommentsPanel } from "@/components/CommentsPanel";

export default function Studio() {
  const { id } = useParams();
  const { authHeader, API } = useAuth();
  const [video, setVideo] = useState(null);
  const [transcript, setTranscript] = useState(null); // {status, text, segments}
  const [tab, setTab] = useState("transcript");
  const [brand, setBrand] = useState({ color: "#FF6B6B", logo_text: "Looma" });
  const [ctas, setCtas] = useState([]);
  const [leads, setLeads] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [ctaForm, setCtaForm] = useState({ type: "cta", timestamp: 5, text: "Ready to take the next step?", button_label: "Book a demo", url: "", form_fields: "name,email" });
  const [domains, setDomains] = useState("");
  const [studioClips, setStudioClips] = useState([]);
  const [studioRendering, setStudioRendering] = useState(null);
  const playerSeekRef = useRef(null);
  const nav = useNavigate();
  const BACKEND = process.env.REACT_APP_BACKEND_URL;

  const load = useCallback(() => {
    axios.get(`${API}/videos/${id}`, { headers: authHeader() })
      .then(r => { setVideo(r.data); setDomains((r.data.allowed_domains || []).join('\n')); })
      .catch(() => { toast.error("Video not found"); nav("/app/library"); });
    axios.get(`${API}/videos/${id}/transcript`, { headers: authHeader() })
      .then(r => setTranscript(r.data)).catch(()=>{});
    axios.get(`${API}/brand`, { headers: authHeader() })
      .then(r => setBrand(b => ({ ...b, ...r.data }))).catch(()=>{});
    axios.get(`${API}/videos/${id}/ctas`, { headers: authHeader() })
      .then(r => setCtas(r.data || [])).catch(()=>{});
    axios.get(`${API}/analytics/leads`, { headers: authHeader() })
      .then(r => setLeads(r.data)).catch(()=>{});
    axios.get(`${API}/analytics/audit`, { headers: authHeader() })
      .then(r => setAuditRows(r.data.events || [])).catch(()=>{});
  }, [id, API, authHeader, nav]);

  useEffect(() => { load(); }, [load]);

  // Poll transcript while pending
  useEffect(() => {
    if (!video) return;
    if (video.transcript_status !== "pending") return;
    const it = setInterval(load, 5000);
    return () => clearInterval(it);
  }, [video, load]);

  const retranscribe = async () => {
    try {
      await axios.post(`${API}/videos/${id}/transcribe`, {}, { headers: authHeader() });
      toast.info("Transcription queued");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cannot transcribe (no uploaded file)");
    }
  };

  // Load AI clip suggestions when the remix tab opens
  useEffect(() => {
    if (tab !== "remix" || !id) return;
    axios.get(`${API}/videos/${id}/clips`, { headers: authHeader() })
      .then(r => setStudioClips(r.data?.clips || []))
      .catch(() => setStudioClips([]));
  }, [tab, id, API, authHeader]);

  const studioRenderClip = async (clip, aspectRatio) => {
    if (!video?.storage_path) {
      toast.info("Clip export is available for uploaded videos.");
      return;
    }
    const key = `${clip.start}-${aspectRatio}`;
    setStudioRendering(key);
    try {
      const r = await axios.post(`${API}/videos/${id}/clips/render`,
        { start: clip.start, end: clip.end, aspect_ratio: aspectRatio, caption: clip.text || clip.caption_text || "" },
        { headers: authHeader() });
      const fileUrl = `${BACKEND}${r.data.url}`;
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = `clip-${aspectRatio.replace(":", "x")}.mp4`;
      a.target = "_blank";
      document.body.appendChild(a); a.click(); a.remove();
      toast.success(`Clip rendered (${aspectRatio}) — download started`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Clip render failed");
    } finally { setStudioRendering(null); }
  };

  if (!video) return <div className="p-10 font-heading text-xl">Loading studio…</div>;

  const playableSrc = video.url?.startsWith("/api/") ? `${BACKEND}${video.url}` : video.url;
  const privateQuery = video.private_enabled && video.private_token ? `?token=${video.private_token}` : "";
  const embedUrl = `${window.location.origin}/embed/${video.id}${privateQuery}`;
  const shareUrl = `${window.location.origin}/v/${video.id}${privateQuery}`;
  const schema = { "@context": "https://schema.org", "@type": "VideoObject", name: video.title, description: video.description || "", thumbnailUrl: video.thumbnail || brand.default_thumbnail || "", uploadDate: video.created_at, contentUrl: playableSrc, embedUrl };
  const embedCode = `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;
  const copyEmbed = () => { navigator.clipboard.writeText(embedCode); toast.success("Embed code copied!"); };
  const copyShare = () => { navigator.clipboard.writeText(shareUrl); toast.success("Share link copied!"); };

  const tabs = [
    { id: "transcript", icon: FileText, label: "Transcript" },
    { id: "remix", icon: Scissors, label: "Remix" },
    { id: "brand", icon: Palette, label: "Brand" },
    { id: "convert", icon: MousePointerClick, label: "Convert" },
    { id: "chapters", icon: ListTree, label: "Chapters" },
    { id: "comments", icon: MessageCircle, label: "Comments" },
    { id: "share", icon: Share2, label: "Share" },
    { id: "security", icon: ShieldCheck, label: "Security" },
  ];

  const statusBadge = {
    none:   { txt: "No transcript", bg: "bg-white" },
    pending:{ txt: "Generating…",   bg: "bg-gold" },
    ready:  { txt: "Ready",         bg: "bg-mint" },
    error:  { txt: "Failed",        bg: "bg-coral text-white" },
  }[transcript?.status || video.transcript_status || "none"];

  return (
    <div className="p-6 md:p-8 max-w-[1400px]">
      <button onClick={()=>nav("/app/library")} className="text-sm font-bold mb-4 flex items-center gap-1.5 hover:text-coral"><ArrowLeft size={16}/> Back to library</button>
      <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
        <div>
          <div className="font-hand text-xl text-coral">studio</div>
          <h1 className="font-heading text-3xl truncate max-w-xl">{video.title}</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-ink/70">{video.views} views · {video.plays} plays</span>
          <span className={`nb-border ${statusBadge.bg} font-heading text-xs px-3 py-1 rounded-full flex items-center gap-1.5`}>
            {transcript?.status === "pending" && <Loader2 size={12} className="animate-spin"/>}
            {statusBadge.txt}
          </span>
          <button className="nb-btn nb-btn-gold text-sm py-2.5 px-5"><Sparkles size={16}/> Publish</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <VideoPlayer
            src={playableSrc}
            videoId={video.id}
            brandColor={brand.color}
            logoText={brand.logo_text || "Looma"}
            logoPosition={brand.logo_position || "top-right"}
            thumbnail={video.thumbnail || brand.default_thumbnail}
            ctas={ctas}
          />
        </div>
        <div className="nb-card p-0 overflow-hidden">
          <div className="flex border-b-2 border-ink bg-cream">
            {tabs.map(t => (
              <button key={t.id} onClick={()=>setTab(t.id)} data-testid={`studio-tab-${t.id}`}
                className={`flex-1 py-3 px-2 font-heading text-sm font-bold flex items-center justify-center gap-1.5 ${tab===t.id ? 'bg-white text-ink' : 'text-ink/60 hover:bg-white/60'}`}>
                <t.icon size={15}/> {t.label}
              </button>
            ))}
          </div>
          <div className="p-5 max-h-[480px] overflow-y-auto scrollbar-thin">
            {tab === "transcript" && (
              <div className="space-y-2">
                {transcript?.status === "pending" && (
                  <div className="text-center py-6">
                    <Loader2 size={32} className="animate-spin mx-auto mb-2 text-coral"/>
                    <p className="text-sm text-ink/70">Generating transcript with Whisper…</p>
                  </div>
                )}
                {transcript?.status === "error" && (
                  <div className="text-center py-4">
                    <p className="text-sm text-ink/80 mb-3">Transcription failed.</p>
                    <button onClick={retranscribe} className="nb-btn text-sm py-2 px-4"><RefreshCw size={14}/> Retry</button>
                  </div>
                )}
                {(transcript?.status === "none" || !transcript) && (
                  <div className="text-center py-4">
                    <p className="text-sm text-ink/80 mb-3">No transcript yet.</p>
                    {video.storage_path
                      ? <button onClick={retranscribe} className="nb-btn text-sm py-2 px-4"><Sparkles size={14}/> Generate</button>
                      : <p className="text-xs text-ink/60">Transcript only available for videos uploaded to Looma.</p>}
                  </div>
                )}
                {transcript?.status === "ready" && transcript.segments?.length > 0 && (
                  <>
                    {transcript.segments.map((l, i) => (
                      <button key={`seg-${l.start}-${i}`} onClick={()=>{
                        const el = document.querySelector("[data-testid='video-player'] video");
                        if (el) el.currentTime = l.start;
                      }} className="flex gap-3 px-2 py-2 rounded-lg hover:bg-gold/30 cursor-pointer text-left w-full">
                        <span className="font-bold text-coral text-xs w-12 shrink-0 pt-0.5">{Math.floor(l.start/60)}:{Math.floor(l.start%60).toString().padStart(2,"0")}</span>
                        <p className="text-ink/90 text-sm leading-relaxed">{l.text}</p>
                      </button>
                    ))}
                    <button onClick={retranscribe} className="nb-btn nb-btn-ghost text-xs py-1.5 px-3 mt-4"><RefreshCw size={12}/> Re-transcribe</button>
                  </>
                )}
                {transcript?.status === "ready" && transcript.segments?.length === 0 && transcript.text && (
                  <p className="text-sm text-ink/80">{transcript.text}</p>
                )}
              </div>
            )}
            {tab === "comments" && (
              <CommentsPanel videoId={id} API={API} authHeader={authHeader}
                onSeek={(t) => { const el = document.querySelector("[data-testid='video-player'] video"); if (el) el.currentTime = t; }}/>
            )}
            {tab === "remix" && (
              <div className="space-y-3" data-testid="studio-remix-panel">
                <p className="text-sm text-ink/70 mb-2">Suggested social clips — pick an aspect ratio to render & download:</p>
                {(() => {
                  const items = studioClips.length
                    ? studioClips
                    : (transcript?.segments?.slice(0, 4) || []).map(s => ({
                        start: s.start, end: s.end, text: s.text,
                        aspect_ratios: ["9:16", "1:1", "16:9"],
                        duration_label: `${Math.floor((s.end - s.start))}s`,
                      }));
                  if (!items.length) {
                    return <p className="text-sm text-ink/60">Clip suggestions appear after transcription.</p>;
                  }
                  return items.map((c, i) => (
                    <div key={`clip-${c.start}-${i}`} className="nb-border rounded-xl p-3 bg-mint" data-testid={`studio-clip-${i}`}>
                      <div className="font-heading text-sm">{(c.text || "Clip").slice(0, 48)}…</div>
                      <div className="text-xs text-ink/70 mb-2">
                        {Math.floor(c.start)}s – {Math.floor(c.end)}s
                        {c.engagement_pct ? ` · ${c.engagement_pct}% engagement` : ""}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(c.aspect_ratios || ["9:16", "1:1", "16:9"]).map(ar => {
                          const rk = `${c.start}-${ar}`;
                          return (
                            <button key={ar} onClick={() => studioRenderClip(c, ar)}
                              disabled={studioRendering === rk}
                              data-testid={`studio-export-${i}-${ar.replace(":", "x")}`}
                              className="nb-btn text-xs py-1.5 px-3 disabled:opacity-50">
                              {studioRendering === rk ? <Loader2 size={12} className="animate-spin"/> : null}
                              Export {ar}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
            {tab === "brand" && (
              <div className="space-y-3">
                <p className="text-sm text-ink/70">Override brand defaults for this video.</p>
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Player color</label>
                  <div className="flex gap-2 flex-wrap">
                    {["#FF6B6B","#1D1A3F","#98D8C8","#F4D068"].map(c => (
                      <button key={c}
                        onClick={() => setBrand(b => ({ ...b, color: c }))}
                        className="w-10 h-10 rounded-xl nb-border relative"
                        style={{ background: c, outline: brand.color === c ? "3px solid #121124" : "none" }}/>
                    ))}
                  </div>
                  <input type="text" className="nb-input mt-2 text-xs" value={brand.color}
                    onChange={e => setBrand(b => ({ ...b, color: e.target.value }))} placeholder="#FF6B6B"/>
                </div>
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Logo text</label>
                  <input className="nb-input text-sm" value={brand.logo_text || ""}
                    onChange={e => setBrand(b => ({ ...b, logo_text: e.target.value }))}/>
                </div>
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Logo placement</label>
                  <select className="nb-input text-sm" value={brand.logo_position || "top-right"} onChange={e => setBrand(b => ({ ...b, logo_position: e.target.value }))} data-testid="studio-logo-position">
                    <option value="top-right">Top right</option><option value="top-left">Top left</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option>
                  </select>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await axios.put(`${API}/brand`, { color: brand.color, logo_text: brand.logo_text, logo_position: brand.logo_position }, { headers: authHeader() });
                      toast.success("Brand saved — applies to all your players");
                    } catch { toast.error("Save failed"); }
                  }}
                  className="nb-btn nb-btn-mint w-full text-sm" data-testid="studio-brand-save">
                  Save brand defaults
                </button>
              </div>
            )}
            {tab === "convert" && (
              <div className="space-y-4" data-testid="studio-convert-panel">
                <p className="text-sm text-ink/70">Add click-through buttons or email capture forms inside the viewing experience.</p>
                <div className="grid grid-cols-2 gap-2">
                  <select className="nb-input text-sm" value={ctaForm.type} onChange={e=>setCtaForm(f=>({...f,type:e.target.value}))} data-testid="cta-type-select"><option value="cta">Button CTA</option><option value="form">Email form</option></select>
                  <input type="number" className="nb-input text-sm" value={ctaForm.timestamp} onChange={e=>setCtaForm(f=>({...f,timestamp:e.target.value}))} placeholder="Seconds" data-testid="cta-timestamp-input"/>
                </div>
                <input className="nb-input text-sm" value={ctaForm.text} onChange={e=>setCtaForm(f=>({...f,text:e.target.value}))} placeholder="Message" data-testid="cta-text-input"/>
                {ctaForm.type === "cta" ? <>
                  <input className="nb-input text-sm" value={ctaForm.button_label} onChange={e=>setCtaForm(f=>({...f,button_label:e.target.value}))} placeholder="Button label" data-testid="cta-button-label-input"/>
                  <input className="nb-input text-sm" value={ctaForm.url} onChange={e=>setCtaForm(f=>({...f,url:e.target.value}))} placeholder="Landing page URL" data-testid="cta-url-input"/>
                </> : <input className="nb-input text-sm" value={ctaForm.form_fields} onChange={e=>setCtaForm(f=>({...f,form_fields:e.target.value}))} placeholder="name,email,company" data-testid="cta-form-fields-input"/>}
                <button className="nb-btn w-full text-sm" data-testid="cta-create-button" onClick={async()=>{
                  try { await axios.post(`${API}/videos/${id}/ctas`, { ...ctaForm, timestamp: Number(ctaForm.timestamp), form_fields: ctaForm.form_fields.split(',').map(x=>x.trim()).filter(Boolean) }, { headers: authHeader() }); setCtaForm(f=>({...f,text:""})); const fresh = await axios.get(`${API}/videos/${id}/ctas`, { headers: authHeader() }); setCtas(fresh.data || []); toast.success("Conversion layer added"); } catch { toast.error("CTA save failed"); }
                }}>Add to player</button>
                <div className="space-y-2">
                  {ctas.map(c => <div key={c.id} className="nb-border rounded-xl p-3 bg-white" data-testid={`cta-row-${c.id}`}><div className="font-heading text-sm">{c.type === 'form' ? 'Email gate' : 'CTA'} at {c.timestamp}s</div><p className="text-xs text-ink/70">{c.text}</p><button className="text-coral text-xs font-bold" data-testid={`cta-delete-${c.id}`} onClick={async()=>{ await axios.delete(`${API}/videos/${id}/ctas/${c.id}`, { headers: authHeader() }); const fresh = await axios.get(`${API}/videos/${id}/ctas`, { headers: authHeader() }); setCtas(fresh.data || []); }}>Delete</button></div>)}
                </div>
              </div>
            )}
            {tab === "chapters" && (
              <div className="space-y-2" data-testid="studio-chapters-panel">
                <p className="text-sm text-ink/70 mb-3">Auto-generated table of contents from transcript timestamps.</p>
                {(transcript?.segments || []).slice(0, 12).map((s, i) => <button key={`${s.start}-${i}`} className="w-full text-left nb-border bg-white rounded-xl p-3 hover:bg-mint/40" data-testid={`chapter-${i}`} onClick={()=>{ const el=document.querySelector("[data-testid='video-player'] video"); if(el) el.currentTime=s.start; }}><span className="font-bold text-coral text-xs mr-2">{Math.floor(s.start/60)}:{Math.floor(s.start%60).toString().padStart(2,"0")}</span><span className="text-sm">{s.text.slice(0,80)}</span></button>)}
                {!transcript?.segments?.length && <p className="text-sm text-ink/60">Generate a transcript to create chapters automatically.</p>}
              </div>
            )}
            {tab === "share" && (
              <div className="space-y-3">
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Share link</label>
                  <input readOnly className="nb-input text-xs" value={shareUrl}/>
                  <button onClick={copyShare} className="nb-btn nb-btn-mint w-full mt-2 text-sm" data-testid="studio-copy-share"><Copy size={14}/> Copy share link</button>
                </div>
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Embed code</label>
                  <textarea readOnly className="nb-input font-mono text-xs h-24 resize-none" value={embedCode}/>
                  <button onClick={copyEmbed} className="nb-btn w-full mt-2 text-sm" data-testid="studio-copy-embed"><Copy size={14}/> Copy embed</button>
                </div>
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Direct video URL</label>
                  <input readOnly className="nb-input text-xs" value={playableSrc || ""}/>
                </div>
                {/* Password protection */}
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Password protect</label>
                  <div className="flex gap-2">
                    <input type="password" id="vid-password" className="nb-input text-xs flex-1" placeholder="Leave blank for public" data-testid="studio-password-input"/>
                    <button onClick={async () => {
                      const pw = document.getElementById("vid-password").value;
                      try {
                        await axios.patch(`${API}/videos/${video.id}`, { password: pw || null }, { headers: authHeader() });
                        toast.success(pw ? "Password set — viewers must enter it to watch." : "Password removed.");
                        load();
                      } catch { toast.error("Failed"); }
                    }} className="nb-btn text-xs py-2 px-3" data-testid="studio-password-set">Set</button>
                  </div>
                  <p className="text-[10px] text-ink/50 mt-1">Set a password to restrict who can view this video.</p>
                </div>
                {/* Podcast RSS */}
                <div>
                  <label className="font-heading text-xs mb-1.5 block">Podcast RSS feed</label>
                  <input readOnly className="nb-input text-xs" value={`${BACKEND}/api/videos/${video.id}/podcast-feed`}/>
                  <button onClick={() => {
                    navigator.clipboard.writeText(`${BACKEND}/api/videos/${video.id}/podcast-feed`);
                    toast.success("Podcast feed URL copied — submit to Apple Podcasts & Spotify!");
                  }} className="nb-btn nb-btn-ghost w-full mt-2 text-sm" data-testid="studio-copy-rss"><Copy size={14}/> Copy RSS feed URL</button>
                </div>
              </div>
            )}
            {tab === "security" && (
              <div className="space-y-4" data-testid="studio-security-panel">
                <div className="nb-border rounded-xl bg-white p-3">
                  <label className="font-heading text-xs mb-1.5 block">Private sharing link</label>
                  <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={!!video.private_enabled} onChange={async e=>{ await axios.patch(`${API}/videos/${video.id}`, { private_enabled: e.target.checked }, { headers: authHeader() }); load(); }} data-testid="private-link-toggle"/> Require private token</label>
                  <button className="nb-btn nb-btn-ghost text-xs py-2 px-3" data-testid="private-token-rotate" onClick={async()=>{ await axios.patch(`${API}/videos/${video.id}`, { private_token: 'rotate' }, { headers: authHeader() }); load(); toast.success('Private link rotated'); }}>Rotate private link</button>
                </div>
                <div className="nb-border rounded-xl bg-white p-3">
                  <label className="font-heading text-xs mb-1.5 block">Allowed embed domains</label>
                  <textarea className="nb-input text-xs" rows={3} value={domains} onChange={e=>setDomains(e.target.value)} placeholder="example.com\napp.example.com" data-testid="domain-restrictions-input"/>
                  <button className="nb-btn text-xs py-2 px-3 mt-2" data-testid="domain-restrictions-save" onClick={async()=>{ await axios.patch(`${API}/videos/${video.id}`, { allowed_domains: domains.split(/\n|,/).map(x=>x.trim()).filter(Boolean) }, { headers: authHeader() }); toast.success('Domain restrictions saved'); load(); }}>Save domains</button>
                </div>
                <div className="nb-border rounded-xl bg-white p-3">
                  <div className="font-heading text-sm mb-2">Compliance audit trail</div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {auditRows.slice(0,10).map(a => <div key={a.id} className="text-xs border-b border-ink/10 pb-1" data-testid={`audit-row-${a.id}`}><b>{a.action}</b><br/><span className="text-ink/60">{new Date(a.created_at).toLocaleString()}</span></div>)}
                    {auditRows.length === 0 && <p className="text-xs text-ink/60">No audit events yet.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
