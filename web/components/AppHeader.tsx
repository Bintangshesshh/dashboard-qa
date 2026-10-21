"use client";
/** Dashboard header with navigation, auth status and toggle */

import type { ViewId } from '../lib/types';

interface AppHeaderProps {
  view: ViewId;
  setView: (v: ViewId) => void;
  collapsed: boolean;
  setCollapsed: (fn: (v: boolean) => boolean) => void;
  authenticated: boolean;
  token: string;
  onConnect: () => void;
  onUnlock: () => void;
  onDisconnect: () => void;
}

const NAV_ITEMS: [ViewId, string][] = [
  ['workspace', 'Playwright'],
  ['lighthouse', 'Lighthouse'],
  ['history', 'Reports'],
];

export default function AppHeader({
  view, setView, collapsed, setCollapsed,
  authenticated, token,
  onConnect, onUnlock, onDisconnect,
}: AppHeaderProps) {
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
        {NAV_ITEMS.map(([id, label]) => (
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
        {authenticated
          ? (token ? 'Operator connected' : 'Read-only session')
          : 'Not connected'}
      </span>
      {authenticated && !token && (
        <button onClick={onUnlock}>Unlock editing</button>
      )}
      {authenticated ? (
        <button onClick={onDisconnect}>Disconnect</button>
      ) : (
        <button onClick={onConnect}>Connect workspace</button>
      )}
    </header>
  );
}
