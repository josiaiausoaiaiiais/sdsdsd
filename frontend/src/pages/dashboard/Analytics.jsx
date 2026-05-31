import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import axios from "axios";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Eye, Play, Users, TrendingUp, Film, Loader2, Download, Clock } from "lucide-react";

// Hoisted constant style objects so they keep a stable reference across renders
// (avoids re-creating new objects on every render, which would re-render chart children).
const TOOLTIP_STYLE = { border: "2px solid #121124", borderRadius: "12px", boxShadow: "4px 4px 0 0 #121124" };
const AXIS_LABEL_STYLE = { fontFamily: "Nunito", fontWeight: 700 };
const HEAT_AXIS_LABEL_STYLE = { fontFamily: "Nunito", fontWeight: 700, fontSize: 11 };
const VIEWS_DOT = { fill: "#FF6B6B", stroke: "#121124", strokeWidth: 2, r: 5 };
const PLAYS_DOT = { fill: "#98D8C8", stroke: "#121124", strokeWidth: 2, r: 5 };
const HEAT_Y_DOMAIN = [0, 100];
const HEAT_BAR_RADIUS = [3, 3, 0, 0];
const HEAT_CURSOR = { fill: "#12112411" };

// Build a continuous bucket array (one bar per 5s segment) from sparse heatmap segments.
function buildHeatBuckets(segments, duration) {
  const byIndex = new Map((segments || []).map((s) => [s.index, s]));
  const maxIndexFromData = segments && segments.length
    ? Math.max(...segments.map((s) => s.index))
    : 0;
  const bucketCount = Math.max(
    maxIndexFromData + 1,
    duration ? Math.ceil(duration / 5) : 0,
    1
  );
  return Array.from({ length: Math.min(bucketCount, 240) }, (_, i) => {
    const seg = byIndex.get(i);
    return {
      sec: i * 5,
      label: `${i * 5}s`,
      intensity: seg ? Math.round((seg.intensity || 0) * 100) : 0,
      watches: seg?.watches || 0,
      rewatches: seg?.rewatches || 0,
      skips: seg?.skips || 0,
    };
  });
}

function HeatTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="nb-border bg-white rounded-xl px-3 py-2 text-xs" data-testid="heatmap-tooltip">
      <div className="font-heading font-bold mb-1">At {d.label}</div>
      <div className="text-ink/80">Watches: <b>{d.watches}</b></div>
      <div className="text-ink/80">Rewatches: <b>{d.rewatches}</b></div>
      <div className="text-ink/80">Skips: <b>{d.skips}</b></div>
    </div>
  );
}

export default function Analytics() {
  const { API, authHeader } = useAuth();
  const [stats, setStats] = useState(null);
  const [videos, setVideos] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [heatSegments, setHeatSegments] = useState([]);
  const [heatLoading, setHeatLoading] = useState(false);
  const [leads, setLeads] = useState(null);

  const exportCsv = () => {
    window.open(`${API}/analytics/leads.csv`, "_blank");
  };

  const viewerHistories = useMemo(
    () => (leads?.leads || [])
      .flatMap((lead) => (lead.captured_leads || []).map((viewer) => ({ ...viewer, title: lead.title })))
      .slice(0, 8),
    [leads]
  );

  useEffect(() => {
    axios.get(`${API}/analytics/overview`, { headers: authHeader() }).then((r) => setStats(r.data)).catch(() => {});
    axios.get(`${API}/videos`, { headers: authHeader() })
      .then((r) => {
        setVideos(r.data || []);
        if (r.data?.length) setSelectedId((prev) => prev || r.data[0].id);
      })
      .catch(() => {});
    axios.get(`${API}/analytics/leads`, { headers: authHeader() })
      .then((r) => setLeads(r.data)).catch(() => {});
  }, [API, authHeader]);

  const loadHeatmap = useCallback((id) => {
    if (!id) { setHeatSegments([]); return; }
    setHeatLoading(true);
    axios.get(`${API}/videos/${id}/heatmap`)
      .then((r) => setHeatSegments(r.data.segments || []))
      .catch(() => setHeatSegments([]))
      .finally(() => setHeatLoading(false));
  }, [API]);

  useEffect(() => { loadHeatmap(selectedId); }, [selectedId, loadHeatmap]);

  const selectedVideo = videos.find((v) => v.id === selectedId);
  const buckets = buildHeatBuckets(heatSegments, selectedVideo?.duration);
  const hasHeatData = heatSegments.length > 0;

  const cards = [
    { label: "Plays this week", val: stats?.total_plays || 0, icon: Play, color: "bg-coral text-white", change: "+12%" },
    { label: "Total views", val: stats?.total_views || 0, icon: Users, color: "bg-mint", change: "+8%" },
    { label: "Videos", val: stats?.total_videos || 0, icon: Film, color: "bg-gold", change: "" },
    { label: "Play rate", val: `${stats?.play_rate ?? 0}%`, icon: Eye, color: "bg-white", change: "+4%" },
  ];

  return (
    <div className="p-8 md:p-10 max-w-7xl" data-testid="analytics-page">
      <div className="mb-7 flex justify-between items-start gap-4 flex-wrap">
        <div>
          <div className="font-hand text-2xl text-coral">the data speaks</div>
          <h1 className="font-heading text-4xl">Analytics</h1>
        </div>
        <button onClick={exportCsv} className="nb-btn nb-btn-ghost text-sm" data-testid="analytics-export-csv"><Download size={14}/> Export CRM CSV</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className={`${c.color} nb-border rounded-2xl p-5 nb-shadow-sm`}>
            <div className="flex justify-between items-center mb-3"><c.icon size={22} strokeWidth={2.5} /><span className="text-xs font-bold opacity-80">{c.change}</span></div>
            <div className="font-heading text-3xl">{c.val}</div>
            <div className="text-sm opacity-80">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="nb-card mb-6 bg-mint" data-testid="watch-time-summary">
        <div className="flex items-center gap-3">
          <Clock size={22}/>
          <div>
            <div className="font-heading text-xl">{Math.floor((stats?.total_watch_time || 0) / 60)} min watched</div>
            <p className="text-sm text-ink/70">Estimated from real 5-second segment tracking across all videos.</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="nb-card">
          <h3 className="font-heading text-xl mb-4">Plays &amp; views (last 7 days)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats?.trend || []}>
              <CartesianGrid stroke="#12112433" strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke="#121124" style={AXIS_LABEL_STYLE} />
              <YAxis stroke="#121124" />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="views" stroke="#FF6B6B" strokeWidth={3} dot={VIEWS_DOT} />
              <Line type="monotone" dataKey="plays" stroke="#98D8C8" strokeWidth={3} dot={PLAYS_DOT} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="nb-card">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h3 className="font-heading text-xl">Viewer heatmap</h3>
            <div className="flex items-center gap-2">
              {heatLoading && <Loader2 size={16} className="animate-spin text-coral" />}
              <select
                data-testid="heatmap-video-select"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="nb-border rounded-xl bg-white px-3 py-2 font-heading text-sm font-bold max-w-[220px] truncate cursor-pointer"
              >
                {videos.length === 0 && <option value="">No videos yet</option>}
                {videos.map((v) => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </select>
            </div>
          </div>

          {hasHeatData ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={buckets}>
                <CartesianGrid stroke="#12112433" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#121124" interval="preserveStartEnd" minTickGap={24} style={HEAT_AXIS_LABEL_STYLE} />
                <YAxis stroke="#121124" domain={HEAT_Y_DOMAIN} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<HeatTooltip />} cursor={HEAT_CURSOR} />
                <Bar dataKey="intensity" stroke="#121124" strokeWidth={1.5} radius={HEAT_BAR_RADIUS}>
                  {buckets.map((b, i) => (
                    <Cell key={`cell-${i}`} fill={b.intensity === 0 ? "#F3EFE6" : "#F4D068"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex flex-col items-center justify-center text-center px-6" data-testid="heatmap-empty">
              <Film size={40} className="text-ink/30 mb-3" />
              <p className="font-heading text-lg mb-1">No watch data yet</p>
              <p className="text-sm text-ink/60">
                {videos.length === 0
                  ? "Upload or record a video, then share it to start collecting viewer engagement."
                  : "Once people watch this video, you'll see exactly which 5-second sections they rewatched or skipped."}
              </p>
            </div>
          )}
          {hasHeatData && (
            <p className="text-sm text-ink/70 mt-3" data-testid="heatmap-caption">
              Tall gold bars = sections viewers rewatched most. Short/empty bars = where they dropped off.
            </p>
          )}
        </div>
      </div>

      {leads && leads.leads?.length > 0 && (
        <div className="nb-card mt-6" data-testid="leads-section">
          <h3 className="font-heading text-xl mb-4">Lead scoring</h3>
          <p className="text-sm text-ink/70 mb-4">{leads.hot_leads} hot leads (70%+ engagement) out of {leads.total} videos.</p>
          <div className="space-y-2">
            {leads.leads.slice(0, 8).map((l) => (
              <div key={l.video_id} className="flex items-center gap-4 p-3 rounded-xl bg-cream nb-border" data-testid={`lead-row-${l.video_id}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-heading text-sm truncate">{l.title}</div>
                  <div className="text-xs text-ink/60">{l.plays} plays · {l.views} views</div>
                  {l.captured_leads_count > 0 && <div className="text-xs text-coral font-bold" data-testid={`lead-captured-${l.video_id}`}>{l.captured_leads_count} captured email(s)</div>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 rounded-full bg-white nb-border overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${l.avg_engagement_pct}%`, background: l.is_hot_lead ? "#FF6B6B" : "#98D8C8" }}/>
                  </div>
                  <span className="text-xs font-bold w-10 text-right">{l.avg_engagement_pct}%</span>
                  {l.is_hot_lead && <span className="text-[10px] font-bold bg-coral text-white px-2 py-0.5 rounded-full">HOT</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {viewerHistories.map(x => (
              <div key={x.id} className="text-xs nb-border rounded-xl bg-white px-3 py-2" data-testid={`viewer-history-${x.id}`}>
                <b>{x.email}</b> watched <b>{x.title}</b>{x.name ? ` as ${x.name}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
