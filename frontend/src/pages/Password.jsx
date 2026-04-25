import React, { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowRight, Mail, Lock, ArrowLeft } from "lucide-react";
import { BrewlyLogo, HeroIllustration } from "../components/brewly/Illustrations";
import { API, fmtErr } from "../lib/auth";

function AuthShell({ title, eyebrow, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-background grid lg:grid-cols-[1fr_1.05fr]" data-testid="auth-page">
      <div className="hidden lg:flex relative bg-secondary text-secondary-foreground p-10 flex-col justify-between overflow-hidden">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
        <Link to="/" className="relative flex items-center gap-2.5 z-10">
          <div className="h-10 w-10 rounded-full bg-surface flex items-center justify-center"><BrewlyLogo size={28} /></div>
          <span className="font-display text-2xl font-extrabold">Brewly</span>
        </Link>
        <div className="relative z-10"><HeroIllustration /></div>
        <p className="relative z-10 font-display text-2xl font-extrabold leading-tight max-w-sm">
          Forgot is fine. We'll <span className="italic text-accent">brew you a new one</span>.
        </p>
      </div>
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md doodle-card-lg p-7 md:p-9">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to login
          </Link>
          <div className="text-xs font-extrabold uppercase tracking-[0.15em] text-primary">{eyebrow}</div>
          <h1 className="mt-1 font-display text-3xl md:text-4xl font-extrabold leading-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm font-bold text-center text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

const Field = ({ icon: Icon, label, ...p }) => (
  <label className="block">
    <span className="block text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</span>
    <span className="relative block">
      <Icon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input {...p} className="w-full doodle-pill bg-background border-secondary/30 pl-11 pr-4 py-3 text-sm font-semibold focus:outline-none focus:border-secondary focus:ring-2 focus:ring-ring/40" />
    </span>
  </label>
);

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await axios.post(`${API}/auth/forgot-password`, { email }); setDone(true); }
    catch (e) { setErr(fmtErr(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return (
    <AuthShell eyebrow="Forgot password" title={<>Let's get you back <span className="italic text-primary">in.</span></>}
      subtitle="Pop in your email — if there's an account, we'll send a reset link.">
      {done ? (
        <div className="doodle-pill bg-accent/40 px-4 py-3 text-sm font-bold" data-testid="forgot-done">
          ✦ If an account exists for <b>{email}</b>, a reset link is on its way. (Dev preview: link is in the backend logs.)
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
          <Field icon={Mail} label="Email" type="email" required value={email} onChange={e => setEmail(e.target.value)} data-testid="forgot-email" />
          {err && <div className="text-sm font-bold text-destructive doodle-pill bg-destructive/10 px-4 py-2">{err}</div>}
          <button disabled={busy} type="submit" className="doodle-btn btn-primary w-full h-12 text-base disabled:opacity-60" data-testid="forgot-submit">
            {busy ? "Brewing…" : "Send reset link"} <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await axios.post(`${API}/auth/reset-password`, { token, password });
      nav("/login");
    } catch (e) { setErr(fmtErr(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return (
    <AuthShell eyebrow="Reset password" title={<>Pick a fresh <span className="italic text-primary">passphrase.</span></>}
      subtitle="Make it cozy. Make it strong. At least 6 characters.">
      <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
        <Field icon={Lock} label="New password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} data-testid="reset-password" />
        {!token && <div className="text-sm font-bold text-destructive doodle-pill bg-destructive/10 px-4 py-2">No token in URL — request a new reset link.</div>}
        {err && <div className="text-sm font-bold text-destructive doodle-pill bg-destructive/10 px-4 py-2">{err}</div>}
        <button disabled={busy || !token} type="submit" className="doodle-btn btn-primary w-full h-12 text-base disabled:opacity-60" data-testid="reset-submit">
          {busy ? "Resetting…" : "Set new password"} <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </AuthShell>
  );
}
