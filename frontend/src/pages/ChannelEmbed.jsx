import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { Play, Sparkles, ExternalLink } from "lucide-react";
import { BrewlyLogo } from "../components/brewly/Illustrations";
import { API } from "../lib/auth";

function ChannelPlayer({ src, accent = "8 85% 67%", on = "40 50% 98%", title }) {
  const [playing, setPlaying] = useState(false);
  const ref = React.useRef(null);
  const toggle = () => {
    const v = ref.current; if (!v) return;
    if (v.paused) { const p = v.play(); if (p) p.catch(()=>{}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };
  return (
    <div className="relative aspect-video rounded-[var(--radius)] border-2 border-secondary overflow-hidden shadow-doodle bg-black">
      {src ? (
        <video ref={ref} src={src.startsWith("/api") ? `${process.env.REACT_APP_BACKEND_URL}${src}` : src}
               className="absolute inset-0 h-full w-full object-cover cursor-pointer"
               onClick={toggle} playsInline />
      ) : (
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, hsl(8 85% 67%), hsl(45 95% 65%))" }} />
      )}
      {!playing && (
        <button onClick={toggle} className="absolute inset-0 flex items-center justify-center"
                aria-label="Play" data-testid="channel-play">
          <span className="h-20 w-20 rounded-full border-2 border-secondary flex items-center justify-center"
                style={{ background: `hsl(${accent})`, color: `hsl(${on})`, boxShadow: "4px 4px 0 0 hsl(var(--secondary))" }}>
            <Play className="h-8 w-8 ml-1" fill={`hsl(${on})`} stroke="none" />
          </span>
        </button>
      )}
      {title && (
        <div className="absolute left-3 bottom-3 doodle-pill px-3 py-1 text-xs font-extrabold pointer-events-none"
             style={{ background: `hsl(${accent})`, color: `hsl(${on})`, boxShadow: "2px 2px 0 0 hsl(var(--secondary))" }}>
          ✦ {title}
        </div>
      )}
    </div>
  );
}

export default function ChannelEmbed() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    axios.get(`${API}/channels/public/${slug}`, { withCredentials: false })
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.status === 404 ? "Channel not found" : "Couldn't load channel"));
  }, [slug]);

  if (err) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="doodle-card p-10 text-center max-w-md">
          <BrewlyLogo size={48} className="mx-auto" />
          <h1 className="mt-4 font-display text-2xl font-extrabold">{err}</h1>
          <Link to="/" className="doodle-btn btn-primary mt-5 h-11 px-5 text-sm">Back to Brewly</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="font-display text-xl">Brewing…</p></div>;
  }

  const active = data.uploads?.[activeIdx];
  const preset = active?.preset || {};
  const accent = preset.accent_hsl || "8 85% 67%";
  const on = preset.accent_on || "40 50% 98%";

  return (
    <div className="min-h-screen bg-background" data-testid="channel-page">
      {/* Top header bar */}
      <header className="border-b-2 border-secondary/10 bg-surface/60 backdrop-blur-md">
        <div className="container py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <BrewlyLogo size={32} />
            <span className="font-display text-xl font-extrabold">Brewly</span>
          </Link>
          <Link to="/signup" className="doodle-btn btn-primary text-sm h-10 px-4" data-testid="channel-cta">
            <Sparkles className="h-4 w-4" /> Make your own
          </Link>
        </div>
      </header>

      <main className="container py-10 md:py-16">
        {/* Channel hero */}
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary doodle-pill bg-surface inline-flex px-3 py-1">
              brewly.to/c/{data.slug}
            </div>
            <h1 className="mt-4 font-display text-4xl md:text-5xl font-extrabold leading-[1.05]" data-testid="channel-name">{data.name}</h1>
            {data.tagline && <p className="mt-3 text-muted-foreground text-base md:text-lg max-w-2xl">{data.tagline}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="doodle-pill bg-surface px-4 py-1.5 text-sm font-extrabold">{data.uploads?.length || 0} videos</div>
              {data.owner_name && <div className="text-sm font-bold text-muted-foreground">by <span className="text-foreground">{data.owner_name}</span></div>}
            </div>
          </div>
          {active && (
            <div className="rounded-[var(--radius)] overflow-hidden">
              <ChannelPlayer src={active.video_url} accent={accent} on={on} title={preset.lower_third || active.title} />
            </div>
          )}
        </div>

        {/* Playlist */}
        {data.uploads?.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-2xl font-extrabold mb-4">Playlist</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="channel-playlist">
              {data.uploads.map((u, i) => {
                const isActive = i === activeIdx;
                return (
                  <button key={u.id} onClick={() => setActiveIdx(i)}
                          className={`text-left doodle-card p-3 transition-transform hover:-translate-y-0.5 ${isActive ? "ring-2 ring-primary" : ""}`}
                          data-testid={`channel-clip-${i}`}>
                    <div className="aspect-video rounded-md border-2 border-secondary relative overflow-hidden"
                         style={{ background: u.thumbnail }}>
                      <Play className="h-6 w-6 absolute inset-0 m-auto text-surface" />
                    </div>
                    <div className="mt-2 font-display text-sm font-extrabold leading-tight line-clamp-2">{u.title}</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-16 doodle-card-lg p-7 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrewlyLogo size={36} />
            <div>
              <div className="font-display text-xl font-extrabold">Powered by Brewly</div>
              <div className="text-sm text-muted-foreground">The cozy home for creators. 0% fees, ever.</div>
            </div>
          </div>
          <Link to="/signup" className="doodle-btn btn-primary h-11 px-5 text-sm">
            Start your page <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </main>
    </div>
  );
}
