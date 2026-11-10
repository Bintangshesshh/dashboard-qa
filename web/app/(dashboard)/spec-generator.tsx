"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type GeneratedSpec, type TestFile } from "../../lib/playbook";
import { confirmAction, showInfoToast, showSuccessToast } from "../../lib/alerts";

type Token = { text: string; kind: "plain" | "comment" | "string" | "keyword" | "ident" };

// Tokenizer sederhana tanpa dependency: komentar, string, keyword, dan method Playwright.
const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\b(import|from|test|expect|async|await|const|let|var|function|return|if|else|new|for|throw|type)\b|\b(page|locator|goto|fill|click|check|selectOption|getByRole|getByLabel|getByPlaceholder|toBeVisible|toBeEnabled|toBeDisabled|toBeChecked|toHaveValue|toHaveTitle|toHaveURL|toBeAttached)\b/g;

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN_RE)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ text: code.slice(last, at), kind: "plain" });
    const kind: Token["kind"] = match[1] ? "comment" : match[2] ? "string" : match[3] ? "keyword" : "ident";
    tokens.push({ text: match[0], kind });
    last = at + match[0].length;
  }
  if (last < code.length) tokens.push({ text: code.slice(last), kind: "plain" });
  return tokens;
}

export function SpecGenerator({
  defaultUrl,
  projectId,
  projectSlug,
  projectName,
  existingFile,
  projectOptions,
  onProjectChange,
  onSaved,
}: {
  defaultUrl: string;
  projectId?: string;
  projectSlug?: string;
  projectName?: string;
  existingFile?: TestFile | null;
  projectOptions?: { id: string; name: string }[];
  onProjectChange?: (id: string) => void;
  onSaved?: (file: TestFile) => void;
}) {
  const [url, setUrl] = useState(defaultUrl);
  const [result, setResult] = useState<GeneratedSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [journey, setJourney] = useState(false);
  const [notice, setNotice] = useState("");

  // Project/environment berubah → hasil lama tidak boleh tersimpan ke project baru.
  useEffect(() => {
    setUrl(defaultUrl);
    setResult(null);
    setError("");
    setNotice("");
  }, [defaultUrl, projectId]);

  const tokens = useMemo(() => tokenize(result?.code ?? ""), [result?.code]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || !url.trim()) return;
    if (!(await confirmAction({
      title: "Generate template spec?",
      text: `Crawl ${url.trim()} dari mesin server.`,
      confirmButtonText: "Ya, Generate",
    }))) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      setResult(await api.generateSpec(url.trim(), projectId, journey));
      showSuccessToast("Template berhasil dibuat.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    if (!result) return;
    if (!(await confirmAction({
      title: "Download generated-flow.spec.ts?",
      confirmButtonText: "Ya, Download",
    }))) return;
    const blob = new Blob([result.code], { type: "text/typescript;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = journey ? "journey.spec.ts" : "generated-flow.spec.ts";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    showInfoToast("File .spec.ts diunduh.");
  };

  // Simpan langsung ke test file project supaya spec bisa dijalankan tanpa salin manual.
  const save = async () => {
    if (!result || !projectId || saving) return;
    const path = existingFile?.path ?? `tests/${projectSlug || "generated"}.spec.ts`;
    if (existingFile && !(await confirmAction({
      icon: "warning",
      title: "Timpa spec yang ada?",
      text: `${existingFile.path} akan diganti dengan hasil generate ini.`,
      confirmButtonText: "Ya, Timpa",
    }))) return;
    if (!existingFile && !(await confirmAction({
      title: "Simpan spec ke project?",
      text: `${path} akan dibuat dari hasil generate ini.`,
      confirmButtonText: "Ya, Simpan",
    }))) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = existingFile
        ? await api.patchTestFile(existingFile.id, { code: result.code, force: true })
        : await api.createTestFile({
          projectId,
          tool: "pw",
          path,
          label: `${projectName || projectSlug || "Project"} Playwright (${journey ? "journey" : "generated"})`,
          code: result.code,
        });
      setNotice(`Tersimpan ke ${saved.path}. Spec langsung bisa dijalankan.`);
      showSuccessToast(`Spec tersimpan ke ${saved.path}.`);
      onSaved?.(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const summary = result
    ? `${result.pages.length} halaman - ${result.pages.reduce((n, p) => n + p.inputs, 0)} input - ${result.pages.reduce((n, p) => n + p.buttons, 0)} tombol${(result as any).journey ? " - journey mode" : ""}`
    : "";

  return (
    <section className="pb-card pb-gen" style={{ marginBottom: 16 }}>
      <div className="pb-card-head">
        <div>
          <h2>Generate spec dari halaman</h2>
          <div className="pb-card-sub">
            {journey
              ? "Crawl seluruh path dan menu navigasi web, deteksi alur register/login/belanja, lalu rakit spec journey yang menjelajahi seluruh pengalaman pelanggan: daftar, masuk, cari, jelajah seluruh kategori & navigasi, beli, dan checkout."
              : "Crawl maksimal 3 halaman dari origin yang sama, lalu rakit spec QA yang siap dijalankan: cek halaman, isi form, tombol, dan navigasi tautan."}{" "}
            URL wajib lolos allowlist target.
          </div>
        </div>
      </div>

      <form className="pb-gen-form" onSubmit={submit}>
        {projectOptions && (
          <label className="pb-field pb-gen-project">
            Project
            <select
              className="pb-select"
              value={projectId ?? ""}
              onChange={e => onProjectChange?.(e.target.value)}
              disabled={loading || projectOptions.length === 0}
            >
              {projectOptions.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="pb-field">
          URL target
          <input
            className="pb-input"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://contoh.test/"
            spellCheck={false}
            autoComplete="off"
            disabled={loading}
          />
        </label>
        <label className="pb-check" title="Generate spec alur lengkap: register, login, cari produk, tambah keranjang, checkout">
          <input type="checkbox" checked={journey} onChange={e => setJourney(e.target.checked)} disabled={loading} />
          Journey mode
        </label>
        <button className="pb-btn primary" type="submit" disabled={loading || !url.trim()}>
          {loading ? "Membuat…" : journey ? "Generate Journey" : "Generate Template"}
        </button>
      </form>

      <p className="pb-hint" style={{ marginTop: 8 }}>
        Crawler berjalan di mesin server dashboard. <code className="pb-mono">localhost</code> berarti
        server itu, bukan laptop yang membuka browser. URL harus lolos allowlist project.
      </p>

      {error && <div className="pb-err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {notice && <div className="pb-ok" role="status" style={{ marginTop: 12 }}>{notice}</div>}

      {result && (
        <>
          <div className="pb-gen-bar">
            <span className="pb-muted" style={{ fontSize: 12 }}>{summary}</span>
            <span className="pb-row" style={{ gap: 8 }}>
              <button className="pb-btn sm" type="button" onClick={download}>
                Download .spec.ts
              </button>
              <button
                className="pb-btn sm primary"
                type="button"
                onClick={save}
                disabled={saving || !projectId}
                title={projectId
                  ? (existingFile ? `Timpa ${existingFile.path}` : "Simpan sebagai spec project")
                  : "Pilih project dulu supaya hasil generate bisa disimpan"}
              >
                {saving ? "Menyimpan…" : existingFile ? "Simpan & timpa spec" : "Simpan sebagai spec"}
              </button>
            </span>
          </div>
          <pre className="pb-gen-code" tabIndex={0} aria-label="Kode spec hasil generate">
            <code>
              {tokens.map((token, i) =>
                token.kind === "plain"
                  ? token.text
                  : <span key={i} className={`tok-${token.kind}`}>{token.text}</span>)}
            </code>
          </pre>
        </>
      )}
    </section>
  );
}
