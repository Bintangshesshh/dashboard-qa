// Kerangka saat data pertama belum tiba. Tanpa ini setiap navigasi menampilkan
// layar kosong dan user mengira aplikasi hang.
export default function Loading() {
  return (
    <main className="pb-main" style={{ maxWidth: 1080, margin: "32px auto", padding: "0 20px" }}>
      <div className="pb-card" aria-busy="true" aria-live="polite">
        <div className="pb-card-head">
          <h2 style={{ opacity: 0.7 }}>Memuat…</h2>
          <p className="pb-card-sub">Mengambil data dari server.</p>
        </div>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              height: 14,
              margin: "12px 0",
              borderRadius: 6,
              width: `${88 - i * 18}%`,
              background: "var(--surface-warm)",
            }}
          />
        ))}
      </div>
    </main>
  );
}
