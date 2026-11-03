"use client";

// Satu throw di client component sebelumnya = layar putih tanpa navigasi.
// Boundary ini menjaga shell tetap hidup dan memberi jalan pulang.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="pb-main" style={{ maxWidth: 640, margin: "64px auto", padding: "0 20px" }}>
      <div className="pb-card">
        <div className="pb-card-head">
          <h2>Halaman gagal dimuat</h2>
          <p className="pb-card-sub">
            Kesalahan ini tercatat di console browser. Coba muat ulang dulu; kalau tetap gagal,
            periksa apakah backend masih hidup.
          </p>
        </div>
        <pre className="pb-mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "var(--bad)" }}>
          {error.message}
          {error.digest ? `\n${error.digest}` : ""}
        </pre>
        <div className="pb-row" style={{ marginTop: 12 }}>
          <button className="pb-btn primary" onClick={reset}>Coba lagi</button>
          <a className="pb-btn" href="/">Ke Overview</a>
        </div>
      </div>
    </main>
  );
}
