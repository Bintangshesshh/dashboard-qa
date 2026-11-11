"use client";

import { useEffect, useState } from "react";
import { api, type Help } from "../../../lib/playbook";
import { confirmAction, confirmRun, showInfoToast, showSuccessToast } from "../../../lib/alerts";

// FAQ + versi tool + perintah update manual, dijawab dari data server agar tidak bohong.
const FAQ: { q: string; a: string }[] = [
  {
    q: "Apa beda sesi dan run?",
    a: "Sesi adalah wadah per project + environment + user. Run adalah satu eksekusi spec. "
      + "Sesi terbuka dipakai ulang selama umurnya belum lewat batas reuse, supaya report tidak terpecah.",
  },
  {
    q: "Kenapa waktu tampil WIB?",
    a: "Semua timestamp disimpan UTC dan ditampilkan dalam WIB agar jadwal run tidak beda-beda.",
  },
  {
    q: "Kenapa config Lighthouse ditolak?",
    a: "Total URL maksimal 5 (1 target project + 4 URL tambahan), numberOfRuns 1-10, "
      + "dan setiap URL harus satu origin dengan URL project yang diizinkan.",
  },
  {
    q: "Apa beda grup dan project?",
    a: "Grup hanya pengelompokan tampilan (Overview + filter). Project menyimpan URL, "
      + "spec, dan config. Project berriwayat diarsipkan, tidak dihapus.",
  },
];

export function Bantuan() {
  const [help, setHelp] = useState<Help | null>(null);

  useEffect(() => { api.help().then(setHelp).catch(() => {}); }, []);

  const rows: { label: string; value: string }[] = help ? [
    { label: "Versi dashboard", value: help.version },
    { label: "Node", value: help.node },
    { label: "Playwright", value: help.playwright },
    { label: "Lighthouse CI", value: help.lighthouse },
  ] : [];

  return (
    <>
      <section className="pb-card">
        <div className="pb-card-head">
          <div>
            <h2>Versi & update</h2>
          </div>
        </div>
        {help ? <div className="system-status-grid">
          {rows.map(r => <div className="system-status" key={r.label}><span>{r.label}</span><code className="pb-mono">{r.value ?? "tidak diketahui"}</code></div>)}
          <UpdateTools />
        </div> : <p className="pb-empty sm">Memuat versi…</p>}


        {help && (
          <div className="pb-lh-field pb-proj-foot">
            {help.update_commands.map(cmd => (
              <div className="pb-row" key={cmd}>
                <code className="pb-mono pb-cmd">{cmd}</code>
                <button className="pb-btn sm" onClick={() => confirmRun({
                  title: "Salin perintah ini?",
                  text: cmd,
                  confirmButtonText: "Ya, Salin",
                }, () => {
                  copy(cmd);
                  showInfoToast("Perintah disalin");
                })}>Salin</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="pb-card">
        <div className="pb-card-head">
          <div>
            <h2>FAQ</h2>
            <div className="pb-card-sub">Pertanyaan yang paling sering muncul saat pakai dashboard.</div>
          </div>
        </div>
        {FAQ.map(item => (
          <details className="pb-faq" key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>
</>
  );
}

// Tombol update tool (PRD S05): admin-only di server, sekali klik, output dialirkan.
// Tidak pernah jalan otomatis; versi tool ikut menentukan hasil run.
function UpdateTools() {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!(await confirmAction({
      icon: "question",
      title: "Perbarui Playwright dan Lighthouse?",
      text: "Run yang sedang jalan sebaiknya ditunggu sampai selesai.",
      confirmButtonText: "Ya, Perbarui",
    }))) return;
    setBusy(true); setOut("");
    try {
      await api.updateTools(t => setOut(prev => prev + t));
      showSuccessToast("Tools selesai diperbarui.");
    }
    catch (e) { setOut(prev => prev + "\n" + (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="pb-lh-field pb-proj-foot">
      <div className="pb-row" style={{ gap: 8, alignItems: "center" }}>
        <button className="pb-btn sm primary" onClick={run} disabled={busy}>
          {busy ? "Memperbarui…" : "Update All Tools"}
        </button>
      </div>
      {out && <pre className="pb-mono pb-tools-out">{out}</pre>}
    </div>
  );
}

// navigator.clipboard tidak ada di konteks non-secure; gagal = diamkan saja.
function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

