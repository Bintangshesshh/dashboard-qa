"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type User } from "../../lib/playbook";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/playwright", label: "Playwright" },
  { href: "/lighthouse", label: "Lighthouse" },
  { href: "/reports", label: "Reports" },
];
// ponytail: menu Pengaturan disembunyikan untuk demo. Halaman /settings tetap ada,
// buka langsung lewat URL kalau perlu. Kembalikan kalau admin panel dipakai lagi.
const ADMIN_NAV: { href: string; label: string }[] = [];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // PRD §10.8: backend mati → banner, halaman tetap dirender.
  const [down, setDown] = useState(false);

  const ping = useCallback(() => {
    setLoading(true);
    api.me()
      .then(u => { setUser(u); setDown(false); })
      .catch(e => { if (!(e instanceof ApiError)) setDown(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(ping, [ping, path]);

  const logout = async () => {
    await api.logout().catch(() => {});
    router.replace("/login");
  };

  const all = [...NAV, ...(user?.role === "admin" ? ADMIN_NAV : [])];
  const screen = all.find(i => i.href === path)?.label ?? "Overview";

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
            <Link key={item.href} href={item.href} aria-current={path === item.href ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
          {user?.role === "admin" && (
            <>
              <div className="pb-nav-label pb-nav-label-gap">Admin</div>
              {ADMIN_NAV.map(item => (
                <Link key={item.href} href={item.href} aria-current={path === item.href ? "page" : undefined}>
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
          <div className="pb-crumb">
            <span>Playbook</span>
            <span aria-hidden="true">/</span>
            <strong>{screen}</strong>
          </div>
        </header>

        <main className="pb-main">
          {down && (
            <div className="pb-err" role="alert" style={{ marginBottom: 12 }}>
              Backend tidak tersedia.{" "}
              <button className="pb-btn sm" onClick={ping}>Coba lagi</button>
            </div>
          )}
          {loading && !down ? <Skeleton /> : children}
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
