"use client";

// Link artifact yang divalidasi dulu. `/artifacts/*` balas {"error":"Not found"}
// kalau file sudah dibuang retensi atau report belum selesai dibangun; tanpa cek
// ini tombol "Buka" membuka tab berisi JSON mentah.
import { useEffect, useState } from "react";

export type Probe = "checking" | "ok" | "auth" | "missing";

export function useProbe(url: string | null): Probe {
  const [state, setState] = useState<Probe>("checking");
  useEffect(() => {
    if (!url) { setState("missing"); return; }
    let live = true;
    setState("checking");
    // Backend mati tidak boleh menggantung panel: batasi 5 s.
    fetch(url, { method: "HEAD", credentials: "include", signal: AbortSignal.timeout(5000) })
      .then(r => { if (live) setState(r.ok ? "ok" : r.status === 401 ? "auth" : "missing"); })
      .catch(() => { if (live) setState("missing"); });
    return () => { live = false; };
  }, [url]);
  return state;
}

export function LoginAgain() {
  const next = typeof window === "undefined" ? "" : location.pathname + location.search;
  return (
    <>
      Sesi login habis.{" "}
      <a className="pb-btn sm" href={"/login?next=" + encodeURIComponent(next)}>Login ulang</a>
    </>
  );
}

export function ArtifactNote({ state, missing = "report hilang / belum siap" }: { state: Probe; missing?: string }) {
  if (state === "checking") return <span className="pb-muted" style={{ fontSize: 12 }}>cek report…</span>;
  if (state === "ok") return null;
  if (state === "auth") {
    return <span className="pb-muted" style={{ fontSize: 12 }}><LoginAgain /></span>;
  }
  return <span className="pb-muted" style={{ fontSize: 12 }}>{missing}</span>;
}

export function ArtifactLink({ href, probeHref = href, children, className = "pb-btn sm", missing }: {
  href: string;
  probeHref?: string;
  children: React.ReactNode;
  className?: string;
  missing?: string;
}) {
  const state = useProbe(probeHref);
  if (state !== "ok") return <ArtifactNote state={state} missing={missing} />;
  return <a className={className} href={href} target="_blank" rel="noreferrer">{children}</a>;
}
