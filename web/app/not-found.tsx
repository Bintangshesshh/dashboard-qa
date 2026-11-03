// URL yang tidak ada sebelumnya membalas layar default Next tanpa navigasi.
export default function NotFound() {
  return (
    <main className="pb-main" style={{ maxWidth: 640, margin: "64px auto", padding: "0 20px" }}>
      <div className="pb-card">
        <div className="pb-card-head">
          <h2>Halaman tidak ditemukan</h2>
          <p className="pb-card-sub">Alamat ini tidak ada di dashboard. Mungkin project atau sesi sudah dihapus.</p>
        </div>
        <div className="pb-row" style={{ marginTop: 12 }}>
          <a className="pb-btn primary" href="/">Ke Overview</a>
          <a className="pb-btn" href="/reports">Lihat laporan</a>
        </div>
      </div>
    </main>
  );
}
