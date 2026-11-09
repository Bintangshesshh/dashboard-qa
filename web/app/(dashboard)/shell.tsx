"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import "./shell.css";
import { api, ApiError, type Project, type User } from "../../lib/playbook";
import { confirmAction, showLogoutConfirm, showSuccessToast } from "../../lib/alerts";
import { readLastProject, readLastEnv } from "../../lib/playbook";

const NAV = [
  { href: "/", label: "Ringkasan", icon: "home" },
  { href: "/playwright", label: "Playwright", icon: "pw" },
  { href: "/lighthouse", label: "Lighthouse", icon: "lh" },
  { href: "/reports", label: "Laporan", icon: "reports" },
];
// Menu admin (role admin saja).
const ADMIN_NAV: { href: string; label: string; icon: string }[] = [{ href: "/settings", label: "Pengaturan", icon: "settings" }];

function NavIcon({ name, className = "" }: { name: string; className?: string }) {
  const icons: Record<string, ReactElement> = {
    home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>,
    playwright: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6M9 15h4" /></svg>,
    lighthouse: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /><circle cx="12" cy="12" r="3" /></svg>,
    reports: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
    settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  };
  return icons[name] || <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true"><circle cx="12" cy="12" r="10" /></svg>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDrawerOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      menuRef.current?.focus();
    };
  }, [drawerOpen]);

  useEffect(() => { setDrawerOpen(false); }, [path]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const close = () => { if (media.matches) setDrawerOpen(false); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  // PRD §10.8: backend mati → banner, halaman tetap dirender.
  const [down, setDown] = useState(false);
  // Breadcrumb butuh nama project + label sesi.
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionInfo, setSessionInfo] = useState<{ label: string; projectId: string } | null>(null);

  const ping = useCallback(async () => {
    try {
      const u = await api.me();
      setUser(u); setDown(false);
      return true;
    } catch (e) {
      if (!(e instanceof ApiError)) setDown(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void ping(); }, [ping, path]);

  // Project arsip tetap perlu namanya untuk breadcrumb.
  useEffect(() => { api.projects({ all: true }).then(setProjects).catch(() => { }); }, []);

  const seg = path.split("/").filter(Boolean);
  const isSession = seg[0] === "reports" && seg[1] && seg[1] !== "project";
  useEffect(() => {
    if (!isSession) { setSessionInfo(null); return; }
    let live = true;
    api.session(seg[1])
      .then(s => { if (live) setSessionInfo({ label: s.label, projectId: s.project_id }); })
      .catch(() => { });
    return () => { live = false; };
  }, [isSession, seg[1]]);

  const logout = async () => {
    if (!(await showLogoutConfirm())) return;
    await api.logout().catch(() => { });
    showSuccessToast("Logout berhasil.");
    router.replace("/login");
  };

  const retryPing = async () => {
    if (!(await confirmAction({
      icon: "question",
      title: "Coba lagi?",
      text: "Periksa koneksi ke backend.",
      confirmButtonText: "Ya, Coba",
    }))) return;
    if (await ping()) showSuccessToast("Backend tersambung kembali.");
  };

  // Prefix terpanjang: sub-halaman (/reports/<id>) tetap dapat label induk.
  const isActive = (href: string) => href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  const screen = [...NAV, ...(user?.role === "admin" ? ADMIN_NAV : [])]
    .filter(i => isActive(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? "Ringkasan";

  // Tiap level breadcrumb bisa diklik; level terakhir tebal.
  const crumbs: { label: string; href: string }[] = [{ label: "Playbook", href: "/" }];
  if (seg[0] === "reports") {
    crumbs.push({ label: "Laporan", href: "/reports" });
    if (seg[1] === "project" && seg[2]) {
      const p = projects.find(x => x.id === seg[2]);
      crumbs.push({ label: p?.name ?? "Project", href: `/reports/project/${seg[2]}` });
    } else if (seg[1]) {
      const p = projects.find(x => x.id === sessionInfo?.projectId);
      if (p) crumbs.push({ label: p.name, href: `/reports/project/${p.id}` });
      crumbs.push({ label: sessionInfo?.label ?? "Sesi", href: path });
    }
  } else if (seg[0]) {
    crumbs.push({ label: screen, href: "/" + seg[0] });
  }

  // Last project/env untuk metadata sidebar
  const lastProjectId = readLastProject();
  const lastEnv = readLastEnv();
  const activeProject = projects.find(p => p.id === lastProjectId);
  const activeEnv = lastEnv || "local";

  const navItem = (item: { href: string; label: string; icon: string }) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={`pb-nav-btn ${isActive(item.href) ? "active" : ""}`}
      data-label={item.label}
    >
      {item.icon === "pw" || item.icon === "lh"
        ? <img src={`/tools/${item.icon === "pw" ? "playwright" : "lighthouse"}.png`} className="pb-nav-icon" alt="" />
        : <NavIcon name={item.icon} className="pb-nav-icon" />}
      <span>{item.label}</span>
    </Link>
  );

  return (
    <div className={`pb-shell ${collapsed ? "pb-shell-collapsed" : ""} ${drawerOpen ? "pb-drawer-open" : ""}`}>
      {drawerOpen && <div className="pb-drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}
      <aside id="pb-sidebar" ref={drawerRef} className="pb-side" aria-label="Sidebar" {...(drawerOpen ? { role: "dialog", "aria-modal": true } : {})}>
        {/* Header Section - Playbook QA branding + metadata */}
        <div className="pb-side-header">
          <div className="pb-side-brand">
            <div className="pb-brand-text">
              <div className="pb-brand-name">Playbook</div>
              <div className="pb-brand-badge">Eureka Group</div>
            </div>
            <button className="pb-side-toggle pb-collapse-toggle" type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"} aria-expanded={!collapsed} aria-controls="pb-sidebar">{collapsed ? "›" : "‹"}</button>
            <button className="pb-side-toggle pb-drawer-close" type="button" onClick={() => setDrawerOpen(false)} aria-label="Tutup menu">×</button>
          </div>
          {activeProject && (
            <div className="pb-side-meta">
              <div><span className="pb-meta-label">Target: </span><span className="pb-meta-value">{activeProject.name}</span></div>
              <div><span className="pb-meta-label">Env: </span><span className="pb-meta-value pb-meta-env">{activeEnv}</span></div>
            </div>
          )}
        </div>


        {/* Navigation Menu */}
        <nav className="pb-side-nav" aria-label="Navigasi utama">
          <div className="pb-nav-section">
            <div className="pb-nav-section-title">Ruang kerja</div>
            {NAV.map(navItem)}
          </div>
          {user?.role === "admin" && (
            <div className="pb-nav-section">
              <div className="pb-nav-section-title">Admin</div>
              {ADMIN_NAV.map(navItem)}
            </div>
          )}
        </nav>

        <button type="button" className="pb-nav-btn pb-logout" onClick={logout} aria-label="Keluar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pb-nav-icon" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6" /></svg>
          <span>Keluar</span>
        </button>
        {/* Footer - User Profile + Theme Switcher */}
        <div className="pb-side-foot">
          {user && (
            <div className="pb-user-card">
              <div className="pb-user-avatar" aria-hidden="true">{user.username[0].toUpperCase()}</div>
              <div className="pb-user-info">
                <strong>{user.username}</strong>
                <span>{user.role}</span>
              </div>
            </div>
          )}
          <ThemePref />
        </div>
      </aside>

      <div className="pb-mainwrap">
        <header className="pb-topbar">
          <button ref={menuRef} className="pb-menu-toggle" type="button" onClick={() => setDrawerOpen(true)} aria-label="Buka menu" aria-expanded={drawerOpen} aria-controls="pb-sidebar">☰</button>
          <div style={{ minWidth: 0 }}>
            <div className="pb-topbar-title">{screen}</div>
            <div className="pb-topbar-sub">Eureka Group - Playbook QA</div>
          </div>
          <div className="pb-topbar-right">
            <div id="pb-topbar-actions" className="pb-topbar-actions" />
            {path !== "/" && (
              <nav className="pb-crumb" aria-label="Breadcrumb">
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <span className="pb-crumb-item" key={c.href + i}>
                      {i > 0 && <span className="pb-crumb-sep" aria-hidden="true">/</span>}
                      {last
                        ? <strong aria-current="page">{c.label}</strong>
                        : <Link href={c.href}>{c.label}</Link>}
                    </span>
                  );
                })}
              </nav>
            )}
          </div>
        </header>

        <main className="pb-main">
          {down && (
            <div className="pb-err" role="alert" style={{ marginBottom: 12 }}>
              Backend tidak tersedia.{" "}
              <button className="pb-btn sm" onClick={retryPing}>Coba lagi</button>
            </div>
          )}
          {loading && !down ? <Skeleton /> : (
            <div key={path} className="pb-page">{children}</div>
          )}
        </main>
      </div>
    </div>
  );
}

// Preferensi tema: sistem / terang / gelap. Toggle ini hanya mengubah data-theme;
// skrip inline di layout.tsx sudah menerapkan tema sebelum paint.
const PREFS = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Terang" },
  { pref: "dark", label: "Gelap" },
] as const;

function applyTheme(pref: string) {
  const dark = pref === "dark" || (pref === "system" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  if (dark) root.dataset.theme = "dark"; else root.removeAttribute("data-theme");
  root.dataset.themePref = pref;
  try { localStorage.setItem("pb-theme", pref); } catch { /* storage diblokir */ }
}

function ThemePref() {
  const [pref, setPref] = useState("system");

  useEffect(() => {
    const saved = localStorage.getItem("pb-theme") || "system";
    setPref(saved);
    applyTheme(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => { if (pref === "system") applyTheme("system"); };
    mq.addEventListener("change", onSystem);
    return () => mq.removeEventListener("change", onSystem);
  }, [pref]);

  return (
    <div className="pb-theme" role="group" aria-label="Preferensi tema">
      {PREFS.map(p => (
        <button
          key={p.pref}
          type="button"
          aria-pressed={pref === p.pref}
          aria-label={p.label}
          onClick={() => { setPref(p.pref); applyTheme(p.pref); }}
        >
          <span className="pb-theme-label">{p.label}</span><span className="pb-theme-icon" aria-hidden="true">{p.pref === "system" ? "◐" : p.pref === "light" ? "☀" : "☾"}</span>
        </button>
      ))}
    </div>
  );
}

// Skeleton sederhana: PRD §10.8 minta bukan layar kosong.
function Skeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="pb-skel" style={{ width: 220, height: 28, marginBottom: 16 }} />
      <div className="pb-grid kpi" style={{ marginBottom: 18 }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="pb-skel" style={{ height: 132 }} />)}
      </div>
      <div className="pb-skel" style={{ height: 180 }} />
    </div>
  );
}
