"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Project, type User } from "../../lib/playbook";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/playwright", label: "Playwright" },
  { href: "/lighthouse", label: "Lighthouse" },
  { href: "/reports", label: "Reports" },
];
// Menu admin: hanya muncul untuk role admin (lihat `all` di bawah).
const ADMIN_NAV: { href: string; label: string }[] = [{ href: "/settings", label: "Pengaturan" }];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // PRD §10.8: backend mati → banner, halaman tetap dirender.
  const [down, setDown] = useState(false);
  // Breadcrumb berlayer butuh nama project + label sesi.
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionInfo, setSessionInfo] = useState<{ label: string; projectId: string } | null>(null);

  const ping = useCallback(() => {
    api.me()
      .then(u => { setUser(u); setDown(false); })
      .catch(e => { if (!(e instanceof ApiError)) setDown(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(ping, [ping, path]);

  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);

  const seg = path.split("/").filter(Boolean);
  const isSession = seg[0] === "reports" && seg[1] && seg[1] !== "project";
  useEffect(() => {
    if (!isSession) { setSessionInfo(null); return; }
    let live = true;
    api.session(seg[1])
      .then(s => { if (live) setSessionInfo({ label: s.label, projectId: s.project_id }); })
      .catch(() => {});
    return () => { live = false; };
  }, [isSession, seg[1]]);

  const logout = async () => {
    await api.logout().catch(() => {});
    router.replace("/login");
  };

  const all = [...NAV, ...(user?.role === "admin" ? ADMIN_NAV : [])];
  // Cocokkan prefix terpanjang supaya sub-halaman (/reports/<id>) tetap dapat label induk.
  const isActive = (href: string) => href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  const screen = all
    .filter(i => isActive(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? "Overview";

  // Crumb berlayer: tiap level bisa diklik, level terakhir tebal.
  const crumbs: { label: string; href: string }[] = [{ label: "Playbook", href: "/" }];
  if (seg[0] === "reports") {
    crumbs.push({ label: "Reports", href: "/reports" });
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

  return (
    <div className="pb-shell">
      <aside className="pb-side">
        <div className="pb-brand">
          <div>
            <div className="pb-brand-name">Playbook</div>
            <div className="pb-brand-sub">Eureka Group</div>
          </div>
        </div>

        <nav className="pb-nav" aria-label="Navigasi utama">
          <div className="pb-nav-label">Ruang kerja</div>
          {NAV.map(item => (
            <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
          {user?.role === "admin" && (
            <>
              <div className="pb-nav-label pb-nav-label-gap">Admin</div>
              {ADMIN_NAV.map(item => (
                <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        <div className="pb-side-foot">
          {user && (
            <div className="pb-user-row">
              <span className="pb-avatar" aria-hidden="true">{user.username[0].toUpperCase()}</span>
              <span className="pb-user-meta">
                <strong>{user.username}</strong>
                <span>{user.role}</span>
              </span>
            </div>
          )}
          <button className="pb-logout" onClick={logout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" /><path d="M15 8l4 4-4 4M19 12H9" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      <div className="pb-mainwrap">
        <header className="pb-topbar">
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
        </header>

        <main className="pb-main">
          {down && (
            <div className="pb-err" role="alert" style={{ marginBottom: 12 }}>
              Backend tidak tersedia.{" "}
              <button className="pb-btn sm" onClick={ping}>Coba lagi</button>
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
