/* QA Dashboard — static mock UI. No backend, no build step. */
(() => {
  "use strict";

  // ---------- mock data ----------
  let seed = 20261020;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const PROJECTS = ["jaja", "masdis", "ebh"];
  const SUITES = {
    jaja: ["co-jaja checkout", "co-jaja login", "co-jaja cart"],
    masdis: ["co-masdis checkout", "co-masdis catalogue"],
    ebh: ["co-ebh checkout", "co-ebh login"],
  };
  const FAILURES = [
    ["expect(locator).toBeVisible() failed", "tests/eureka/co-jaja.spec.ts:42", "chromium"],
    ["Timeout 30000ms exceeded waiting for response", "tests/eureka/co-masdis.spec.ts:18", "chromium"],
    ["Error: strict mode violation: getByRole('button') resolved to 3 elements", "tests/eureka/co-ebh.spec.ts:77", "firefox"],
    ["expect(received).toHaveURL() — expected /order/ got /cart", "tests/eureka/cart-jaja.spec.ts:31", "chromium"],
    ["net::ERR_ABORTED at https://staging.example.com/checkout", "tests/eureka/co-masdis.spec.ts:56", "webkit"],
  ];

  const now = Date.now();
  const runs = Array.from({ length: 64 }, (_, i) => {
    const project = pick(PROJECTS);
    const ageDays = Math.floor(rand() * 14);
    const startedAt = new Date(now - ageDays * 864e5 - Math.floor(rand() * 8) * 36e5 - i * 6e4);
    const roll = rand();
    const status = roll > 0.94 ? "running" : roll > 0.82 ? "failed" : "passed";
    const failure = status === "failed" ? pick(FAILURES) : null;
    const passed = 18 + Math.floor(rand() * 22);
    const failed = status === "failed" ? 1 + Math.floor(rand() * 3) : 0;
    return {
      id: `run_${String(i + 1).padStart(3, "0")}`,
      project,
      suite: pick(SUITES[project]),
      mode: pick(["pw", "pw", "both", "lh"]),
      status,
      startedAt,
      durationMs: 62000 + Math.floor(rand() * 240000),
      passed,
      failed,
      flaky: Math.floor(rand() * 3),
      failure: failure && { message: failure[0], spec: failure[1], browser: failure[2] },
    };
  }).sort((a, b) => b.startedAt - a.startedAt);

  // ---------- state ----------
  const state = { view: "overview", project: "all", range: 14, status: "all", selected: null };

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stamp = (iso) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const dur = (ms) => `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`;
  const MODE = { pw: "Playwright", lh: "Lighthouse", both: "Playwright + Lighthouse" };

  const visible = () => {
    const since = now - state.range * 864e5;
    return runs.filter((r) => r.startedAt.getTime() >= since && (state.project === "all" || r.project === state.project));
  };
  const stats = (rows) => {
    const total = rows.reduce((n, r) => n + r.passed + r.failed, 0);
    const passed = rows.reduce((n, r) => n + r.passed, 0);
    return {
      total,
      passed,
      failed: rows.reduce((n, r) => n + r.failed, 0),
      flaky: rows.reduce((n, r) => n + r.flaky, 0),
      rate: total ? Math.round((passed / total) * 1000) / 10 : 0,
      avg: rows.length ? rows.reduce((n, r) => n + r.durationMs, 0) / rows.length : 0,
    };
  };

  // ---------- renderers ----------
  function renderKpis(rows) {
    const s = stats(rows);
    $("#successRate").textContent = `${s.rate}%`;
    $(".donut-label small").textContent = `of ${s.total.toLocaleString("en-US")} tests`;
    $("#donutValue").style.strokeDashoffset = String(314 - (314 * s.rate) / 100);
    $("#donutValue").style.stroke = s.rate >= 90 ? "var(--ok)" : s.rate >= 75 ? "var(--warn)" : "var(--bad)";
    $("#successDelta").textContent = `${s.passed.toLocaleString("en-US")} passed · ${s.failed} failed · ${s.flaky} flaky`;
    $("#kpiRuns").textContent = rows.length;
    $("#kpiPassed").textContent = s.passed.toLocaleString("en-US");
    $("#kpiFailed").textContent = s.failed;
    $("#kpiFlaky").textContent = s.flaky;
    $("#kpiDuration").textContent = s.avg ? dur(s.avg) : "—";
  }

  function renderChart(rows) {
    const chart = $("#chart");
    const axis = $("#chartAxis");
    chart.textContent = "";
    axis.textContent = "";
    const days = Array.from({ length: state.range }, (_, i) => {
      const d = new Date(now - (state.range - 1 - i) * 864e5);
      return { key: d.toDateString(), label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) };
    });
    const buckets = days.map((d) => rows.filter((r) => r.startedAt.toDateString() === d.key));
    const max = Math.max(1, ...buckets.map((b) => b.reduce((n, r) => n + r.passed + r.failed, 0)));
    buckets.forEach((b, i) => {
      const passed = b.reduce((n, r) => n + r.passed, 0);
      const failed = b.reduce((n, r) => n + r.failed, 0);
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.title = `${days[i].label}: ${passed} passed, ${failed} failed`;
      bar.innerHTML = `<span class="f" style="height:${(failed / max) * 100}%"></span><span class="p" style="height:${(passed / max) * 100}%"></span>`;
      chart.append(bar);
      const tick = document.createElement("span");
      tick.textContent = i % 2 === 0 ? days[i].label : "";
      axis.append(tick);
    });
  }

  const statusPill = (s) => `<span class="status ${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</span>`;

  function renderRecent(rows) {
    $("#recentRuns").innerHTML = rows
      .slice(0, 6)
      .map(
        (r) => `<tr data-run="${esc(r.id)}" tabindex="0">
          <td class="mono">${esc(stamp(r.startedAt))}<span class="sub">${esc(r.id)}</span></td>
          <td>${esc(r.project)}</td><td>${esc(r.suite)}</td><td>${esc(MODE[r.mode])}</td>
          <td class="mono">${esc(dur(r.durationMs))}</td><td>${statusPill(r.status)}</td></tr>`
      )
      .join("");
  }

  function renderFailurePreview(rows) {
    const failed = rows.filter((r) => r.failure).slice(0, 4);
    $("#failurePreview").innerHTML = failed.length
      ? failed.map((r) => `<li><strong>${esc(r.failure.message)}</strong><small>${esc(r.project)} · ${esc(r.failure.spec)} · ${esc(r.failure.browser)}</small></li>`).join("")
      : `<li style="border-left-color:var(--ok);background:var(--ok-bg)"><strong>No failures in range</strong><small>Every test passed.</small></li>`;
    $("#failureCount").textContent = rows.filter((r) => r.status === "failed").length;
  }

  function renderRunsTable(rows) {
    const filtered = rows.filter((r) => state.status === "all" || r.status === state.status);
    $("#runsEmpty").hidden = filtered.length > 0;
    $("#runsTable").innerHTML = filtered
      .map(
        (r) => `<tr data-run="${esc(r.id)}" tabindex="0" ${state.selected === r.id ? 'class="selected"' : ""}>
          <td class="mono">${esc(stamp(r.startedAt))}<span class="sub">${esc(r.id)}</span></td>
          <td>${esc(r.project)}</td><td>${esc(r.suite)}</td><td>${esc(MODE[r.mode])}</td>
          <td class="mono">${esc(dur(r.durationMs))}</td><td>${statusPill(r.status)}</td>
          <td><button class="btn btn-sm" data-run="${esc(r.id)}">Detail</button></td></tr>`
      )
      .join("");
  }

  function renderFailureCards(rows) {
    const failed = rows.filter((r) => r.failure);
    $("#failureCards").innerHTML = failed.length
      ? failed
          .map(
            (r) => `<article class="fcard">
              <h3>${esc(r.failure.message)}</h3>
              <pre>${esc(`1) ${r.failure.spec}\n   ${r.failure.message}\n   at ${r.failure.browser} · ${r.suite}\n   run ${r.id} · ${stamp(r.startedAt)}`)}</pre>
              <footer><span class="tag">${esc(r.project)}</span><span>${esc(r.failure.browser)}</span><button class="link" data-run="${esc(r.id)}">Inspect run</button></footer>
            </article>`
          )
          .join("")
      : `<p class="empty">No failures in the selected range.</p>`;
  }

  function renderProjects(rows) {
    $("#projectCards").innerHTML = PROJECTS.map((p) => {
      const mine = rows.filter((r) => r.project === p);
      const s = stats(mine);
      const level = s.rate >= 90 ? "" : s.rate >= 75 ? "warn" : "bad";
      const last = mine[0];
      return `<article class="pcard">
        <header><h3>${esc(p)}</h3>${statusPill(s.rate >= 75 ? "passed" : "failed")}</header>
        <div class="big">${s.rate}%</div>
        <div class="meter"><i class="${level}" style="width:${s.rate}%"></i></div>
        <dl>
          <div><dt>Runs</dt><dd>${mine.length}</dd></div>
          <div><dt>Failed</dt><dd>${s.failed}</dd></div>
          <div><dt>Avg</dt><dd>${s.avg ? dur(s.avg) : "—"}</dd></div>
        </dl>
        <p class="kpi-note">${last ? `Last run ${esc(stamp(last.startedAt))}` : "No runs yet"}</p>
      </article>`;
    }).join("");
  }

  function render() {
    const rows = visible();
    renderKpis(rows);
    renderChart(rows);
    renderRecent(rows);
    renderFailurePreview(rows);
    renderRunsTable(rows);
    renderFailureCards(rows);
    renderProjects(rows);
  }

  // ---------- detail drawer ----------
  function openDrawer(id) {
    const r = runs.find((x) => x.id === id);
    if (!r) return;
    state.selected = id;
    $("#drawerTitle").textContent = `Run ${r.id}`;
    $("#drawerBody").innerHTML = `
      <dl>
        <dt>Project</dt><dd>${esc(r.project)}</dd>
        <dt>Suite</dt><dd>${esc(r.suite)}</dd>
        <dt>Mode</dt><dd>${esc(MODE[r.mode])}</dd>
        <dt>Status</dt><dd>${statusPill(r.status)}</dd>
        <dt>Started</dt><dd>${esc(stamp(r.startedAt))}</dd>
        <dt>Duration</dt><dd>${esc(dur(r.durationMs))}</dd>
        <dt>Results</dt><dd>${r.passed} passed · ${r.failed} failed · ${r.flaky} flaky</dd>
      </dl>
      ${r.failure ? `<h3>Failure</h3><pre>${esc(`${r.failure.message}\n\n${r.failure.spec} [${r.failure.browser}]`)}</pre>` : `<h3>Failure</h3><p class="kpi-note">No failure recorded for this run.</p>`}
      <h3>Artifacts</h3>
      <pre>${esc(`playwright-report/index.html\n${r.id}/logs.txt\n${r.id}/trace.zip`)}</pre>`;
    $("#drawer").hidden = false;
    renderRunsTable(visible());
  }
  const closeDrawer = () => {
    state.selected = null;
    $("#drawer").hidden = true;
    renderRunsTable(visible());
  };

  // ---------- navigation ----------
  const TITLES = {
    overview: ["Overview", "Quality signals across every project at a glance."],
    runs: ["Runs", "Every execution with duration, mode and report link."],
    failures: ["Failures", "Triage what broke and open the failing run."],
    projects: ["Projects", "Per-project health, volume and last activity."],
  };
  function showView(view) {
    state.view = view;
    document.querySelectorAll(".view").forEach((el) => (el.hidden = el.id !== `view-${view}`));
    document.querySelectorAll(".nav-item").forEach((el) => {
      const on = el.dataset.view === view;
      on ? el.setAttribute("aria-current", "page") : el.removeAttribute("aria-current");
    });
    $("#viewTitle").textContent = TITLES[view][0];
    $("#viewSub").textContent = TITLES[view][1];
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav) return showView(nav.dataset.view);

    const chip = e.target.closest("[data-status]");
    if (chip) {
      state.status = chip.dataset.status;
      document.querySelectorAll("#statusChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
      return renderRunsTable(visible());
    }

    const run = e.target.closest("[data-run]");
    if (run) return openDrawer(run.dataset.run);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-run]")) {
      e.preventDefault();
      openDrawer(e.target.dataset.run);
    }
  });

  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#projectFilter").addEventListener("change", (e) => {
    state.project = e.target.value;
    render();
  });
  $("#rangeFilter").addEventListener("change", (e) => {
    state.range = Number(e.target.value);
    render();
  });
  $("#newRun").addEventListener("click", () => {
    $("#newRun").textContent = "Run queued (mock)";
    setTimeout(() => ($("#newRun").textContent = "New run"), 1600);
  });

  const shell = $(".shell");
  const menuBtn = $("#menuBtn");
  if (window.innerWidth < 860) shell.classList.add("nav-off");
  menuBtn.setAttribute("aria-expanded", String(!shell.classList.contains("nav-off")));
  menuBtn.addEventListener("click", () => {
    shell.classList.toggle("nav-off");
    menuBtn.setAttribute("aria-expanded", String(!shell.classList.contains("nav-off")));
  });

  // ---------- theme ----------
  const themeBtn = $("#themeBtn");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const applyTheme = (dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeBtn.textContent = dark ? "☀" : "☾";
    themeBtn.setAttribute("aria-pressed", String(dark));
    themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  };
  const saved = store.get("qa-theme");
  applyTheme(saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  themeBtn.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    applyTheme(dark);
    store.set("qa-theme", dark ? "dark" : "light");
  });

  render();
})();
