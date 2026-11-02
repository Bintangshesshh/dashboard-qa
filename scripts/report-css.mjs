// One stylesheet for every static report page (session + per-run).
// Layout follows the Agentic reference: sticky nav, hero, meta strip, KPI tiles, panels, gauge cards.
// ponytail: dashboard theme lives in localStorage, static docs cannot read it - dark mode follows
// the OS preference. If it must match exactly, pass the theme via query and render two variants.
export const reportCss = `
:root{
  color-scheme:light;
  --bg:#f8fafc;--surface:#ffffff;--surface-warm:#f1f5f9;
  --fg:#0f172a;--fg-2:#1e293b;--muted:#475569;
  --meta:#1d4ed8;--accent:#1d4ed8;--accent-on:#ffffff;
  --border:#e2e8f0;--border-soft:#eef2f7;
  --success:#166534;--warn:#92400e;--danger:#be123c;
  --success-bg:rgba(22,101,52,.1);--warn-bg:rgba(146,64,14,.1);--danger-bg:rgba(190,18,60,.09);--meta-bg:rgba(37,99,235,.1);
  --elev:0 1px 2px rgba(15,23,42,.05),0 14px 36px -22px rgba(15,23,42,.35);
  --font:Inter,-apple-system,BlinkMacSystemFont,"Helvetica Neue",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --bg:#0b1020;--surface:#131b2f;--surface-warm:#182343;
    --fg:#f8fafc;--fg-2:#cbd5e1;--muted:#a3b3c9;
    --meta:#60a5fa;--accent:#60a5fa;--accent-on:#06111f;
    --border:#293653;--border-soft:#1e2a43;
    --success:#22c55e;--warn:#fbbf24;--danger:#fb7185;
    --success-bg:rgba(34,197,94,.12);--warn-bg:rgba(251,191,36,.12);--danger-bg:rgba(251,113,133,.12);--meta-bg:rgba(96,165,250,.15);
    --elev:0 24px 72px -40px rgba(0,0,0,.65);
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased;padding-bottom:56px}
.container{max-width:1240px;margin:0 auto;padding:0 36px}
@media (max-width:768px){.container{padding:0 18px}}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
p{margin:8px 0;color:var(--fg-2)}
.mut{color:var(--muted)}
.mono{font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere}
h1,h2,h3,h4{margin:0;font-weight:700;letter-spacing:0;text-wrap:balance}
h2{font-size:17px}
h3{font-size:15px;margin:18px 0 8px}
h4{font-size:13.5px;margin:12px 0 4px}
/* nav */
.top-nav{position:sticky;top:0;z-index:40;background:var(--surface);border-bottom:1px solid var(--border)}
.top-nav-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;min-height:64px;padding:8px 36px}
.brand-title{font-size:15px;font-weight:700;line-height:1.25}
.brand-subtitle{font:11.5px var(--mono);color:var(--muted)}
/* badges */
.b{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;white-space:nowrap;
  font:600 11.5px var(--mono);line-height:1.65;border:1px solid transparent}
.b.ok{background:var(--success-bg);color:var(--success);border-color:color-mix(in oklab,var(--success) 34%,transparent)}
.b.bad{background:var(--danger-bg);color:var(--danger);border-color:color-mix(in oklab,var(--danger) 34%,transparent)}
.b.warn{background:var(--warn-bg);color:var(--warn);border-color:color-mix(in oklab,var(--warn) 34%,transparent)}
.b.mut2{background:var(--surface-warm);color:var(--muted);border-color:var(--border)}
.tool{display:inline-block;padding:1px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface-warm);
  color:var(--fg-2);font:600 10.5px var(--mono);text-transform:uppercase;letter-spacing:.04em}
/* hero */
.hero{padding:32px 0 24px;border-bottom:1px solid var(--border-soft);margin-bottom:28px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--meta);
  font:600 11.5px var(--mono);text-transform:uppercase;letter-spacing:.08em}
h1{font-size:32px;line-height:1.1;letter-spacing:-.02em;font-weight:800;margin-bottom:8px}
@media (max-width:540px){h1{font-size:25px}}
.lead{max-width:820px;margin:0;font-size:15px;color:var(--fg-2)}
.meta-strip{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:20px;padding:12px 20px;
  background:var(--surface);border:1px solid var(--border);border-radius:12px;font-size:13px;color:var(--fg-2)}
.meta-item{display:flex;align-items:center;gap:8px;min-width:0}
.meta-item strong{color:var(--fg);font-weight:600}
.meta-divider{width:1px;height:16px;background:var(--border)}
.env-tag{padding:1px 8px;border-radius:999px;background:var(--meta-bg);color:var(--meta);
  border:1px solid color-mix(in oklab,var(--meta) 34%,transparent);font:600 11px var(--mono)}
.snapshot-banner{margin-top:20px;padding:12px 16px;background:var(--surface-warm);border:1px solid var(--border);
  border-left:3px solid var(--meta);border-radius:8px;font-size:12.5px;color:var(--fg-2)}
/* KPI tiles */
.card-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}
@media (max-width:980px){.card-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:540px){.card-row{grid-template-columns:1fr}}
.tile{display:flex;flex-direction:column;padding:18px 20px;background:var(--surface);border:1px solid var(--border);
  border-radius:20px;box-shadow:var(--elev)}
.tile-label{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.tile-value{margin:6px 0 4px;font:800 30px/1.1 var(--mono);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.tile-value.sm{font-size:17px;line-height:1.3;font-weight:700}
.tile-sub{font-size:12px;color:var(--muted)}
.tile-sub.good{color:var(--success)}
.tile-sub.warn{color:var(--warn)}
.tile-sub.danger{color:var(--danger)}
/* panels */
.panel{margin-bottom:24px;background:var(--surface);border:1px solid var(--border);border-radius:20px;
  box-shadow:var(--elev);overflow:hidden}
.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding:18px 24px;border-bottom:1px solid var(--border-soft)}
.panel-head h2,.panel-head h3{margin:0}
.panel-head p{margin:3px 0 0;font-size:12px;color:var(--muted)}
.panel-body{padding:20px 24px}
.panel-body>:first-child{margin-top:0}
.panel-body>:last-child{margin-bottom:0}
@media (max-width:540px){.panel-head,.panel-body{padding-left:16px;padding-right:16px}}
/* tables */
.tbl{margin:12px 0;overflow-x:auto;border:1px solid var(--border-soft);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border-soft);vertical-align:top}
th{position:sticky;top:0;z-index:1;background:var(--surface-warm);color:var(--muted);
  font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:color-mix(in oklab,var(--surface-warm) 55%,var(--surface))}
td.mono{font-family:var(--mono);font-size:12.5px}
.target-url{font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere}
.num-ok{color:var(--success);font-weight:600;font-variant-numeric:tabular-nums}
.num-warn{color:var(--warn);font-weight:600;font-variant-numeric:tabular-nums}
.num-bad{color:var(--danger);font-weight:600;font-variant-numeric:tabular-nums}
.num-mut2{color:var(--muted);font-variant-numeric:tabular-nums}
/* code */
pre{margin:12px 0;padding:14px 16px;background:#060b17;border:1px solid var(--border);border-radius:10px;
  overflow:auto;max-height:480px;white-space:pre-wrap;overflow-wrap:anywhere;
  font:12.5px/1.55 var(--mono);color:#94a3b8}
pre code{background:none;border:0;padding:0;color:inherit;font:inherit}
code{padding:1px 5px;border:1px solid var(--border-soft);border-radius:5px;background:var(--surface-warm);
  font:12px var(--mono);color:var(--fg)}
details{margin:12px 0}
details summary{color:var(--meta);font-size:13px;font-weight:500;cursor:pointer;user-select:none}
details summary:hover{text-decoration:underline}
article{margin:12px 0;padding:14px 16px;background:var(--surface-warm);border:1px solid var(--border-soft);border-radius:12px}
/* lighthouse gauges */
.scores{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 20px;padding:0;list-style:none}
@media (max-width:600px){.scores{grid-template-columns:repeat(2,minmax(0,1fr))}}
.score{display:flex;flex-direction:column;align-items:center;gap:4px;padding:16px;text-align:center;
  background:var(--surface-warm);border:1px solid var(--border-soft);border-radius:16px}
.score svg{width:88px;height:88px}
.score .track{fill:none;stroke:var(--border);stroke-width:7}
.score .val{fill:none;stroke-width:7;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%}
.score .val.ok{stroke:var(--success)}
.score .val.warn{stroke:var(--warn)}
.score .val.bad{stroke:var(--danger)}
.score .val.mut2{stroke:var(--muted)}
.score b{font:700 17px var(--mono);font-variant-numeric:tabular-nums}
.score span{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
/* core web vitals */
.cwv-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 20px}
@media (max-width:768px){.cwv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cwv-card{padding:12px 14px;background:var(--surface-warm);border:1px solid var(--border-soft);border-radius:12px}
.cwv-name{font:600 11px var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.cwv-val{margin:4px 0 2px;font:700 21px var(--mono);font-variant-numeric:tabular-nums}
.cwv-target{font-size:11px;color:var(--muted)}
/* misc */
figure{margin:12px 0}
ul,ol{padding-left:22px}
li{color:var(--fg-2)}
[role=alert]{color:var(--danger);font-weight:600}
`;
