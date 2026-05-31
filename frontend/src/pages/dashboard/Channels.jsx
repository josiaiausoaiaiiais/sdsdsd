import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import axios from "axios";
import { toast } from "sonner";
import { Tv, Plus, X, Eye, Trash2, Video, Copy } from "lucide-react";

const COLOR_OPTIONS = [
  { val: "bg-mint", label: "Mint" },
  { val: "bg-gold", label: "Gold" },
  { val: "bg-coral text-white", label: "Coral" },
  { val: "bg-white", label: "White" },
];

export default function Channels() {
  const { API } = useAuth();
  const [channels, setChannels] = useState([]);
  const [videos, setVideos] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", color: "bg-mint" });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null); // channel being managed

  const load = useCallback(() =>
    axios.get(`${API}/channels`).then(r => setChannels(r.data)).catch(() => {}),
    [API]);

  useEffect(() => {
    load();
    axios.get(`${API}/videos`).then(r => setVideos(r.data)).catch(() => {});
  }, [API, load]);

  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await axios.post(`${API}/channels`, form);
      toast.success("Channel created!");
      setShow(false); setForm({ name: "", description: "", color: "bg-mint" });
      load();
    } catch { toast.error("Failed to create channel"); } finally { setBusy(false); }
  };

  const del = async (id) => {
    await axios.delete(`${API}/channels/${id}`);
    toast.success("Deleted"); load();
    if (selected?.id === id) setSelected(null);
  };

  const addVideo = async (channelId, videoId) => {
    const r = await axios.post(`${API}/channels/${channelId}/videos/${videoId}`);
    setSelected(r.data);
    load();
    toast.success("Video added to channel");
  };

  const removeVideo = async (channelId, videoId) => {
    const r = await axios.delete(`${API}/channels/${channelId}/videos/${videoId}`);
    setSelected(r.data);
    load();
  };

  const copyEmbedCode = (c) => {
    const code = `<iframe src="${window.location.origin}/app/channels/${c.id}" width="100%" height="480" frameborder="0" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(code);
    toast.success("Embed code copied!");
  };

  const availableVideos = useMemo(
    () => videos.filter(v => !(selected?.video_ids || []).includes(v.id)),
    [videos, selected]
  );

  return (
    <div className="p-8 md:p-10 max-w-7xl" data-testid="channels-page">
      <div className="flex justify-between items-center mb-7 flex-wrap gap-4">
        <div>
          <div className="font-hand text-2xl text-coral">video hubs</div>
          <h1 className="font-heading text-4xl">Channels</h1>
        </div>
        <button className="nb-btn" onClick={() => setShow(true)} data-testid="channel-create">
          <Plus size={18}/> New channel
        </button>
      </div>

      <p className="text-ink/80 mb-6 max-w-2xl">Group videos into branded galleries and embed them anywhere with a single code snippet.</p>

      {channels.length === 0 ? (
        <div className="nb-card text-center py-14" data-testid="channels-empty">
          <Tv size={48} className="mx-auto mb-3 text-coral"/>
          <div className="font-heading text-xl mb-2">No channels yet</div>
          <p className="text-ink/70 mb-5">Create a channel to group and share your videos.</p>
          <button className="nb-btn" onClick={() => setShow(true)}>Create first channel</button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {channels.map(c => {
            const videoCount = c.video_ids?.length || 0;
            return (
              <div key={c.id} className={`${c.color} nb-border rounded-2xl p-6 nb-shadow-lg hover:-translate-y-1 transition group relative`} data-testid={`channel-card-${c.id}`}>
                <button onClick={() => del(c.id)} className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/30 opacity-0 group-hover:opacity-100 transition" data-testid={`channel-delete-${c.id}`}><Trash2 size={14}/></button>
                <Tv size={28} strokeWidth={2.5} className="mb-3"/>
                <h3 className="font-heading text-xl mb-1">{c.name}</h3>
                {c.description && <p className="text-sm opacity-80 mb-3">{c.description}</p>}
                <div className="flex gap-4 text-sm mb-4">
                  <span><Video size={14} className="inline mr-1"/>{videoCount} videos</span>
                  <span><Eye size={14} className="inline mr-1"/>{c.views || 0} views</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setSelected(c)} className="nb-btn nb-btn-ghost text-sm py-2 px-3" data-testid={`channel-manage-${c.id}`}>Manage videos</button>
                  <button onClick={() => copyEmbedCode(c)} className="nb-btn nb-btn-ghost text-sm py-2 px-3"><Copy size={13}/> Embed</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {show && (
        <div className="fixed inset-0 bg-ink/60 z-50 flex items-center justify-center p-4" onClick={() => setShow(false)}>
          <div className="bg-cream nb-border rounded-3xl nb-shadow-lg max-w-lg w-full p-7" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-heading text-2xl">New channel</h2>
              <button onClick={() => setShow(false)} className="p-2 rounded-xl nb-border bg-white"><X size={18}/></button>
            </div>
            <form onSubmit={create} className="space-y-4">
              <div>
                <label className="font-heading text-sm mb-1.5 block">Channel name</label>
                <input required className="nb-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Product Tutorials" data-testid="channel-name-input"/>
              </div>
              <div>
                <label className="font-heading text-sm mb-1.5 block">Description (optional)</label>
                <textarea className="nb-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What this channel is about..."/>
              </div>
              <div>
                <label className="font-heading text-sm mb-1.5 block">Color</label>
                <div className="flex gap-2">
                  {COLOR_OPTIONS.map(o => (
                    <button key={o.val} type="button" onClick={() => setForm({ ...form, color: o.val })}
                      className={`${o.val} nb-border rounded-xl px-3 py-2 text-sm font-bold ${form.color === o.val ? 'ring-2 ring-ink' : ''}`}>{o.label}</button>
                  ))}
                </div>
              </div>
              <button type="submit" disabled={busy} className="nb-btn w-full" data-testid="channel-create-submit">
                {busy ? "Creating…" : "Create channel"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manage Videos Drawer */}
      {selected && (
        <div className="fixed inset-0 bg-ink/60 z-50 flex items-end md:items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-cream nb-border rounded-3xl nb-shadow-lg max-w-2xl w-full p-7 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-heading text-2xl">{selected.name} — videos</h2>
              <button onClick={() => setSelected(null)} className="p-2 rounded-xl nb-border bg-white"><X size={18}/></button>
            </div>
            <h4 className="font-heading text-sm mb-2 text-ink/70">IN THIS CHANNEL</h4>
            {(selected.video_ids || []).length === 0 && <p className="text-sm text-ink/60 mb-4">No videos yet. Add from your library below.</p>}
            <div className="space-y-2 mb-5">
              {(selected.video_ids || []).map(vid => {
                const v = videos.find(x => x.id === vid);
                if (!v) return null;
                return (
                  <div key={vid} className="flex items-center justify-between nb-border rounded-xl px-4 py-3 bg-white">
                    <span className="font-heading text-sm truncate">{v.title}</span>
                    <button onClick={() => removeVideo(selected.id, vid)} className="text-coral hover:underline text-xs font-bold ml-3">Remove</button>
                  </div>
                );
              })}
            </div>
            <h4 className="font-heading text-sm mb-2 text-ink/70">ADD FROM LIBRARY</h4>
            <div className="space-y-2">
              {availableVideos.map(v => (
                <div key={v.id} className="flex items-center justify-between nb-border rounded-xl px-4 py-3 bg-white hover:bg-mint/30 transition">
                  <span className="font-heading text-sm truncate">{v.title}</span>
                  <button onClick={() => addVideo(selected.id, v.id)} className="nb-btn text-xs py-1.5 px-3 ml-3">Add</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
