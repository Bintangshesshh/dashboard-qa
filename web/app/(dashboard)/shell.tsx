"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type User } from "../../lib/playbook";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/playwright", label: "Playwright" },
  { href: "/lighthouse", label: "Lighthouse" },
  { href: "/reports", label: "Reports" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => router.replace("/login?next=" + encodeURIComponent(path)));
  }, [path, router]);

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
        <nav className="pb-nav">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} data-active={path === item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="pb-side-foot">
          {user && <span className="pb-user">{user.username} · {user.role}</span>}
          <button className="pb-btn sm" onClick={logout}>Logout</button>
        </div>
      </aside>
      <main className="pb-main">{children}</main>
    </div>
  );
}
