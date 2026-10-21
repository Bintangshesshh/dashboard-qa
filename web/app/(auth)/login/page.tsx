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
      router.replace(params.get("next") || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
      setBusy(false);
    }
  };

  return (
    <div className="pb-login">
      <form className="pb-login-card" onSubmit={submit}>
        <h1>Playbook</h1>
        <p className="sub">Masuk untuk melihat hasil QA.</p>
        <div className="pb-grid" style={{ gap: 14 }}>
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
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
