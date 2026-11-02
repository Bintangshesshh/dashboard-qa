// Satu stylesheet untuk semua dokumen report statis (sesi + per run).
// Palet disalin dari web/app/pb.css supaya report tidak terasa beda produk.
// ponytail: tema dashboard ada di localStorage, dokumen statis tak bisa membacanya -
// mode gelap ikut preferensi OS. Kalau harus sama persis, kirim tema lewat query
// dan render dua varian halaman.
export const reportCss = `
:root{
  color-scheme:light;
  --bg:#f8fafc;--card:#ffffff;--card-hi:#f1f5f9;--text:#0f172a;--fg-2:#1e293b;--muted:#475569;
  --line:#e2e8f0;--accent:#2563eb;--accent-soft:rgba(37,99,235,.1);
  --ok:#15803d;--warn:#b45309;--bad:#be123c;
  --ok-bg:rgba(21,128,61,.1);--warn-bg:rgba(180,83,9,.12);--bad-bg:rgba(190,18,60,.09);
  --radius:12px;--shadow:rgba(15,23,42,.06) 0 4px 24px;
  --font:Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --bg:#0b1020;--card:#131b2f;--card-hi:#182343;--text:#f8fafc;--fg-2:#cbd5e1;--muted:#a3b3c9;
    --line:#293653;--accent:#60a5fa;--accent-soft:rgba(96,165,250,.16);
    --ok:#22c55e;--warn:#fbbf24;--bad:#fb7185;
    --ok-bg:rgba(34,197,94,.12);--warn-bg:rgba(251,191,36,.12);--bad-bg:rgba(251,113,133,.12);
    --shadow:0 0 0 1px #293653;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased}
main{max-width:1080px;margin:0 auto;padding:32px 20px 64px}
h1,h2,h3,h4{margin:0;font-weight:600;letter-spacing:0;text-wrap:balance}
h1{font-size:24px;margin-bottom:6px}
h2{font-size:17px;margin:30px 0 10px}
h3{font-size:14px;margin:22px 0 8px}
h4{font-size:13px;margin:14px 0 4px}
p{margin:8px 0}
p,li{color:var(--fg-2)}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.mut{color:var(--muted)}
.mono{font-family:var(--mono);font-size:12.5px}
.card,article{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin:12px 0;box-shadow:var(--shadow)}
article{box-shadow:none}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;z-index:1;background:var(--card-hi);color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:color-mix(in oklab,var(--card-hi) 45%,var(--card))}
td.mono,th.mono{overflow-wrap:anywhere}
pre{background:var(--card-hi);border:1px solid var(--line);border-radius:10px;padding:12px;margin:10px 0;
  overflow:auto;max-height:480px;white-space:pre-wrap;overflow-wrap:anywhere;font:12.5px/1.55 var(--mono);color:var(--fg-2)}
code{font-family:var(--mono);font-size:12.5px;background:var(--card-hi);border-radius:5px;padding:1px 5px}
.b{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;line-height:1.65}
.ok{background:var(--ok-bg);color:var(--ok)}
.bad{background:var(--bad-bg);color:var(--bad)}
.warn{background:var(--warn-bg);color:var(--warn)}
.mut2{background:var(--card-hi);color:var(--muted)}
.num-ok{color:var(--ok);font-weight:600}
.num-warn{color:var(--warn);font-weight:600}
.num-bad{color:var(--bad);font-weight:600}
.scores{display:flex;flex-wrap:wrap;gap:10px;list-style:none;padding:0;margin:14px 0}
.score{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:10px 14px;min-width:150px}
.score svg{width:54px;height:54px;flex:none}
.score .track{fill:none;stroke:var(--line);stroke-width:8}
.score .val{fill:none;stroke-width:8;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%}
.score .val.ok{stroke:var(--ok)}
.score .val.warn{stroke:var(--warn)}
.score .val.bad{stroke:var(--bad)}
.score .val.mut2{stroke:var(--muted)}
.score b{display:block;font-size:16px;font-variant-numeric:tabular-nums}
.score span{display:block;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.kpi{display:flex;gap:24px;flex-wrap:wrap;margin:12px 0}
.kpi div{min-width:104px}
.kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.kpi span{font-size:12px;color:var(--muted)}
details{margin:10px 0}
details summary{cursor:pointer;color:var(--accent);font-size:13px}
figure{margin:10px 0}
[role=alert]{color:var(--bad);font-weight:600}
`;

