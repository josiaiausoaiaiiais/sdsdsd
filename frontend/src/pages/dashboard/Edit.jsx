import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useSearchParams, Link } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Pencil, Music, Type, Wand2, Loader2, Sparkles, ChevronRight, Scissors, ExternalLink } from "lucide-react";
import { Star } from "@/components/Doodles";

export default function Edit() {
  const { API } = useAuth();
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("id");

  const [videos, setVideos] = useState([]);
  const [selectedId, setSelectedId] = useState(videoId || "");
  const [video, setVideo] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [deleted, setDeleted] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Background music
  const [tracks, setTracks] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState("upbeat");
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [addingMusic, setAddingMusic] = useState(false);
  const [showMusicPicker, setShowMusicPicker] = useState(false);
  // Trim
  const [trimResult, setTrimResult] = useState(null);

  useEffect(() => {
    if (!selectedId) return;
    axios.get(`${API}/videos/${selectedId}/music-tracks`)
      .then(r => setTracks(r.data?.tracks || []))
      .catch(() => setTracks([]));
  }, [API, selectedId]);

  useEffect(() => {
    axios.get(`${API}/videos`).then(r => {
      setVideos(r.data || []);
      if (!selectedId && r.data?.length) setSelectedId(r.data[0].id);
    }).catch(() => {});
  }, [API, selectedId]);

  const loadVideo = useCallback(async (id) => {
    if (!id) return;
    try {
      const [vr, tr] = await Promise.all([
        axios.get(`${API}/videos/${id}`),
        axios.get(`${API}/videos/${id}/transcript`).catch(() => ({ data: null })),
      ]);
      setVideo(vr.data);
      setTranscript(tr.data);
      setDeleted(new Set());
    } catch { toast.error("Could not load video"); }
  }, [API]);

  useEffect(() => { if (selectedId) loadVideo(selectedId); }, [selectedId, loadVideo]);

  const triggerTranscribe = async () => {
    setLoadingTranscript(true);
    try {
      await axios.post(`${API}/videos/${selectedId}/transcribe`, {});
      toast.info("Transcription started — refresh in a minute.");
      setTimeout(() => loadVideo(selectedId), 5000);
    } catch (e) { toast.error(e?.response?.data?.detail || "Cannot transcribe"); }
    finally { setLoadingTranscript(false); }
  };

  const toggleDelete = (idx) => {
    setDeleted(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const saveEdits = async () => {
    if (!transcript?.segments?.length) return;
    setSaving(true);
    setTrimResult(null);
    // Build keep-ranges from non-deleted segments, merging consecutive ones.
    const keepRanges = [];
    transcript.segments.forEach((s, i) => {
      if (deleted.has(i)) return;
      const last = keepRanges[keepRanges.length - 1];
      if (last && Math.abs(last.end - s.start) < 0.05) last.end = s.end;
      else keepRanges.push({ start: s.start, end: s.end });
    });
    const newTitle = `${video.title.replace(/ \(trimmed\)$/, "")} (trimmed)`;
    try {
      if (video?.storage_path && keepRanges.length) {
        const r = await axios.post(`${API}/videos/${selectedId}/trim`, { keep: keepRanges, title: newTitle });
        setTrimResult(r.data.video);
        toast.success(r.data.message || "Trimmed video created");
        setDeleted(new Set());
        const vr = await axios.get(`${API}/videos`);
        setVideos(vr.data || []);
      } else {
        const patchTitle = video.title.endsWith(" (edited)") ? video.title : `${video.title} (edited)`;
        await axios.patch(`${API}/videos/${selectedId}`, { title: patchTitle });
        toast.info(`Marked ${deleted.size} cut(s). Trimming a rendered file is available for uploaded videos.`);
        setDeleted(new Set());
        loadVideo(selectedId);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const applyMusic = async () => {
    if (!video?.storage_path) {
      toast.info("Background music is available for uploaded videos.");
      return;
    }
    setAddingMusic(true);
    try {
      const r = await axios.post(`${API}/videos/${selectedId}/music`, { track_id: selectedTrack, volume: musicVolume });
      toast.success(r.data.message || "Background music added");
      setShowMusicPicker(false);
      const vr = await axios.get(`${API}/videos`);
      setVideos(vr.data || []);
      if (r.data?.video?.id) setSelectedId(r.data.video.id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add music");
    } finally { setAddingMusic(false); }
  };

  const segs = transcript?.segments || [];
  const hasTranscript = transcript?.status === "ready" && segs.length > 0;

  return (
    <div className="p-8 md:p-10 max-w-7xl" data-testid="edit-page">
      <div className="mb-7 flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="font-hand text-2xl text-coral">edit by typing</div>
          <h1 className="font-heading text-4xl">Editor</h1>
        </div>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
          className="nb-border rounded-xl bg-white px-3 py-2 font-heading text-sm font-bold max-w-[260px] truncate"
          data-testid="edit-video-select">
          {videos.length === 0 && <option value="">No videos yet</option>}
          {videos.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
        </select>
      </div>

      {!selectedId ? (
        <div className="nb-card text-center py-14">
          <Pencil size={40} className="mx-auto mb-3 text-ink/30"/>
          <div className="font-heading text-lg mb-2">No video selected</div>
          <p className="text-ink/60 mb-5">Upload or record a video to start editing.</p>
          <Link to="/app" className="nb-btn">Go to dashboard</Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Video preview */}
            <div className="aspect-video rounded-2xl nb-border nb-shadow-lg bg-ink relative overflow-hidden flex items-center justify-center">
              {video?.url ? (
                <video src={video.url.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL}${video.url}` : video.url}
                  controls className="w-full h-full object-contain bg-black" id="edit-preview"/>
              ) : (
                <div className="text-white/50 font-heading text-lg">Loading video…</div>
              )}
              <Star className="absolute top-6 right-6 w-10 h-10 wiggle"/>
            </div>

            {/* Transcript editor */}
            <div className="nb-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading text-xl flex items-center gap-2"><Type size={20}/> Transcript editor</h3>
                {deleted.size > 0 && (
                  <button onClick={saveEdits} disabled={saving} className="nb-btn text-sm py-2 px-4" data-testid="edit-save">
                    {saving ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
                    {saving ? "Saving…" : `Save (${deleted.size} cuts)`}
                  </button>
                )}
              </div>

              {transcript?.status === "pending" && (
                <div className="text-center py-8">
                  <Loader2 size={32} className="animate-spin mx-auto mb-2 text-coral"/>
                  <p className="text-sm text-ink/70">Generating transcript with AI…</p>
                </div>
              )}

              {(!transcript || transcript?.status === "none" || transcript?.status === "error") && (
                <div className="text-center py-8">
                  <p className="text-sm text-ink/80 mb-3">
                    {transcript?.status === "error" ? "Transcription failed." : "No transcript yet."}
                  </p>
                  {video?.storage_path ? (
                    <button onClick={triggerTranscribe} disabled={loadingTranscript} className="nb-btn text-sm py-2 px-4">
                      {loadingTranscript ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>} Generate transcript
                    </button>
                  ) : (
                    <p className="text-xs text-ink/60">Transcription is available for uploaded videos only.</p>
                  )}
                </div>
              )}

              {hasTranscript && (
                <>
                  <p className="text-xs text-ink/60 mb-3">Click a line to mark it for deletion. Marked lines are highlighted in red — press Save to commit cuts.</p>
                  <div className="space-y-1 max-h-96 overflow-y-auto scrollbar-thin">
                    {segs.map((line, idx) => (
                      <button key={`${line.start}-${idx}`}
                        onClick={() => {
                          toggleDelete(idx);
                          const vid = document.getElementById("edit-preview");
                          if (vid) vid.currentTime = line.start;
                        }}
                        data-testid={`edit-segment-${idx}`}
                        className={`flex gap-3 px-3 py-2 rounded-lg cursor-pointer text-left w-full transition ${deleted.has(idx) ? 'bg-coral/20 line-through opacity-50' : 'hover:bg-gold/30'}`}>
                        <span className="font-bold text-coral text-xs w-14 shrink-0 pt-0.5">
                          {Math.floor(line.start/60)}:{Math.floor(line.start%60).toString().padStart(2,"0")}
                        </span>
                        <p className="text-ink/90 leading-relaxed text-sm">{line.text}</p>
                        {deleted.has(idx) && <span className="text-coral text-xs ml-auto shrink-0">✕ cut</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {trimResult && (
              <div className="nb-card bg-mint" data-testid="edit-trim-result">
                <div className="flex items-center gap-2 mb-1"><Scissors size={18}/>
                  <h4 className="font-heading text-lg">Trimmed video ready</h4>
                </div>
                <p className="text-sm text-ink/80 mb-3">"{trimResult.title}" was saved as a new video.</p>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setSelectedId(trimResult.id)} className="nb-btn text-sm py-2 px-4">Open it here</button>
                  <Link to={`/app/studio/${trimResult.id}`} className="nb-btn nb-btn-ghost text-sm py-2 px-4">
                    Open in Studio <ExternalLink size={14}/>
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Tools sidebar */}
          <div className="space-y-4">
            <div className="nb-card">
              <h3 className="font-heading text-lg mb-3 flex items-center gap-2"><Wand2 size={18}/> Tools</h3>
              <div className="space-y-2">
                <button onClick={() => setShowMusicPicker(s => !s)}
                  data-testid="edit-music-toggle"
                  className="nb-btn nb-btn-mint w-full justify-start text-sm py-2.5"><Music size={16}/> Add background music</button>

                {showMusicPicker && (
                  <div className="nb-border rounded-xl bg-white p-3 space-y-3" data-testid="edit-music-picker">
                    {!video?.storage_path && (
                      <p className="text-xs text-coral">Available for uploaded videos only.</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {tracks.map(t => (
                        <button key={t.id} onClick={() => setSelectedTrack(t.id)}
                          data-testid={`edit-music-track-${t.id}`}
                          className={`nb-border rounded-lg px-2 py-2 text-xs font-heading font-bold text-left transition ${selectedTrack === t.id ? 'bg-mint' : 'bg-cream hover:bg-gold/30'}`}>
                          {t.label}
                          <span className="block text-[10px] font-normal text-ink/60">{t.bpm} BPM</span>
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="text-xs text-ink/70 flex items-center justify-between mb-1">
                        <span>Music volume</span><span>{Math.round(musicVolume * 100)}%</span>
                      </label>
                      <input type="range" min="0" max="1" step="0.05" value={musicVolume}
                        onChange={e => setMusicVolume(parseFloat(e.target.value))}
                        data-testid="edit-music-volume" className="w-full"/>
                    </div>
                    <button onClick={applyMusic} disabled={addingMusic || !video?.storage_path}
                      data-testid="edit-music-apply"
                      className="nb-btn w-full justify-center text-sm py-2 disabled:opacity-50">
                      {addingMusic ? <Loader2 size={14} className="animate-spin"/> : <Music size={14}/>}
                      {addingMusic ? "Mixing…" : "Mix into new video"}
                    </button>
                  </div>
                )}
                <button onClick={() => {
                  if (!hasTranscript) { toast.info("Generate a transcript first to get captions."); return; }
                  toast.success("Captions are live — viewers see your transcript as closed captions automatically.");
                }} className="nb-btn nb-btn-gold w-full justify-start text-sm py-2.5"><Type size={16}/> Enable captions</button>
                <button onClick={() => {
                  const silenceIdx = [];
                  segs.forEach((s, i) => {
                    const next = segs[i + 1];
                    if (next && (next.start - s.end) > 1.5) silenceIdx.push(i);
                  });
                  if (!silenceIdx.length) { toast.info("No long silences detected."); return; }
                  setDeleted(prev => new Set([...prev, ...silenceIdx]));
                  toast.success(`Marked ${silenceIdx.length} silence gap(s) for removal.`);
                }} className="nb-btn nb-btn-ghost w-full justify-start text-sm py-2.5"><Pencil size={16}/> Trim silences</button>
              </div>
            </div>

            <div className="nb-card bg-coral text-white">
              <div className="font-hand text-2xl">pro tip</div>
              <h4 className="font-heading text-lg mb-2">Click to cut</h4>
              <p className="text-white/90 text-sm">Click any transcript line to mark it for deletion. The timestamp jumps in the preview. Press Save to apply.</p>
            </div>

            {video && (
              <div className="nb-card">
                <h4 className="font-heading text-sm mb-2">Open full Studio</h4>
                <p className="text-xs text-ink/70 mb-3">For publishing, sharing, advanced brand settings and full analytics.</p>
                <Link to={`/app/studio/${selectedId}`} className="nb-btn nb-btn-ghost w-full text-sm justify-center">
                  Open Studio <ChevronRight size={14}/>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
