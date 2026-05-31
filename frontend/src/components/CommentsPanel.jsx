import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Trash2, Plus } from "lucide-react";

export function CommentsPanel({ videoId, API, authHeader, onSeek }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [timestamp, setTimestamp] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    axios.get(`${API}/videos/${videoId}/comments`, { headers: authHeader() })
      .then(r => setComments(r.data || [])).catch(() => {});
  }, [API, videoId, authHeader]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await axios.post(`${API}/videos/${videoId}/comments`, { text, timestamp: Number(timestamp) }, { headers: authHeader() });
      setText(""); load(); toast.success("Comment added");
    } catch { toast.error("Failed"); } finally { setBusy(false); }
  };

  const resolve = async (id) => {
    await axios.patch(`${API}/videos/${videoId}/comments/${id}`, {}, { headers: authHeader() });
    load();
  };

  const del = async (id) => {
    await axios.delete(`${API}/videos/${videoId}/comments/${id}`, { headers: authHeader() });
    load(); toast.success("Deleted");
  };

  const fmtT = (s) => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,"0")}`;

  return (
    <div className="space-y-3" data-testid="comments-panel">
      <div className="space-y-2">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
          className="nb-input text-sm w-full" placeholder="Leave a time-coded comment…" data-testid="comment-text-input"/>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-ink/60 shrink-0">At (seconds):</label>
          <input type="number" min={0} value={timestamp} onChange={e => setTimestamp(e.target.value)}
            className="nb-input text-xs w-24" data-testid="comment-timestamp-input"/>
          <button onClick={add} disabled={busy || !text.trim()} className="nb-btn text-xs py-2 px-3 ml-auto" data-testid="comment-add">
            <Plus size={12}/> Add
          </button>
        </div>
      </div>
      {comments.length === 0 && <p className="text-sm text-ink/60 text-center py-4" data-testid="comments-empty-state">No comments yet. Add the first one above.</p>}
      {comments.map(c => (
        <div key={c.id} className={`nb-border rounded-xl p-3 text-sm ${c.resolved ? 'opacity-50 bg-mint/30' : 'bg-white'}`} data-testid={`comment-${c.id}`}>
          <div className="flex items-start justify-between gap-2 mb-1">
            <button onClick={() => onSeek(c.timestamp)}
              className="font-bold text-coral text-xs hover:underline" data-testid={`comment-seek-${c.id}`}>{fmtT(c.timestamp)}</button>
            <div className="flex gap-1">
              {!c.resolved && <button onClick={() => resolve(c.id)} title="Mark resolved" className="p-1 hover:text-mint" data-testid={`comment-resolve-${c.id}`}><Check size={13}/></button>}
              <button onClick={() => del(c.id)} className="p-1 hover:text-coral" data-testid={`comment-delete-${c.id}`}><Trash2 size={12}/></button>
            </div>
          </div>
          <p className="text-ink/80 leading-relaxed" data-testid={`comment-text-${c.id}`}>{c.text}</p>
          {c.resolved && <span className="text-[10px] font-bold text-mint" data-testid={`comment-resolved-${c.id}`}>Resolved</span>}
        </div>
      ))}
    </div>
  );
}
