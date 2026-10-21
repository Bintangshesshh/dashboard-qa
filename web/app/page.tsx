"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Case, type Row, type Run, type Suite, TITLES, stats, toRow, within } from "./qa-model";
import { KpiGrid, LineChart, PassRateBars, StatusPill } from "./_components/kpis";
import { FailureCards, FailurePreview, ProjectGrid, RecentRuns, RunDrawer, RunsTable } from "./_components/views";

const API = process.env.NEXT_PUBLIC_API || "";
const WORKBENCH = ["workspace", "lighthouse", "history"];
const QA_NAV: [string, string][] = [["overview", "Overview"]];
const BENCH_NAV: [string, string][] = [["workspace", "Playwright"], ["lighthouse", "Lighthouse"], ["history", "Reports"]];
const starter = `import { test, expect } from '@playwright/test';

test('Page is available', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
`;
const MODE: Record<string, string> = { pw: "Playwright", lh: "Lighthouse", both: "Playwright + Lighthouse" };
const mss = (ms: number) => (ms >= 60000 ? Math.floor(ms / 60000) + "m " + String(Math.round((ms % 60000) / 1000)).padStart(2, "0") + "s" : Math.round(ms / 1000) + "s");

type Log = { seq: number; text: string; stream: string };

export default function Page() {
  const [now] = useState(() => Date.now());
  const [token, setToken] = useState(""), [authenticated, setAuthenticated] = useState(false), [input, setInput] = useState("");
  const [suites, setSuites] = useState<Suite[]>([]), [runs, setRuns] = useState<Run[]>([]);
  const [sid, setSid] = useState(""), [cid, setCid] = useState(""), [code, setCode] = useState(""), [view, setView] = useState("overview");
  const [collapsed, setCollapsed] = useState(true), [open, setOpen] = useState<Record<string, boolean>>({}), [query, setQuery] = useState("");
  const [mode, setMode] = useState("pw"), [headed, setHeaded] = useState(false), [scope, setScope] = useState("suite");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(""), [editing, setEditing] = useState(false), [name, setName] = useState(""), [target, setTarget] = useState(""), [description, setDescription] = useState("");
  const [detail, setDetail] = useState<Run | null>(null), [stream, setStream] = useState(""), [logs, setLogs] = useState<Log[]>([]), [connection, setConnection] = useState("standby"), [retry, setRetry] = useState(0);
  const [project, setProject] = useState("all"), [range] = useState(14), [statusFilter, setStatusFilter] = useState("all"), [selected, setSelected] = useState<string | null>(null);
  const followLogs = useRef(true), terminal = useRef<HTMLDivElement>(null), socket = useRef<WebSocket | null>(null), seq = useRef(0);
  const [dark, setDark] = useState(true);
  const suite = suites.find(s => s.id === sid), selectedCase = suite?.cases.find(c => c.id === cid), dirty = !!selectedCase && selectedCase.code !== code;

  const request = useCallback(async (path: string, init: RequestInit = {}, auth = token) => {
    if (init.method && init.method !== "GET" && !(path === "/api/session" && init.method === "DELETE") && !auth) {
      setModal("auth");
      throw new Error("Reconnect with operator token to run tests or edit. Saved session can read reports and logs.");
    }
    const response = await fetch(API + path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + auth } : {}), ...init.headers } });
    if (!response.ok) {
      let text = await response.text();
      try { text = JSON.parse(text).error || text } catch {}
      throw new Error(text || "Request failed: " + response.status);
    }
    return response.status === 204 ? null : response.json();
  }, [token]);

  const refresh = useCallback(async () => {
    const [rows, history] = await Promise.all([request("/api/suites"), request("/api/runs")]);
    const all = await Promise.all((rows as Suite[]).map(async s => ({ ...s, cases: await request("/api/suites/" + s.id + "/cases") })));
    setSuites(all);
    setRuns(history);
    setSid(id => (all.some(s => s.id === id) ? id : all[0]?.id || ""));
    setOpen(o => (Object.keys(o).length ? o : Object.fromEntries(all.map(s => [s.id, true]))));
  }, [request]);

  useEffect(() => { setCollapsed(window.innerWidth < 1000) }, []);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("qa-theme") } catch {}
    if (saved) setDark(saved === "dark");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("qa-theme", dark ? "dark" : "light") } catch {}
  }, [dark]);
  useEffect(() => {
    if (!authenticated) return;
    refresh().catch(e => setError(e.message));
    const id = setInterval(() => request("/api/runs").then(setRuns).catch(e => setError(e.message)), 4000);
    return () => clearInterval(id);
  }, [authenticated, refresh, request]);
  useEffect(() => { setCid(id => (suite?.cases.some(c => c.id === id) ? id : suite?.cases[0]?.id || "")) }, [suite]);
  useEffect(() => { setCode(selectedCase?.code || ""); setMenu(false); setSelected(null); setDetail(null) }, [selectedCase?.id, selectedCase?.code]);
  useEffect(() => { setStream(id => id || runs[0]?.id || "") }, [runs]);
  useEffect(() => { request("/api/suites").then(() => setAuthenticated(true)).catch(() => {}) }, [request]);

  const active = runs.find(r => r.id === stream);
  const [pollError, setPollError] = useState("");
  useEffect(() => {
    if (!stream || !authenticated) return;
    let disposed = false, ws: WebSocket | undefined, reconnect: ReturnType<typeof setTimeout>, pollTimer: ReturnType<typeof setTimeout>, cursor = 0, attempt = 0;
    seq.current = 0; followLogs.current = true; setLogs([]);
    const merge = (entries: Log[]) => {
      if (disposed) return;
      setLogs(previous => {
        if (!entries.length) return previous;
        const all = new Map(previous.map(l => [l.seq, l]));
        for (const l of entries) all.set(l.seq, l);
        return [...all.values()].sort((a, b) => a.seq - b.seq).slice(-3000);
      });
    };
    const poll = async () => {
      try {
        const result = await request("/api/runs/" + stream + "/logs?after=" + cursor);
        if (disposed) return;
        const entries = Array.isArray(result) ? result : result?.logs ?? [];
        merge(entries);
        for (const l of entries) cursor = Math.max(cursor, l.seq);
        setPollError("");
      } catch (e) {
        if (!disposed) setPollError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!disposed) pollTimer = setTimeout(poll, 2000);
      }
    };
    const connect = () => {
      if (disposed) return;
      setConnection("connecting");
      const url = process.env.NEXT_PUBLIC_WS_URL || (API ? API.replace(/^http/, "ws") + "/ws" : location.protocol.replace("http", "ws") + "//" + location.host + "/ws");
      try { ws = new WebSocket(url) } catch { setConnection("polling"); return }
      ws.onopen = () => { if (disposed) return; attempt = 0; setConnection("connected"); ws?.send(JSON.stringify({ type: "subscribe", token, runId: stream, after: seq.current })) };
      ws.onmessage = e => { if (disposed) return; try { const m = JSON.parse(e.data); if (m.type === "log" && m.runId === stream) { seq.current = Math.max(seq.current, m.seq); merge([m]) } } catch { setConnection("polling") } };
      ws.onerror = () => { if (!disposed) setConnection("polling") };
      ws.onclose = () => { if (disposed) return; setConnection("polling"); reconnect = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000)) };
    };
    poll();
    if (token) connect(); else setConnection("polling");
    return () => { disposed = true; clearTimeout(reconnect); clearTimeout(pollTimer); ws?.close() };
  }, [stream, authenticated, token, request, retry]);
  useEffect(() => { if (followLogs.current) terminal.current?.scrollTo({ top: terminal.current.scrollHeight }) }, [logs]);

  async function task(fn: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  function protectDirty() { return !dirty || confirm("Discard unsaved code changes?") }
  function choose(s: Suite, c?: Case) {
    if (!protectDirty()) return;
    setSid(s.id); setCid(c?.id || s.cases[0]?.id || ""); setView("workspace");
    if (innerWidth < 760) setCollapsed(true);
  }
  function form(kind: string, edit = false) {
    if (!edit && !protectDirty()) return;
    setEditing(edit);
    setName(edit ? (kind === "suite" ? suite?.name : selectedCase?.name) || "" : "");
    setTarget(edit ? suite?.targetUrl || "" : "");
    setDescription(edit ? suite?.description || "" : "");
    setModal(kind); setMenu(false);
  }
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = "" } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  async function connect() {
    await task(async () => {
      await request("/api/session", { method: "POST" }, input.trim());
      setToken(input.trim()); setAuthenticated(true); setInput(""); setModal(""); setView("overview");
    });
  }
  async function saveForm() {
    await task(async () => {
      if (!name.trim()) throw new Error("Name is required.");
      if (modal === "suite") {
        const u = new URL(target);
        if (!["http:", "https:"].includes(u.protocol)) throw new Error("Use an HTTP or HTTPS target URL.");
        const s = await request("/api/suites" + (editing ? "/" + sid : ""), { method: editing ? "PATCH" : "POST", body: JSON.stringify({ name: name.trim(), targetUrl: target, description }) });
        setSid(s.id); setOpen(o => ({ ...o, [s.id]: true }));
      } else {
        const c = await request(editing ? "/api/cases/" + cid : "/api/suites/" + sid + "/cases", { method: editing ? "PATCH" : "POST", body: JSON.stringify({ name: name.trim(), ...(editing ? {} : { code: starter, enabled: true }) }) });
        setCid(c.id);
      }
      await refresh(); setModal(""); setNotice("Changes saved.");
    });
  }
  async function remove(kind: string) {
    if (!confirm(kind === "suite" ? "Delete this suite and all its cases? This cannot be undone." : "Delete this test case? This cannot be undone.")) return;
    await task(async () => {
      await request(kind === "suite" ? "/api/suites/" + sid : "/api/cases/" + cid, { method: "DELETE" });
      await refresh(); setMenu(false);
    });
  }
  const running = runs.some(r => ["queued", "running"].includes(r.status) || r.docsStatus === "building");
  async function run(runMode = mode) {
    await task(async () => {
      if (runMode !== "lh" && dirty) throw new Error("Save code changes before running.");
      const r = await request("/api/runs", { method: "POST", body: JSON.stringify({ suiteId: sid, mode: runMode, headed, ...(runMode !== "lh" && scope === "case" && selectedCase ? { caseIds: [cid] } : {}) }) });
      setRuns(p => [r, ...p]); setStream(r.id); setNotice("Run queued. Live output appears below.");
    });
  }
  async function saveCode() {
    await task(async () => { await request("/api/cases/" + cid, { method: "PATCH", body: JSON.stringify({ code }) }); await refresh(); setNotice("Code saved.") });
  }

  const rows = useMemo(() => runs.map(toRow).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)), [runs]);
  const projects = useMemo(() => [...new Set(rows.map(r => r.project))], [rows]);
  const visible = useMemo(() => within(rows, range, project, now), [rows, range, project, now]);
  const summary = useMemo(() => stats(visible), [visible]);
  const detailRow = detail ? rows.find(r => r.id === detail.id) ?? null : null;
  const navView = ["runs", "failures", "projects"].includes(view) ? "overview" : view;
  const title = WORKBENCH.includes(view) ? (view === "lighthouse" ? "Lighthouse" : view === "history" ? "Reports" : "Playwright") : TITLES[view][0];
  const sub = WORKBENCH.includes(view) ? (suite ? suite.name + " · " + suite.targetUrl : "Select or create a suite.") : TITLES[view][1];
  function openRun(id: string) { const r = runs.find(x => x.id === id); if (!r) return; setDetail(r); setSelected(id); setStream(id) }

  return (
    <div className={"shell " + (collapsed ? "nav-off" : "")}>
      <aside className="sidebar" id="sidebar">
        <div className="brand"><span className="brand-text"><strong>Playbook</strong><small>Eureka Group</small></span></div>
        <nav aria-label="Main navigation" className="nav">
          {QA_NAV.map(([id, label]) => (
            <button key={id} className="nav-item" aria-current={navView === id ? "page" : undefined} onClick={() => setView(id)}>
              <span className="dot" />{label}
            </button>
          ))}
          {BENCH_NAV.map(([id, label]) => (
            <button key={id} className="nav-item" aria-current={navView === id ? "page" : undefined} onClick={() => setView(id)}>
              <span className="dot" />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user">
            <span className="avatar">OP</span>
            <span>
              <strong>{authenticated ? (token ? "Operator" : "Read-only") : "Guest"}</strong>
              <small>{authenticated ? (token ? "Full access" : "Saved session") : "Not connected"}</small>
            </span>
          </div>
          <p className="hint">{suites.length} suites · {runs.length} runs</p>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn" aria-label="Toggle sidebar" aria-expanded={!collapsed} onClick={() => setCollapsed(c => !c)}>☰</button>
          <div className="title-block"><h1>{title}</h1><p>{sub}</p></div>
          <div className="topbar-actions">
            {!WORKBENCH.includes(view) && (
              <>
                <label className="field">Project
                  <select value={project} onChange={e => setProject(e.target.value)} aria-label="Project filter">
                    <option value="all">All projects</option>
                    {projects.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="field">Range
                  <select value={range} disabled aria-label="Range filter">
                    <option value={14}>Last 14 days</option>
                  </select>
                </label>
              </>
            )}
            {authenticated
              ? <button className="icon-btn" disabled={!token} title={token ? "Sign out" : "Saved session"} onClick={() => task(async () => { await request("/api/session", { method: "DELETE" }); setAuthenticated(false); setToken("") })}>{token ? "⏻" : "–"}</button>
              : <button className="btn" onClick={() => setModal("auth")}>Connect workspace</button>}
            <button className="icon-btn" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={dark} onClick={() => setDark(d => !d)}>{dark ? "☀" : "☾"}</button>
            <button className="btn btn-primary" disabled={!authenticated} onClick={() => { setView("workspace"); setMode("pw"); run("pw") }}>New run</button>
          </div>
        </header>
        <main className="content">
          {error && <div role="alert" className="notice error">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
          {notice && <div role="status" className="notice">{notice}</div>}

          {view === "overview" && (
            <section className="view" id="view-overview">
              <KpiGrid rows={visible} s={summary} />
              <div className="grid-2">
                <article className="card">
                  <div className="card-head"><h2>Execution history</h2><span className="legend"><i className="sw accent" />Runs per day</span></div>
                  <LineChart rows={visible} range={range} today={now} series="runs" ariaLabel="Runs per day" />
                </article>
                <FailurePreview rows={visible} onOpen={openRun} onAll={() => setView("failures")} />
              </div>
              <RecentRuns rows={visible} onOpen={openRun} onAll={() => setView("runs")} />
            </section>
          )}
          {view === "runs" && <RunsTable rows={visible} status={statusFilter} selected={selected} onStatus={setStatusFilter} onOpen={openRun} />}
          {view === "failures" && <FailureCards rows={visible} onOpen={openRun} />}
          {view === "projects" && (
            <section className="view">
              <article className="card">
                <div className="card-head"><h2>Pass rate per project</h2><span className="legend"><i className="sw accent" />threshold 90%</span></div>
                <PassRateBars rows={visible} />
              </article>
              <ProjectGrid rows={visible} projects={projects} />
            </section>
          )}

          {view === "workspace" && (
            <div className={"workbench " + (collapsed ? "sidebar-hidden" : "")}>
              <aside hidden={collapsed} aria-label="Suite navigation">
                <div className="section-title"><h2>Suites</h2><button disabled={!authenticated} onClick={() => form("suite")}>New suite</button></div>
                <input aria-label="Search suites" placeholder="Search suites" value={query} onChange={e => setQuery(e.target.value)} />
                {suites.filter(s => s.name.toLowerCase().includes(query.toLowerCase())).map(s => (
                  <details key={s.id} open={open[s.id] ?? true} onToggle={e => { const expanded = e.currentTarget.open; setOpen(o => (o[s.id] === expanded ? o : { ...o, [s.id]: expanded })) }}>
                    <summary>{s.name}</summary>
                    <button className={"suite " + (sid === s.id ? "selected" : "")} onClick={() => choose(s)}>{s.name}<small>{s.cases.length} cases</small></button>
                    {s.cases.map(c => <button key={c.id} className={"tree-case " + (cid === c.id ? "selected" : "")} onClick={() => choose(s, c)}>{c.name}</button>)}
                  </details>
                ))}
                {!suites.length && <p className="muted">{authenticated ? "No suites. Create a target suite to begin." : "Connect to load suites."}</p>}
              </aside>
              <section className="workspace">
                <div className="section-title">
                  <div><h1>{suite ? suite.name : "Playwright"}</h1><p>{suite ? suite.targetUrl : "Select or create a suite."}</p></div>
                  {suite && <div className="actions"><button onClick={() => form("suite", true)}>Edit suite</button><button onClick={() => remove("suite")}>Delete suite</button></div>}
                </div>
                <section className="kpis">
                  {[["Total runs", runs.length, ""], ["Passed", stats(rows).passed, "ok"], ["Failed", stats(rows).failed, "bad"], ["Skipped", rows.reduce((n, r) => n + (r.run.summary?.skipped ?? 0), 0), "warn"], ["Success rate", stats(rows).rate + "%", stats(rows).rate >= 90 ? "ok" : stats(rows).rate >= 75 ? "warn" : "bad"], ["Avg duration", stats(rows).avg ? mss(stats(rows).avg) : "—", ""]].map(([label, value, tone]) => (
                    <article className="card kpi" key={String(label)}><h2>{label}</h2><div className={"kpi-value " + tone}>{value}</div></article>
                  ))}
                </section>
                <section className="grid-2">
                  <div className="card">
                    <div className="card-head"><h2>Execution history</h2><span className="legend"><i className="sw accent" />Pass rate per day</span></div>
                    <LineChart rows={rows} range={14} today={now} series="passRate" ariaLabel="Pass rate per day" />
                  </div>
                  <div className="card">
                    <div className="card-head"><h2>Recent runs</h2><button className="link" onClick={() => setView("runs")}>Open runs</button></div>
                    <div className="table-wrap">
                      <table><thead><tr><th>Suite</th><th>Status</th></tr></thead>
                        <tbody>{rows.slice(0, 8).map(r => <tr key={r.id} onClick={() => openRun(r.id)}><td>{r.suite}</td><td><StatusPill status={r.status} /></td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                </section>
                {selectedCase ? (
                  <>
                    <section className="card">
                      <div className="section-title">
                        <div><h2>{selectedCase.name}</h2><p>{suite?.name} · {suite?.targetUrl}</p></div>
                        <div className="actions">
                          <button disabled={!dirty} onClick={saveCode}>Save</button>
                          <button disabled={!authenticated || running} onClick={() => run(mode)}>Run {MODE[mode]}</button>
                          {suite && <button disabled={!authenticated} onClick={() => form("case", true)}>Rename</button>}
                          <button disabled={!authenticated} onClick={() => remove("case")}>Delete</button>
                        </div>
                      </div>
                      <div className="toolbar">
                        <label>Mode<select value={mode} onChange={e => setMode(e.target.value)}><option value="pw">pw</option><option value="lh">lh</option><option value="both">both</option></select></label>
                        <label>Scope<select value={scope} onChange={e => setScope(e.target.value)}><option value="suite">suite</option><option value="case">case</option></select></label>
                        <label><input type="checkbox" checked={headed} onChange={e => setHeaded(e.target.checked)} />headed</label>
                      </div>
                      <textarea aria-label="Test code" rows={14} spellCheck={false} value={code} onChange={e => setCode(e.target.value)} />
                    </section>
                    <section className="card">
                      <div className="card-head">
                        <h2>Run{active ? " · " + active.id.slice(0, 8) : ""}</h2>
                        <span className="hint">{connection}{pollError ? " · " + pollError : ""}</span>
                      </div>
                      {active && <p className="kpi-note">{active.suiteName} · {MODE[active.mode] ?? active.mode} · <StatusPill status={active.status === "passed" || active.status === "failed" ? active.status : "running"} /></p>}
                      <div className="terminal" role="log" aria-label="Live execution terminal" ref={terminal} onScroll={e => { const el = e.currentTarget; followLogs.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
                        {logs.length ? logs.map(l => <div key={l.seq} className={"log " + l.stream}>{l.text}</div>) : <p className="muted">No output yet.</p>}
                      </div>
                      <div className="actions">
                        <button disabled={!authenticated || running} onClick={() => run(mode)}>Run {MODE[mode]}</button>
                        <button disabled={!active?.reportUrl} onClick={() => active?.reportUrl && window.open(API + active.reportUrl, "_blank", "noopener")}>Open report</button>
                        <button disabled={!authenticated} onClick={() => task(async () => { await request("/api/runs/" + stream + "/cancel", { method: "POST" }); await refresh() })}>Cancel run</button>
                        {connection !== "connected" && <button onClick={() => setRetry(n => n + 1)}>Reconnect</button>}
                      </div>
                      <p className="hint">{active?.docsStatus ? "Docs: " + active.docsStatus : ""}</p>
                      {!!active?.artifacts?.length && (
                        <details><summary>Artifacts ({active.artifacts.length})</summary>
                          <ul>{active.artifacts.map(a => <li key={a}><a href={API + "/api/runs/" + encodeURIComponent(active.id) + "/artifacts/" + a.split("/").map(encodeURIComponent).join("/")} target="_blank" rel="noopener noreferrer">{a}</a></li>)}</ul>
                        </details>
                      )}
                    </section>
                  </>
                ) : <p className="muted">Select a case to edit and run.</p>}
              </section>
            </div>
          )}

          {view === "lighthouse" && (
            <div className="workbench">
              <section className="workspace">
                <div className="section-title"><div><h1>Lighthouse</h1><p>Performance budget runs for every suite target.</p></div></div>
                <section className="kpis">
                  {[["Runs", rows.filter(r => r.run.mode !== "pw").length, ""], ["Passed", rows.filter(r => r.run.mode !== "pw" && r.status === "passed").length, "ok"], ["Failed", rows.filter(r => r.run.mode !== "pw" && r.status === "failed").length, "bad"]].map(([label, value, tone]) => (
                    <article className="card kpi" key={String(label)}><h2>{label}</h2><div className={"kpi-value " + tone}>{value}</div></article>
                  ))}
                </section>
                <section className="card">
                  <div className="card-head"><h2>Lighthouse runs</h2></div>
                  <div className="table-wrap">
                    <table><thead><tr><th>Started</th><th>Suite</th><th>Status</th><th>Report</th></tr></thead>
                      <tbody>{rows.filter(r => r.run.mode !== "pw").map(r => <tr key={r.id}><td>{r.suite}</td><td><StatusPill status={r.status} /></td><td>{r.run.reportUrl ? <a href={API + r.run.reportUrl} target="_blank" rel="noopener noreferrer">Open</a> : "—"}</td></tr>)}</tbody>
                    </table>
                  </div>
                  {!rows.some(r => r.run.mode !== "pw") && <p className="empty">No Lighthouse runs yet.</p>}
                </section>
              </section>
            </div>
          )}

          {view === "history" && (
            <div className="workbench">
              <section className="workspace">
                <div className="section-title"><div><h1>Reports</h1><p>Playwright HTML reports and Lighthouse docs per run.</p></div></div>
                <section className="card">
                  <div className="table-wrap">
                    <table><thead><tr><th>Started</th><th>Suite</th><th>Mode</th><th>Status</th><th>Report</th><th>Docs</th></tr></thead>
                      <tbody>{rows.map(r => <tr key={r.id}><td>{r.suite}</td><td>{r.mode}</td><td><StatusPill status={r.status} /></td><td>{r.run.reportUrl?.startsWith("/reports/") ? <a href={API + r.run.reportUrl} target="_blank" rel="noopener noreferrer">Open report</a> : "No report yet"}</td><td>{r.run.docsStatus || "pending"}</td></tr>)}</tbody>
                    </table>
                  </div>
                  {!rows.length && <p className="empty">No runs recorded yet.</p>}
                </section>
              </section>
            </div>
          )}
        </main>
      </div>
      {detailRow && <RunDrawer row={detailRow} suites={suites} onClose={() => { setDetail(null); setSelected(null) }} />}
      {modal && (
        <div className="modal-backdrop">
          <section className="modal drawer" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={e => { if (e.key === "Escape") setModal("") }}>
            <h2 id="dialog-title">{modal === "auth" ? "Connect workspace" : (editing ? "Edit " : "New ") + modal}</h2>
            <form onSubmit={e => { e.preventDefault(); if (modal === "auth") connect(); else saveForm() }}>
              {modal === "auth" ? (
                <label>Operator token<input autoFocus required type="password" autoComplete="off" value={input} onChange={e => setInput(e.target.value)} /></label>
              ) : (
                <>
                  <label>Name<input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
                  {modal === "suite" && (
                    <>
                      <label>Target URL<input required type="url" value={target} onChange={e => setTarget(e.target.value)} /></label>
                      <label>Description (optional)<input maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
                    </>
                  )}
                </>
              )}
              {error && <p role="alert">{error}</p>}
              <div className="modal-actions">
                <button type="button" onClick={() => setModal("")}>Cancel</button>
                <button className="primary" disabled={busy} type="submit">{modal === "auth" ? "Connect" : editing ? "Save changes" : "Create " + modal}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
