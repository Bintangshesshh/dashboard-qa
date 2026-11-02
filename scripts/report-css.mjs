// Satu stylesheet untuk semua halaman report statis (sesi + per run).
// Token disamakan dengan tema web (web/app/pb.css), lalu layout mengikuti
// referensi Agentic: nav sticky, hero, meta strip, KPI tile, panel, gauge.
// ponytail: tema dashboard hidup di localStorage dan dokumen statis tidak bisa
// membacanya, jadi tema report mengikuti preferensi OS. Kalau harus sama persis,
// kirim tema lewat query dan render dua varian.
export const reportCss = `
/* ---------- tokens ---------- */
:root{
  color-scheme:light;
  --bg:#f6f8fb;--surface:#ffffff;--surface-warm:#f1f5f9;--surface-sunken:#f8fafc;
  --fg:#0f172a;--fg-2:#334155;--muted:#475569;--faint:#64748b;
  --meta:#1d4ed8;--accent:#2563eb;--accent-on:#ffffff;
  --border:#e2e8f0;--border-soft:#eef2f7;--border-strong:#cbd5e1;
  --success:#166534;--warn:#92400e;--danger:#be123c;
  --success-bg:rgba(22,101,52,.08);--warn-bg:rgba(146,64,14,.09);--danger-bg:rgba(190,18,60,.08);
  --meta-bg:rgba(37,99,235,.09);--accent-soft:rgba(37,99,235,.1);
  --tool-pw:#0f766e;--tool-pw-bg:rgba(13,148,136,.1);--tool-pw-line:rgba(13,148,136,.28);
  --tool-lh:#c2410c;--tool-lh-bg:rgba(234,88,12,.1);--tool-lh-line:rgba(234,88,12,.28);
  --code-bg:#0b1220;--code-fg:#cbd5e1;--code-border:#1e293b;
  --shadow:none;--shadow-raised:0 10px 30px -22px rgba(15,23,42,.55);
  --focus:0 0 0 3px rgba(37,99,235,.28);
  --font:Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --fs-xs:11px;--fs-sm:12.5px;--fs-base:15px;--fs-lg:17px;--fs-xl:22px;--fs-2xl:34px;
  --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;--s6:24px;--s8:32px;--s10:40px;
  --r-sm:8px;--r-md:12px;--r-lg:16px;--r-pill:999px;
  --motion-fast:150ms;--motion-base:220ms;--ease:cubic-bezier(.2,0,0,1);
}
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --bg:#0b1020;--surface:#131b2f;--surface-warm:#182343;--surface-sunken:#0e1526;
    --fg:#f8fafc;--fg-2:#cbd5e1;--muted:#a3b3c9;--faint:#8ea0b8;
    --meta:#93c5fd;--accent:#60a5fa;--accent-on:#06111f;
    --border:#293653;--border-soft:#1e2a43;--border-strong:#3b4a6b;
    --success:#4ade80;--warn:#fbbf24;--danger:#fb7185;
    --success-bg:rgba(34,197,94,.12);--warn-bg:rgba(251,191,36,.12);--danger-bg:rgba(251,113,133,.12);
    --meta-bg:rgba(96,165,250,.14);--accent-soft:rgba(96,165,250,.16);
    --tool-pw:#2dd4bf;--tool-pw-bg:rgba(45,212,191,.12);--tool-pw-line:rgba(45,212,191,.3);
    --tool-lh:#fb923c;--tool-lh-bg:rgba(249,115,22,.12);--tool-lh-line:rgba(249,115,22,.3);
    --code-bg:#060b17;--code-fg:#cbd5e1;--code-border:#1e2a43;
    --shadow-raised:0 24px 72px -40px rgba(0,0,0,.75);
    --focus:0 0 0 3px rgba(96,165,250,.32);
  }
}

/* ---------- base ---------- */
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:var(--fs-base)/1.55 var(--font);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;padding-bottom:var(--s10)}
::selection{background:color-mix(in oklab,var(--accent) 24%,transparent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.container{max-width:1240px;margin:0 auto;padding-inline:var(--s8)}
@media (max-width:768px){.container{padding-inline:var(--s4)}}
a{color:var(--accent);text-decoration:none;transition:color var(--motion-fast) var(--ease)}
a:hover{text-decoration:underline;text-underline-offset:2px}
p{margin:var(--s2) 0;color:var(--fg-2)}
.mut{color:var(--muted)}
.mono{font-family:var(--mono);font-size:var(--fs-sm);overflow-wrap:anywhere}
h1,h2,h3,h4{margin:0;font-family:var(--font);font-weight:600;letter-spacing:-.01em;text-wrap:balance}
h2{font-size:var(--fs-lg);line-height:1.3}
h3{font-size:14.5px;line-height:1.35;margin:var(--s5) 0 var(--s2)}
h4{font-size:13px;line-height:1.4;margin:var(--s3) 0 var(--s1);color:var(--fg-2)}
.skip{position:absolute;left:-9999px;top:0;z-index:80;padding:10px 16px;background:var(--accent);color:var(--accent-on);border-radius:0 0 var(--r-sm) 0;font-weight:600}
.skip:focus{left:0}

/* ---------- top nav ---------- */
.top-nav{position:sticky;top:0;z-index:40;background:color-mix(in oklab,var(--surface) 88%,transparent);
  border-bottom:1px solid var(--border);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.top-nav-inner{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);
  flex-wrap:wrap;min-height:61px;padding-block:var(--s2)}
.nav-brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand-mark{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:9px;
  background:var(--surface-warm);border:1px solid var(--border);color:var(--accent)}
.brand-text{min-width:0}
.brand-title{font-size:14.5px;font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.brand-subtitle{font:var(--fs-xs)/1.4 var(--mono);color:var(--muted);overflow-wrap:anywhere}
.nav-actions{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;justify-content:flex-end}

/* ---------- buttons + badges ---------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;
  background:var(--surface);color:var(--fg-2);border:1px solid var(--border-strong);border-radius:9px;
  font:500 var(--fs-sm)/1 var(--font);white-space:nowrap;cursor:pointer;
  transition:background var(--motion-fast) var(--ease),border-color var(--motion-fast) var(--ease),color var(--motion-fast) var(--ease)}
.btn:hover{background:var(--surface-warm);color:var(--fg);border-color:var(--muted);text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-on)}
.btn.primary:hover{background:color-mix(in oklab,var(--accent),black 8%);border-color:color-mix(in oklab,var(--accent),black 8%);color:var(--accent-on)}
.btn.sm{height:28px;padding:0 10px;font-size:var(--fs-xs)}
.b{display:inline-flex;align-items:center;gap:6px;min-height:22px;padding:1px 9px;border-radius:var(--r-pill);
  white-space:nowrap;font:600 var(--fs-xs)/1.6 var(--mono);border:1px solid transparent}
.b::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.b.ok{background:var(--success-bg);color:var(--success);border-color:color-mix(in oklab,var(--success) 30%,transparent)}
.b.bad{background:var(--danger-bg);color:var(--danger);border-color:color-mix(in oklab,var(--danger) 30%,transparent)}
.b.warn{background:var(--warn-bg);color:var(--warn);border-color:color-mix(in oklab,var(--warn) 30%,transparent)}
.b.mut2{background:var(--surface-warm);color:var(--muted);border-color:var(--border)}
.b.mut2::before{background:var(--faint)}
a.b:hover{text-decoration:none;filter:brightness(.96)}
.tool{display:inline-flex;align-items:center;padding:1px 8px;border-radius:6px;border:1px solid var(--border);
  background:var(--surface-warm);color:var(--fg-2);font:600 10.5px var(--mono);text-transform:uppercase;letter-spacing:.05em}
.tool.pw{background:var(--tool-pw-bg);color:var(--tool-pw);border-color:var(--tool-pw-line)}
.tool.lh{background:var(--tool-lh-bg);color:var(--tool-lh);border-color:var(--tool-lh-line)}

/* ---------- hero ---------- */
.hero{padding:var(--s10) 0 var(--s6);border-bottom:1px solid var(--border-soft);margin-bottom:var(--s6)}
.eyebrow{display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;color:var(--meta);
  font:600 var(--fs-xs) var(--mono);text-transform:uppercase;letter-spacing:.12em}
h1{font-size:clamp(28px,3.6vw,42px);line-height:1.08;letter-spacing:-.025em;font-weight:700;margin-bottom:var(--s2)}
.lead{max-width:74ch;margin:0;font-size:14.5px;line-height:1.6;color:var(--muted)}
.meta-strip{display:flex;flex-wrap:wrap;align-items:center;gap:6px 0;margin-top:var(--s5);padding:9px 14px;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);font-size:13px;color:var(--fg-2)}
.meta-item{display:flex;align-items:center;gap:7px;min-width:0;padding:2px 14px}
.meta-item:first-child{padding-left:2px}
.meta-item:last-child{padding-right:2px}
.meta-item strong{color:var(--fg);font-weight:600}
.meta-divider{width:1px;height:15px;background:var(--border);flex:none}
@media (max-width:640px){
  .meta-strip{gap:8px 16px;padding:10px 12px}
  .meta-item{padding:0}
  .meta-divider{display:none}
}
.env-tag{padding:0 8px;border-radius:var(--r-pill);background:var(--meta-bg);color:var(--meta);
  border:1px solid color-mix(in oklab,var(--meta) 28%,transparent);font:600 11px var(--mono)}
.snapshot-banner{margin-top:var(--s4);padding:12px 16px;background:var(--surface-warm);border:1px solid var(--border);
  border-left:3px solid var(--meta);border-radius:var(--r-sm);font-size:13px;color:var(--fg-2)}
.snapshot-banner p{margin:0}
.snapshot-banner pre{margin-top:var(--s2)}

/* ---------- KPI tiles ---------- */
.card-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:var(--s6)}
@media (max-width:980px){.card-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:380px){.card-row{grid-template-columns:1fr}}
.tile{display:flex;flex-direction:column;min-height:116px;padding:var(--s4) 18px;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);
  transition:border-color var(--motion-base) var(--ease),box-shadow var(--motion-base) var(--ease)}
.tile:hover{border-color:var(--border-strong);box-shadow:var(--shadow-raised)}
.tile-top{display:flex;align-items:center;justify-content:space-between;gap:var(--s2)}
.tile-label{font:600 10.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.tile-dot{width:6px;height:6px;border-radius:50%;background:var(--tone,var(--border-strong));flex:none}
.tile.tone-ok{--tone:var(--success)}
.tile.tone-warn{--tone:var(--warn)}
.tile.tone-bad{--tone:var(--danger)}
.tile:has(.tile-value .b) .tile-dot{display:none}
.tile-value{display:flex;align-items:center;gap:6px;margin-top:14px;font-family:var(--font);
  font-size:var(--fs-2xl);font-weight:700;line-height:1.05;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.tile-value.sm{font-size:16px;font-weight:600;letter-spacing:0;line-height:1.35;font-family:var(--font)}
.tile.tone-bad .tile-value{color:var(--danger)}
.tile.tone-warn .tile-value{color:var(--warn)}
.tile-sub{margin-top:auto;padding-top:10px;font-size:var(--fs-xs);line-height:1.4;color:var(--muted)}
.tile.tone-ok .tile-sub{color:var(--success)}
.tile.tone-warn .tile-sub{color:var(--warn)}
.tile.tone-bad .tile-sub{color:var(--danger)}

/* ---------- panels ---------- */
.panel{margin-bottom:var(--s5);background:var(--surface);border:1px solid var(--border);
  border-radius:var(--r-lg);overflow:clip;scroll-margin-top:76px}
.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s4);flex-wrap:wrap;
  padding:15px var(--s5);border-bottom:1px solid var(--border-soft);background:var(--surface)}
.panel-head h2,.panel-head h3{margin:0;font-size:var(--fs-lg);font-weight:600;line-height:1.3}
.panel-head h2 .tool,.panel-head h2 .b,.panel-head h3 .tool,.panel-head h3 .b{vertical-align:middle}
.panel-head h2 .tool,.panel-head h3 .tool{font-size:11px}
.panel-head p{margin:3px 0 0;font-size:var(--fs-sm);color:var(--muted);max-width:82ch}
.panel-body{padding:var(--s5)}
.panel-body>:first-child{margin-top:0}
.panel-body>:last-child{margin-bottom:0}
@media (max-width:560px){.panel-head,.panel-body{padding-inline:var(--s4)}}
.section-title{display:flex;align-items:center;gap:10px;margin:var(--s8) 0 var(--s3);
  font:600 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.section-title::after{content:"";flex:1;height:1px;background:var(--border)}
.doc-footer{margin-top:var(--s6);padding-top:var(--s4);border-top:1px solid var(--border-soft);
  font:var(--fs-xs)/1.5 var(--mono);color:var(--faint)}
.empty{padding:var(--s6) var(--s4);text-align:center;color:var(--muted);font-size:13px;
  background:var(--surface-sunken);border:1px dashed var(--border-strong);border-radius:var(--r-md)}
.callout{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);flex-wrap:wrap;
  padding:var(--s3) var(--s4);background:var(--surface-warm);border:1px solid var(--border-soft);border-radius:var(--r-md)}
.callout p{margin:0;font-size:13px;color:var(--muted)}

/* ---------- tables ---------- */
.tbl{margin:var(--s3) 0;border:1px solid var(--border-soft);border-radius:var(--r-md);
  overflow:auto;max-height:min(72vh,760px);background:var(--surface);overscroll-behavior:contain}
table{width:100%;min-width:680px;border-collapse:separate;border-spacing:0;font-size:13px}
tbody,thead{font-variant-numeric:tabular-nums}
th{position:sticky;top:0;z-index:2;background:var(--surface-warm);color:var(--muted);
  font:500 10px var(--mono);line-height:1.5;text-transform:uppercase;letter-spacing:.1em;
  text-align:left;white-space:nowrap;padding:9px 12px;border-bottom:1px solid var(--border)}
td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border-soft);vertical-align:middle}
th:first-child,td:first-child{padding-left:var(--s4)}
th:last-child,td:last-child{padding-right:var(--s4)}
tbody tr{transition:background var(--motion-fast) var(--ease)}
tbody tr:hover td{background:color-mix(in oklab,var(--fg) 3%,var(--surface))}
tbody tr:last-child td{border-bottom:0}
td.mono,th.mono{font-family:var(--mono);font-size:var(--fs-sm);color:var(--muted)}
td[class*="num-"]{text-align:right;font-family:var(--mono);font-size:var(--fs-sm);font-weight:600}
.num-ok{color:var(--success)}
.num-warn{color:var(--warn)}
.num-bad{color:var(--danger)}
.num-mut2{color:var(--muted)}
.target-url{font-family:var(--mono);font-size:var(--fs-sm);overflow-wrap:anywhere}
.dur{white-space:nowrap}
.dur-cell{display:inline-flex;align-items:center;gap:8px;min-width:104px;justify-content:flex-end}
.dur-bar{display:block;height:5px;min-width:2px;border-radius:3px;background:color-mix(in oklab,var(--accent) 55%,transparent)}

/* ---------- code + disclosure ---------- */
pre{margin:var(--s3) 0;padding:14px 16px;background:var(--code-bg);border:1px solid var(--code-border);
  border-radius:var(--r-sm);overflow:auto;max-height:440px;white-space:pre-wrap;overflow-wrap:anywhere;
  font:12.5px/1.6 var(--mono);color:var(--code-fg);tab-size:2}
pre code{background:none;border:0;padding:0;color:inherit;font:inherit}
code{padding:1px 5px;border:1px solid var(--border-soft);border-radius:5px;background:var(--surface-warm);
  font:12px var(--mono);color:var(--fg)}
details{margin:var(--s3) 0}
details>summary{display:flex;align-items:center;gap:8px;list-style:none;cursor:pointer;user-select:none;
  color:var(--accent);font-size:13px;font-weight:500;padding:5px 0;width:fit-content}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"";width:0;height:0;border-left:5px solid currentColor;
  border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform var(--motion-fast) var(--ease)}
details[open]>summary::before{transform:rotate(90deg)}
details>summary:hover{text-decoration:underline;text-underline-offset:2px}
article{margin:var(--s4) 0;padding:var(--s3) var(--s4);background:var(--surface-sunken);
  border:1px solid var(--border-soft);border-left:3px solid var(--border-strong);border-radius:var(--r-sm)}
article>h3:first-child,article>h4:first-child{margin-top:0}
article p:last-child{margin-bottom:0}
[role=alert]{color:var(--danger);font-weight:600}

/* ---------- file rows (artifact, screenshot, arsip) ---------- */
.file-list{list-style:none;margin:var(--s2) 0;padding:0;display:grid;gap:6px}
.file-row{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);
  padding:8px 10px;background:var(--surface-sunken);border:1px solid var(--border-soft);border-radius:var(--r-sm);
  transition:border-color var(--motion-fast) var(--ease),background var(--motion-fast) var(--ease)}
.file-row:hover{border-color:var(--border-strong);background:var(--surface-warm)}
.file-name{min-width:0;font:var(--fs-sm)/1.5 var(--mono);color:var(--fg-2);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-actions{display:flex;align-items:center;gap:12px;flex:none;font:600 11px var(--mono)}
.file-actions .link{color:var(--accent)}

/* ---------- lighthouse gauges ---------- */
.scores{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 var(--s5);padding:0;list-style:none}
@media (max-width:600px){.scores{grid-template-columns:repeat(2,minmax(0,1fr))}}
.score{display:grid;grid-template-areas:"ring" "label";justify-items:center;gap:var(--s2);
  padding:var(--s4) var(--s2);text-align:center;background:var(--surface-warm);
  border:1px solid var(--border-soft);border-radius:var(--r-md)}
.score svg{grid-area:ring;width:84px;height:84px}
.score .track{fill:none;stroke:var(--border);stroke-width:7}
.score .val{fill:none;stroke-width:7;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%}
.score .val.ok{stroke:var(--success)}
.score .val.warn{stroke:var(--warn)}
.score .val.bad{stroke:var(--danger)}
.score .val.mut2{stroke:var(--muted)}
.score b{grid-area:ring;align-self:center;font:700 17px var(--mono);font-variant-numeric:tabular-nums}
.score span{grid-area:label;font:600 10.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.cwv-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 var(--s5)}
@media (max-width:768px){.cwv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cwv-card{padding:10px 12px;background:var(--surface-sunken);border:1px solid var(--border-soft);border-radius:var(--r-sm)}
.cwv-name{font:600 10.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.cwv-val{margin:3px 0 1px;font:700 20px var(--mono);font-variant-numeric:tabular-nums}
.cwv-target{font-size:var(--fs-xs);color:var(--faint)}

/* ---------- misc ---------- */
figure{margin:var(--s3) 0}
ul,ol{padding-left:var(--s5)}
li{color:var(--fg-2)}
li::marker{color:var(--faint)}

@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{transition:none!important;animation:none!important}
}

/* ---------- print: dokumen ini sering dilampirkan ke tiket ---------- */
@media print{
  :root{--bg:#fff;--surface:#fff;--surface-warm:#fff;--surface-sunken:#fff;
    --fg:#000;--fg-2:#1a1a1a;--muted:#333;--faint:#444;--meta:#000;--accent:#000;
    --border:#bbb;--border-soft:#ddd;--border-strong:#999;
    --success:#0b5c2a;--warn:#5c3a00;--danger:#8a0f2b;
    --code-bg:#fff;--code-fg:#111;--code-border:#bbb}
  body{padding:0;font-size:11pt}
  .container{max-width:none;padding:0}
  .skip,.top-nav,.nav-actions,.tile-dot{display:none!important}
  .hero{padding-top:0}
  .panel,.tile,article,.file-row,.score,.cwv-card,.callout{box-shadow:none;break-inside:avoid}
  .panel{break-inside:auto}
  .panel-head{break-after:avoid}
  details>summary{display:none}
  details>*:not(summary){display:block!important}
  pre{white-space:pre-wrap;word-break:break-word;max-height:none;border:1px solid #bbb}
  a{color:#000;text-decoration:underline}
  .tbl{max-height:none;overflow:visible}
}
`;
