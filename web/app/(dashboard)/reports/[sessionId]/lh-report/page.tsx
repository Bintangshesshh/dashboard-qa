"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, artifactUrl, type LighthouseResult, type Run } from "../../../../../lib/playbook";
import { ArtifactNote, useProbe } from "../../../../_components/report-link";
import "./viewer.css";

export default function LighthouseReport() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const params = useSearchParams();
  const runId = params.get("run");
  const [run, setRun] = useState<Run | null>(null);
  const [selected, setSelected] = useState(params.get("result") ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!runId) { setError("Run tidak ditemukan."); return; }
    let active = true;
    api.run(runId).then(data => {
      if (!active) return;
      if (data.session_id !== sessionId || data.tool !== "lh") { setError("Run tidak ditemukan."); return; }
      setRun(data);
    }).catch(() => { if (active) setError("Run tidak ditemukan atau sesi login habis."); });
    return () => { active = false; };
  }, [runId, sessionId]);

  const results = ((run?.results ?? []) as LighthouseResult[]).filter(r => r.report_path);
  const result = results.find(r => r.id === selected) ?? results[0];
  const url = result?.report_path ? artifactUrl(run!.id, result.report_path) : null;
  const state = useProbe(url);
  const urls = [...new Set(results.map(r => r.url))];

  useEffect(() => {
    if (!result) return;
    const hash = `#${result.form_factor === "desktop" ? "desktop" : "mobile"}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }, [result]);

  function selectDevice(device: "mobile" | "desktop") {
    const next = results.find(r => r.url === result?.url && r.form_factor === device);
    if (next) setSelected(next.id);
  }

  return <main className="lh-viewer">
    <header className="lh-viewer-header">
      <h1>Report Lighthouse</h1>
      {result && <>
        <p className="lh-viewer-url">{result.url}</p>
        {urls.length > 1 && <label className="lh-viewer-url-select">
          <select aria-label="Pilih URL report" value={result.url} onChange={e => {
            const next = results.find(r => r.url === e.target.value && r.form_factor === result.form_factor)
              ?? results.find(r => r.url === e.target.value);
            if (next) setSelected(next.id);
          }}>{urls.map(item => <option key={item} value={item}>{item}</option>)}</select>
        </label>}
      </>}
    </header>
    {error ? <p role="alert">{error}</p> : !run ? <p>Memuat report…</p> : state !== "ok" ? <ArtifactNote state={state} /> :
      <iframe key={result!.id} title="Report Lighthouse" src={`${url}#${result!.form_factor === "desktop" ? "desktop" : "mobile"}`}
        onLoad={e => {
          // Report mode both lama menyimpan pemilih URL di dalam iframe.
          try {
            const doc = e.currentTarget.contentDocument;
            const select = doc?.querySelector<HTMLSelectElement>(`[data-panel="${result!.form_factor}"] select[data-src]`);
            const option = select && [...select.options].find(item => item.textContent === result!.url);
            if (select && option) { select.value = option.value; select.dispatchEvent(new Event("change")); }
            const frame = e.currentTarget.contentWindow;
            const sync = () => {
              const device = frame?.location.hash === "#desktop" ? "desktop" : "mobile";
              const current = doc?.querySelector<HTMLSelectElement>(`[data-panel="${device}"] select[data-src]`);
              const selectedUrl = current?.selectedOptions[0]?.textContent ?? result!.url;
              const next = results.find(r => r.url === selectedUrl && r.form_factor === device);
              if (next) setSelected(next.id);
            };
            frame?.addEventListener("hashchange", sync);
            doc?.querySelectorAll("select[data-src]").forEach(item => item.addEventListener("change", sync));
          } catch { /* Report lintas origin tidak bisa diakses. */ }
        }} />}
  </main>;
}
