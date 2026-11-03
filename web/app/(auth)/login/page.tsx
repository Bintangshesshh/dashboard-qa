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
      <div className="pb-login-stage">
        <aside className="pb-login-aside">
          <span className="pb-login-mark" aria-hidden="true">P</span>
          <h1>Playbook</h1>
          <p className="pb-login-tagline">QA dashboard Eureka Group.</p>
          <ul className="pb-login-points">
            <li>Playwright &amp; Lighthouse dalam satu tempat</li>
            <li>Terminal, console, dan network live per project</li>
            <li>Laporan sesi siap dibagikan</li>
          </ul>
        </aside>

        <div className="pb-login-card">
          <div className="pb-login-brand">
            <span className="brand-name">Masuk</span>
            <span className="brand-sub">Playbook</span>
          </div>
          <p className="pb-login-sub">Gunakan akun dashboard untuk melanjutkan.</p>

          <form onSubmit={submit} style={{ marginTop: 22 }}>
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
