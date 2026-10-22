"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "../../../lib/playbook";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api.login(username, password);
      const next = params.get("next") ?? "";
      // Tolak redirect keluar: hanya path internal.
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
      setBusy(false);
    }
  };

  return (
    <div className="pb-login">
      <section className="pb-login-brand">
        <div>
          <div className="brand-name">Playbook</div>
          <div className="brand-sub">Eureka Group</div>
        </div>
        <div className="pb-login-copy">
          <h1>QA yang bisa dibaca, bukan cuma dijalankan.</h1>
          <p>
            Playwright dan Lighthouse dalam satu dashboard. Hasil per sesi, bukti per run,
            tanpa perlu buka terminal tiap kali mau tahu ada yang rusak.
          </p>
        </div>
        <div className="pb-login-foot">
          <span>playbook · internal</span>
          <span>akses terbatas</span>
        </div>
      </section>

      <section className="pb-login-panel">
        <form className="pb-login-card" onSubmit={submit}>
          <div className="eyebrow">Akses internal</div>
          <h2>Masuk</h2>
          <p className="sub">Gunakan akun yang diberikan admin.</p>
          <div className="pb-grid" style={{ gap: 13, marginTop: 26 }}>
            <label className="pb-field">
              Username
              <input className="pb-input" autoFocus autoComplete="username" value={username}
                onChange={e => setUsername(e.target.value)} required />
            </label>
            <label className="pb-field">
              Password
              <input className="pb-input" type="password" autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} required />
            </label>
            {error && <div className="pb-err">{error}</div>}
            <button className="pb-btn primary" disabled={busy}>{busy ? "Memeriksa…" : "Masuk"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
