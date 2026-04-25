import React, { useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { ArrowRight, Mail, Lock, User } from "lucide-react";
import { BrewlyLogo, HeroIllustration } from "../components/brewly/Illustrations";
import { useAuth, fmtErr } from "../lib/auth";

function AuthShell({ title, eyebrow, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-background grid lg:grid-cols-[1fr_1.05fr]" data-testid="auth-page">
      {/* Left panel — ink */}
      <div className="hidden lg:flex relative bg-secondary text-secondary-foreground p-10 flex-col justify-between overflow-hidden">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-accent/30 blur-3xl" />
        <Link to="/" className="relative flex items-center gap-2.5 z-10">
          <div className="h-10 w-10 rounded-full bg-surface flex items-center justify-center"><BrewlyLogo size={28} /></div>
          <span className="font-display text-2xl font-extrabold">Brewly</span>
        </Link>
        <div className="relative z-10">
          <HeroIllustration />
        </div>
        <p className="relative z-10 font-display text-2xl font-extrabold leading-tight max-w-sm">
          The cozy home for creators to <span className="italic text-accent">earn from the people</span> who love what they do.
        </p>
      </div>
      {/* Right form */}
      <div className="flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md doodle-card-lg p-7 md:p-9" data-testid="auth-card">
          <Link to="/" className="lg:hidden flex items-center gap-2 mb-6">
            <BrewlyLogo size={32} /><span className="font-display text-xl font-extrabold">Brewly</span>
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

const Field = ({ icon: Icon, ...p }) => (
  <label className="block">
    <span className="block text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-1.5">{p.label}</span>
    <span className="relative block">
      <Icon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        {...p} label={undefined}
        className="w-full doodle-pill bg-background border-secondary/30 pl-11 pr-4 py-3 text-sm font-semibold focus:outline-none focus:border-secondary focus:ring-2 focus:ring-ring/40"
      />
    </span>
  </label>
);

export function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@brewly.app");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await login(email, password); nav("/dashboard"); }
    catch (e) { setErr(fmtErr(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return (
    <AuthShell
      eyebrow="Welcome back"
      title={<>Pour yourself in.</>}
      subtitle="Log in to your Brewly creator dashboard."
      footer={<>New here? <Link to="/signup" className="text-primary underline" data-testid="signup-link">Make a Brewly</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" data-testid="login-form">
        <Field icon={Mail} label="Email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} data-testid="login-email" />
        <Field icon={Lock} label="Password" type="password" required value={password} onChange={e=>setPassword(e.target.value)} data-testid="login-password" />
        {err && <div className="text-sm font-bold text-destructive doodle-pill bg-destructive/10 px-4 py-2" data-testid="login-error">{err}</div>}
        <button disabled={busy} type="submit" className="doodle-btn btn-primary w-full h-12 text-base disabled:opacity-60" data-testid="login-submit">
          {busy ? "Brewing…" : "Log in"} <ArrowRight className="h-4 w-4" />
        </button>
        <div className="text-center pt-2">
          <Link to="/forgot-password" className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground hover:text-foreground" data-testid="forgot-link">
            Forgot password?
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await register(email, password, name); nav("/dashboard"); }
    catch (e) { setErr(fmtErr(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return (
    <AuthShell
      eyebrow="Free forever"
      title={<>Start your <span className="italic text-primary">Brewly</span>.</>}
      subtitle="Three sips and you're live. No fees, ever — pinky promise."
      footer={<>Already brewing? <Link to="/login" className="text-primary underline" data-testid="login-link">Log in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" data-testid="signup-form">
        <Field icon={User} label="Your name" type="text" required value={name} onChange={e=>setName(e.target.value)} data-testid="signup-name" />
        <Field icon={Mail} label="Email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} data-testid="signup-email" />
        <Field icon={Lock} label="Password" type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} data-testid="signup-password" />
        {err && <div className="text-sm font-bold text-destructive doodle-pill bg-destructive/10 px-4 py-2" data-testid="signup-error">{err}</div>}
        <button disabled={busy} type="submit" className="doodle-btn btn-primary w-full h-12 text-base disabled:opacity-60" data-testid="signup-submit">
          {busy ? "Brewing your page…" : "Sign up — free"} <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </AuthShell>
  );
}
