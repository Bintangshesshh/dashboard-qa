"use client";
/** Dashboard header with navigation, account status and session controls */

import type { User, ViewId } from '../lib/types';

interface AppHeaderProps {
  view: ViewId;
  setView: (v: ViewId) => void;
  collapsed: boolean;
  setCollapsed: (fn: (v: boolean) => boolean) => void;
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

const NAV_ITEMS: [ViewId, string][] = [
  ['workspace', 'Playwright'],
  ['lighthouse', 'Lighthouse'],
  ['history', 'Reports'],
];

export default function AppHeader({
  view, setView, collapsed, setCollapsed, user, onSignIn, onSignOut,
}: AppHeaderProps) {
  const items = user?.role === 'admin'
    ? [...NAV_ITEMS, ['users', 'Users'] as [ViewId, string]]
    : NAV_ITEMS;

  return (
    <header>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <button
        aria-label="Toggle sidebar"
        aria-expanded={!collapsed}
        aria-controls="sidebar"
        onClick={() => setCollapsed(v => !v)}
      >
        ☰
      </button>
      <strong>QA workbench</strong>
      <nav aria-label="Main navigation">
        {items.map(([id, label]) => (
          <button
            key={id}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <span>
        {user
          ? `${user.name} · ${user.role === 'admin' ? 'Administrator' : 'Member'}`
          : 'Signed out'}
      </span>
      {user ? (
        <button onClick={onSignOut}>Sign out</button>
      ) : (
        <button onClick={onSignIn}>Sign in</button>
      )}
    </header>
  );
}
