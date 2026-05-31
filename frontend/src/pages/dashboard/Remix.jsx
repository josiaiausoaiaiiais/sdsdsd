import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import axios from "axios";
import { toast } from "sonner";
import { Scissors, Sparkles, Download, ChevronRight } from "lucide-react";
import { Star, Heart } from "@/components/Doodles";
import { Link } from "react-router-dom";

export default function Remix() {
  const { API } = useAuth();
  const [videos, setVideos] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState("");

  useEffect(() => {
    axios.get(`${API}/videos`).then(r => {
      setVideos(r.data || []);
      if (r.data?.length) setSelectedId(prev => prev || r.data[0].id);
    }).catch(() => {});
  }, [API]);

  const fetchClips = useCallback(async (id) => {
    if (!id) return;
    setLoading(true); setClips([]);
    try {
      const r = await axios.get(`${API}/videos/${id}/clips`);
      setClips(r.data.clips || []);
      if (!r.data.clips?.length) toast.info("No clip suggestions yet — add some views first or check the transcript is ready.");
    } catch { toast.error("Could not fetch clips"); }
    finally { setLoading(false); }
  }, [API]);

  const handleGenerate = () => fetchClips(selectedId);

  useEffect(() => {
    if (selectedId) fetchClips(selectedId);
  }, [selectedId, fetchClips]);

  const selectedVideo = videos.find(v => v.id === selectedId);

  const copyClipTime = (clip) => {
    navigator.clipboard.writeText(`Start: ${clip.start}s  End: ${clip.end}s\n"${clip.text}"`);
    toast.success("Clip timestamps copied!");
  };

  const renderClip = async (clip, aspect_ratio) => {
    setRendering(`${clip.start}-${aspect_ratio}`);
    try {
      const r = await axios.post(`${API}/videos/${selectedId}/clips/render`, {
        start: clip.start,
        end: clip.end,
        aspect_ratio,
        caption: clip.caption_text || clip.text,
      });
      const url = r.data.url?.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL}${r.data.url}` : r.data.url;
      const a = document.createElement("a");
      a.href = url;
      a.download = `looma-clip-${aspect_ratio.replace(':','x')}.mp4`;
      a.click();
      toast.success("Rendered clip ready to download");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Rendered downloads require an uploaded video file");
    } finally {
      setRendering("");
    }
  };

  return (
    <div className="p-8 md:p-10 max-w-7xl" data-testid="remix-page">
      <div className="flex justify-between items-center mb-7 flex-wrap gap-4">
        <div>
          <div className="font-hand text-2xl text-coral">long → short</div>
          <h1 className="font-heading text-4xl">Remix</h1>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="nb-border rounded-xl bg-white px-3 py-2 font-heading text-sm font-bold max-w-[260px] truncate cursor-pointer"
            data-testid="remix-video-select">
            {videos.length === 0 && <option value="">No videos yet</option>}
            {videos.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
          <button className="nb-btn" onClick={handleGenerate} disabled={loading || !selectedId} data-testid="remix-generate">
            <Sparkles size={18}/> {loading ? "Scanning…" : "Find clips"}
          </button>
        </div>
      </div>

      <div className="nb-border bg-mint rounded-3xl nb-shadow-lg p-8 mb-8 relative overflow-hidden">
        <Heart className="absolute top-6 right-8 w-12 h-12 wiggle"/>
        <Star className="absolute bottom-6 left-8 w-10 h-10 float-fast"/>
        <div className="relative max-w-2xl">
          <div className="font-hand text-2xl">try this</div>
          <h2 className="font-heading text-2xl mb-2">Turn one long video into a week of social posts.</h2>
          <p className="text-ink/80">Looma scans your transcript and heatmap data to find the most engaging moments, then suggests the perfect clips for Reels, Shorts, and TikTok.</p>
        </div>
      </div>

      {selectedVideo && (
        <h3 className="font-heading text-2xl mb-4">
          {loading ? "Scanning transcript & engagement…" : `${clips.length} suggested clips from "${selectedVideo.title}"`}
        </h3>
      )}

      {videos.length === 0 && (
        <div className="nb-card text-center py-14">
          <Scissors size={48} className="mx-auto mb-3 text-coral"/>
          <div className="font-heading text-xl mb-2">No videos yet</div>
          <p className="text-ink/70 mb-5">Upload or record a video first, then Remix will suggest clips.</p>
          <Link to="/app" className="nb-btn">Go to dashboard</Link>
        </div>
      )}

      {!loading && clips.length === 0 && selectedVideo && (
        <div className="nb-card text-center py-10" data-testid="remix-empty">
          <Scissors size={40} className="mx-auto mb-3 text-ink/30"/>
          <div className="font-heading text-lg mb-2">No clips found yet</div>
          <p className="text-ink/60 text-sm max-w-md mx-auto">
            {selectedVideo.transcript_status === "ready"
              ? "Share this video and collect some views — engagement data powers the clip suggestions."
              : "Generate the transcript for this video first (in Studio), then come back here."}
          </p>
          {selectedVideo.transcript_status !== "ready" && (
            <Link to={`/app/studio/${selectedVideo.id}`} className="nb-btn mt-4 inline-flex">
              Open Studio <ChevronRight size={16}/>
            </Link>
          )}
        </div>
      )}

      {clips.length > 0 && (
        <div className="grid md:grid-cols-2 gap-5">
          {clips.map((c, i) => (
            <div key={`${c.start}-${i}`} className="nb-card flex gap-4 hover:-translate-y-1 transition" data-testid={`remix-clip-${i}`}>
              <div className="w-24 h-32 rounded-xl nb-border bg-ink shrink-0 flex flex-col items-center justify-center text-white gap-1 p-2">
                <Scissors size={20}/>
                <span className="text-xs font-bold text-center">{c.duration_label}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-heading text-base mb-1 line-clamp-2">{c.text}</h4>
                <div className="text-xs text-ink/70 mb-1">{c.duration_label} · {c.engagement_pct}% engagement</div>
                <div className="flex gap-1 mb-3 flex-wrap">
                  {c.format_suggestions?.map(f => (
                    <span key={f} className="bg-coral text-white nb-border text-[10px] font-bold px-2 py-0.5 rounded-full">{f}</span>
                  ))}
                </div>
                <div className="flex gap-1 mb-3 flex-wrap" data-testid={`remix-aspects-${i}`}>
                  {(c.aspect_ratios || ["9:16", "1:1", "16:9"]).map(ar => (
                    <button key={ar} onClick={() => renderClip(c, ar)} disabled={!!rendering}
                      className="nb-border bg-white rounded-full px-2 py-1 text-[10px] font-bold hover:bg-mint transition"
                      data-testid={`remix-render-${i}-${ar.replace(':','x')}`}>{rendering === `${c.start}-${ar}` ? "Rendering…" : ar}</button>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Link to={`/app/studio/${selectedId}`} className="nb-btn nb-btn-gold text-xs py-1.5 px-3">Edit in Studio</Link>
                  <button onClick={() => copyClipTime(c)} className="nb-btn nb-btn-ghost text-xs py-1.5 px-3"><Download size={12}/> Copy timestamps</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
