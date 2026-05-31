import { useState } from "react";
import { X, Camera, Monitor, Layers, Upload, Play, Square, Download, RotateCcw, Mic, MicOff, FileVideo } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";

const RECORD_MODES = [
  { id: "webcam", icon: Camera, label: "Webcam", desc: "Just your face" },
  { id: "screen", icon: Monitor, label: "Screen", desc: "Share a window" },
  { id: "both", icon: Layers, label: "Both", desc: "Picture-in-picture" },
];

const fmtDuration = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

function ModeSelector({ mode, setMode }) {
  return (
    <div className="grid grid-cols-3 gap-3 mb-5">
      {RECORD_MODES.map(m => (
        <button key={m.id} onClick={() => setMode(m.id)} data-testid={`rec-mode-${m.id}`}
          className={`p-4 rounded-2xl nb-border text-left transition ${mode === m.id ? 'bg-coral text-white nb-shadow-sm' : 'bg-white hover:bg-mint'}`}>
          <m.icon size={22} strokeWidth={2.5} className="mb-2"/>
          <div className="font-heading text-sm">{m.label}</div>
          <div className="text-xs opacity-80">{m.desc}</div>
        </button>
      ))}
    </div>
  );
}

function UploadSettings({ title, setTitle, folder, setFolder, thumbnail, setThumbnail, files, handleFileSelect, withMic, setWithMic }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="font-heading text-sm mb-1.5 block">Title</label>
        <input className="nb-input" value={title} onChange={e => setTitle(e.target.value)} data-testid="rec-title"/>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="font-heading text-sm mb-1.5 block">Folder</label>
          <input className="nb-input" value={folder} onChange={e => setFolder(e.target.value)} placeholder="Campaign demos" data-testid="upload-folder-input"/>
        </div>
        <div>
          <label className="font-heading text-sm mb-1.5 block">Thumbnail URL</label>
          <input className="nb-input" value={thumbnail} onChange={e => setThumbnail(e.target.value)} placeholder="https://..." data-testid="upload-thumbnail-input"/>
        </div>
      </div>
      <div className="nb-border rounded-2xl bg-white p-4">
        <label className="font-heading text-sm mb-2 flex items-center gap-2"><FileVideo size={16}/> Upload video files</label>
        <input type="file" accept="video/*" multiple className="nb-input" data-testid="upload-file-input" onChange={e => handleFileSelect(Array.from(e.target.files || []))}/>
        {files.length > 0 && <p className="text-xs text-ink/60 mt-2" data-testid="upload-file-count">{files.length} file(s) selected — bulk upload enabled.</p>}
      </div>
      <label className="flex items-center gap-3 p-3 nb-border rounded-xl bg-white cursor-pointer">
        <input type="checkbox" checked={withMic} onChange={e => setWithMic(e.target.checked)} className="w-5 h-5"/>
        {withMic ? <Mic size={20}/> : <MicOff size={20}/>}<span className="font-bold flex-1">Record microphone audio</span>
      </label>
    </div>
  );
}

function RecordingView({ rec, goStop }) {
  return (
    <>
      <div className="relative rounded-2xl overflow-hidden nb-border bg-ink mb-4 aspect-video">
        <video ref={rec.livePreviewRef} className="w-full h-full object-contain" autoPlay muted playsInline/>
        <div className="absolute top-3 left-3 bg-coral text-white nb-border px-3 py-1 rounded-full font-heading text-sm flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse"/> REC {fmtDuration(rec.elapsed)}
        </div>
      </div>
      <button onClick={goStop} className="nb-btn nb-btn-dark w-full" data-testid="rec-stop"><Square size={16} fill="white"/> Stop & preview</button>
    </>
  );
}

function PreviewView({ rec, goRedo, downloadLocal, uploadToLooma }) {
  return (
    <>
      <video src={rec.blobUrl} controls className="w-full rounded-2xl nb-border bg-ink mb-4 aspect-video"/>
      <div className="grid grid-cols-3 gap-3">
        <button onClick={goRedo} className="nb-btn nb-btn-ghost" data-testid="rec-discard"><RotateCcw size={16}/> Redo</button>
        <button onClick={downloadLocal} className="nb-btn nb-btn-gold" data-testid="rec-download"><Download size={16}/> Save local</button>
        <button onClick={uploadToLooma} className="nb-btn" data-testid="rec-upload"><Upload size={16}/> Upload</button>
      </div>
      <p className="text-xs text-ink/60 mt-3 text-center">Upload kicks off automatic AI transcription. Files larger than 25MB skip transcription.</p>
    </>
  );
}

function UploadingView({ uploadPct }) {
  return (
    <div className="py-10 text-center">
      <div className="font-heading text-xl mb-4">Uploading to Looma…</div>
      <div className="w-full h-4 rounded-full nb-border bg-white overflow-hidden"><div className="h-full bg-coral transition-all" style={{ width: `${uploadPct}%` }}/></div>
      <div className="mt-2 text-sm">{uploadPct}%</div>
    </div>
  );
}

/**
 * Multi-step recorder modal. Recording state machine lives in useMediaRecorder hook.
 * Steps: setup → recording → preview → uploading.
 */
export default function RecordModal({ onClose }) {
  const { API } = useAuth();
  const nav = useNavigate();

  const [mode, setMode] = useState("webcam");
  const [withMic, setWithMic] = useState(true);
  const [title, setTitle] = useState(`Looma — ${new Date().toLocaleString()}`);
  const [folder, setFolder] = useState("Recordings");
  const [thumbnail, setThumbnail] = useState("");
  const [files, setFiles] = useState([]);
  const [uploadPct, setUploadPct] = useState(0);
  const [step, setStep] = useState("setup");

  const rec = useMediaRecorder();

  const captureThumbnail = (file) => new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(1, video.duration || 1);
      } catch {
        cleanup(); resolve("");
      }
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#121124"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        cleanup(); resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        cleanup(); resolve("");
      }
    };
    video.onerror = () => { cleanup(); resolve(""); };
  });

  const handleFileSelect = async (picked) => {
    setFiles(picked);
    if (picked.length === 1) setTitle(picked[0].name.replace(/\.[^.]+$/, ""));
    if (picked.length && !thumbnail) {
      const thumb = await captureThumbnail(picked[0]);
      if (thumb) setThumbnail(thumb);
    }
  };
  // Recorder transitions: setup → recording (start) → preview (after stop, blob ready) → uploading
  const goStart = async () => {
    try {
      await rec.start({ mode, withMic });
      setStep("recording");
    } catch {
      toast.error(rec.error || "Recording failed to start");
    }
  };
  const goStop = () => { rec.stop(); setStep("preview"); };
  const goRedo = () => { rec.discard(); setStep("setup"); };

  const downloadLocal = () => {
    if (!rec.blob) return;
    const a = document.createElement("a");
    a.href = rec.blobUrl;
    a.download = `${title.replace(/[^a-z0-9-_ ]/gi, "_")}.webm`;
    a.click();
    toast.success("Saved to your computer");
  };

  const uploadBlob = async (blob, name, idx = 0, total = 1) => {
    const fd = new FormData();
    fd.append("file", blob, name || "recording.webm");
    fd.append("title", total > 1 ? `${title} ${idx + 1}` : title);
    fd.append("description", rec.blob ? `Recorded via ${mode}` : "Uploaded from device");
    fd.append("folder", folder || "Uploads");
    fd.append("thumbnail", thumbnail || "");
    fd.append("duration", String(rec.blob ? rec.elapsed : 0));
    return axios.post(`${API}/videos/upload`, fd, {
      onUploadProgress: (e) => {
        if (!e.total) return;
        const perFile = Math.round((e.loaded / e.total) * (100 / total));
        setUploadPct(Math.min(100, Math.round((idx * 100) / total + perFile)));
      },
    });
  };

  const uploadToLooma = async () => {
    const uploadFiles = files.length ? files : (rec.blob ? [new File([rec.blob], "recording.webm", { type: "video/webm" })] : []);
    if (!uploadFiles.length) return;
    setStep("uploading"); setUploadPct(0);
    try {
      let last = null;
      for (let i = 0; i < uploadFiles.length; i += 1) last = await uploadBlob(uploadFiles[i], uploadFiles[i].name, i, uploadFiles.length);
      toast.success(uploadFiles.length > 1 ? `${uploadFiles.length} videos uploaded!` : "Uploaded! Transcript is being generated…");
      onClose();
      if (last?.data?.id) nav(`/app/studio/${last.data.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
      setStep(rec.blob ? "preview" : "setup");
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/70 z-50 flex items-center justify-center p-4" onClick={step==="recording" ? undefined : onClose}>
      <div className="bg-cream nb-border rounded-3xl nb-shadow-lg max-w-3xl w-full p-7 max-h-[92vh] overflow-y-auto scrollbar-thin" onClick={e=>e.stopPropagation()} data-testid="record-modal">
        <div className="flex justify-between items-start mb-5">
          <div>
            <div className="font-hand text-2xl text-coral">upload a file or record a new one</div>
            <h2 className="font-heading text-3xl">
              {{ setup: "Upload or record a video", recording: "Recording in progress",
                 preview: "Preview your video", uploading: "Uploading to Looma" }[step]}
            </h2>
          </div>
          {step !== "recording" && step !== "uploading" && (
            <button onClick={onClose} className="p-2 rounded-xl nb-border bg-white" data-testid="rec-close"><X size={18}/></button>
          )}
        </div>

        {step === "setup" && (
          <>
            <ModeSelector mode={mode} setMode={setMode}/>
            <div className="space-y-4">
              <div>
                <label className="font-heading text-sm mb-1.5 block">Title</label>
                <input className="nb-input" value={title} onChange={e=>setTitle(e.target.value)} data-testid="rec-title"/>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-heading text-sm mb-1.5 block">Folder</label>
                  <input className="nb-input" value={folder} onChange={e=>setFolder(e.target.value)} placeholder="Campaign demos" data-testid="upload-folder-input"/>
                </div>
                <div>
                  <label className="font-heading text-sm mb-1.5 block">Thumbnail URL</label>
                  <input className="nb-input" value={thumbnail} onChange={e=>setThumbnail(e.target.value)} placeholder="https://..." data-testid="upload-thumbnail-input"/>
                </div>
              </div>
              <div className="nb-border rounded-2xl bg-white p-4">
                <label className="font-heading text-sm mb-2 flex items-center gap-2"><FileVideo size={16}/> Upload video files</label>
                <input type="file" accept="video/*" multiple className="nb-input" data-testid="upload-file-input" onChange={e=>handleFileSelect(Array.from(e.target.files || []))}/>
                {files.length > 0 && <p className="text-xs text-ink/60 mt-2" data-testid="upload-file-count">{files.length} file(s) selected — bulk upload enabled.</p>}
              </div>
              <label className="flex items-center gap-3 p-3 nb-border rounded-xl bg-white cursor-pointer">
                <input type="checkbox" checked={withMic} onChange={e=>setWithMic(e.target.checked)} className="w-5 h-5"/>
                {withMic ? <Mic size={20}/> : <MicOff size={20}/>}
                <span className="font-bold flex-1">Record microphone audio</span>
              </label>
            </div>
            {rec.error && <div className="mt-4 p-3 rounded-xl bg-coral/15 nb-border text-sm">{rec.error}</div>}
            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="nb-btn nb-btn-ghost flex-1">Cancel</button>
              {files.length > 0 && <button onClick={uploadToLooma} className="nb-btn nb-btn-gold flex-1" data-testid="upload-files-submit"><Upload size={16}/> Upload files</button>}
              <button onClick={goStart} className="nb-btn flex-1" data-testid="rec-start">
                <Play size={16} fill="white"/> Start recording
              </button>
            </div>
          </>
        )}

        {step === "recording" && (
          <>
            <div className="relative rounded-2xl overflow-hidden nb-border bg-ink mb-4 aspect-video">
              <video ref={rec.livePreviewRef} className="w-full h-full object-contain" autoPlay muted playsInline/>
              <div className="absolute top-3 left-3 bg-coral text-white nb-border px-3 py-1 rounded-full font-heading text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"/> REC {fmtDuration(rec.elapsed)}
              </div>
            </div>
            <button onClick={goStop} className="nb-btn nb-btn-dark w-full" data-testid="rec-stop">
              <Square size={16} fill="white"/> Stop & preview
            </button>
          </>
        )}

        {step === "preview" && rec.blobUrl && (
          <>
            <video src={rec.blobUrl} controls className="w-full rounded-2xl nb-border bg-ink mb-4 aspect-video"/>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={goRedo} className="nb-btn nb-btn-ghost" data-testid="rec-discard"><RotateCcw size={16}/> Redo</button>
              <button onClick={downloadLocal} className="nb-btn nb-btn-gold" data-testid="rec-download"><Download size={16}/> Save local</button>
              <button onClick={uploadToLooma} className="nb-btn" data-testid="rec-upload"><Upload size={16}/> Upload</button>
            </div>
            <p className="text-xs text-ink/60 mt-3 text-center">Upload kicks off automatic AI transcription. Files larger than 25MB skip transcription.</p>
          </>
        )}

        {step === "uploading" && (
          <div className="py-10 text-center">
            <div className="font-heading text-xl mb-4">Uploading to Looma…</div>
            <div className="w-full h-4 rounded-full nb-border bg-white overflow-hidden">
              <div className="h-full bg-coral transition-all" style={{ width: `${uploadPct}%` }}/>
            </div>
            <div className="mt-2 text-sm">{uploadPct}%</div>
          </div>
        )}
      </div>
    </div>
  );
}
