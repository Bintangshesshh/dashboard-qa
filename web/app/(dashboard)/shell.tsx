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
const ADMIN_NAV = [{ href: "/settings", label: "Pengaturan" }];

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

  return (
    <div className="pb-shell">
      <aside className="pb-side">
        <div className="pb-brand">
          <strong>Playbook</strong>
          <span>Eureka Group</span>
        </div>
        <nav className="pb-nav" aria-label="Navigasi utama">
          {[...NAV, ...(user?.role === "admin" ? ADMIN_NAV : [])].map(item => (
            <Link key={item.href} href={item.href} aria-current={path === item.href ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="pb-side-foot">
          {user && <span className="pb-user">{user.username} · {user.role}</span>}
          <button className="pb-btn sm" onClick={logout}>Logout</button>
        </div>
      </aside>
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
  );
}

// Skeleton sederhana: PRD §10.8 minta bukan layar kosong.
function Skeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="pb-skel" style={{ width: 220, height: 28, marginBottom: 16 }} />
      <div className="pb-grid kpi" style={{ marginBottom: 18 }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="pb-skel" style={{ height: 86 }} />)}
      </div>
      <div className="pb-skel" style={{ height: 180 }} />
    </div>
  );
}
