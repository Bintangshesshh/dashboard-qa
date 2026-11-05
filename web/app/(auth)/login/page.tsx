"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type CSSProperties } from "react";
import { api } from "../../../lib/playbook";

// --d mengatur jeda animasi checklist; pseudo-element mewarisi nilainya.
type TaskStyle = CSSProperties & { "--d": string };
const taskStyle = (i: number): TaskStyle => ({ "--d": `${0.4 + i * 0.9}s` });

const EYE = "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z";
const EYE_OFF = "M3 3l18 18M10.6 6.2A10.9 10.9 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.8M6.1 7.6C3.7 9.5 2 12 2 12s3.5 6 10 6a11 11 0 0 0 3.9-.7";

// `next` dari query bisa berisi URL login bersarang (sisa loop lama) atau
// alamat eksternal. Hanya terima path internal yang bukan halaman login,
// supaya setelah berhasil masuk user tidak terlempar balik ke form.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return path === "/login" ? "/" : raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api.login(username, password);
      // Tolak redirect keluar: hanya path internal.
      router.replace(safeNext(params.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
      setBusy(false);
    }
  };

  return (
    <div className="pb-login">
      <div className="pb-login-stage">
        <aside className="pb-login-aside">
          <h1>Playbook</h1>
          <p className="pb-login-tagline">QA dashboard Eureka Group.</p>
          <ul className="pb-login-points">
            {[
              "Playwright & Lighthouse dalam satu tempat",
              "Terminal, console, dan network live per project",
              "Laporan sesi siap dibagikan",
            ].map((text, i) => (
              <li key={text} style={taskStyle(i)}>
                <span className="pb-task-box" aria-hidden="true" />
                <span className="pb-task-text">{text}</span>
              </li>
            ))}
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
                <input className="pb-input" name="username" autoFocus autoComplete="username" value={username}
                  onChange={e => setUsername(e.target.value)} required />
              </label>
              <label className="pb-field">
                Password
                <span className="pb-pass">
                  <input className="pb-input" type={showPassword ? "text" : "password"} name="password"
                    autoComplete="current-password" value={password}
                    onChange={e => setPassword(e.target.value)} required />
                  <button type="button" className="pb-pass-toggle" aria-pressed={showPassword}
                    aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    title={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    onClick={() => setShowPassword(v => !v)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d={showPassword ? EYE_OFF : EYE} />
                      {!showPassword && <circle cx="12" cy="12" r="3" />}
                    </svg>
                  </button>
                </span>
              </label>
              {error && <div className="pb-err" role="alert">{error}</div>}
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
