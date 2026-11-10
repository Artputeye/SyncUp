"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify({ email, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      const requested = new URLSearchParams(window.location.search).get("next");
      const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/workspaces";
      router.replace(destination); router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ไม่สามารถเข้าสู่ระบบได้");
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-visual">
      <div className="brand"><span className="brand-mark">S</span> SyncUp</div>
      <div className="visual-copy"><div className="eyebrow" style={{color:"#a8d7bb"}}>ONE PLATFORM. MANY POSSIBILITIES.</div><h1>Bring your work together.</h1><p>พื้นที่ทำงานที่เชื่อมต่อทีม ข้อมูล และเครื่องมือธุรกิจของคุณไว้ในที่เดียว</p></div>
      <div className="visual-foot">© 2026 SyncUp. Built for teams that move forward.</div>
    </section>
    <section className="auth-panel"><div className="auth-card">
      <div className="eyebrow">WELCOME BACK</div><h2>เข้าสู่ระบบ</h2><p className="subtle">ลงชื่อเข้าใช้เพื่อไปยัง Workspace ของคุณ</p>
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="email">อีเมล</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@company.com"/></div>
        <div className="field"><label htmlFor="password">รหัสผ่าน</label><div className="password-input-wrap"><input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="กรอกรหัสผ่าน"/><button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={showPassword}>{showPassword ? ( <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 002.8 2.8"/><path d="M9.9 5.2A11 11 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1.1-1.2 2.3-2.4 3.4M6.2 6.2C3.9 7.6 2.8 9.8 2.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3-.6"/></svg> ) : ( <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg> )}</button></div></div>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary full" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</button>
      </form>
      <p style={{fontSize:12,color:"var(--muted)",marginTop:24}}>การเข้าสู่ระบบจะใช้ Session Cookie แบบ HttpOnly เพื่อปกป้องข้อมูลบัญชีของคุณ</p>
    </div></section>
  </main>;
}
