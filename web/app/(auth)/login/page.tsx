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
      <div className="pb-login-card">
        <div className="pb-login-brand">
          <span className="brand-name">Playbook</span>
          <span className="brand-sub">Eureka Group</span>
        </div>

        <div className="pb-login-copy">
          <h1>QA yang bisa dibaca, bukan cuma dijalankan.</h1>
          <p>
            Playwright dan Lighthouse dalam satu dashboard. Hasil per sesi, bukti per run,
            tanpa perlu buka terminal tiap kali mau tahu ada yang rusak.
          </p>
        </div>

        <form onSubmit={submit}>
          <div className="pb-grid" style={{ gap: 13 }}>
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

        <div className="pb-login-foot">
          <span>playbook · internal</span>
          <span>akses terbatas</span>
        </div>
      </div>
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
