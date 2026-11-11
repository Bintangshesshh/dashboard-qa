"use client";

import type { ReactNode } from "react";

export function SettingsLayout({ children, tabs, activeTab, onSelect }: {
  children: ReactNode;
  tabs: { id: string; label: string }[];
  activeTab: string;
  onSelect: (id: string) => void;
}) {
  return <div className="settings-layout">
    <div className="pb-tabs pb-set-tabbar" role="tablist" aria-label="Bagian pengaturan">
      {tabs.map(tab => <button key={tab.id} role="tab" aria-selected={activeTab === tab.id}
        className={`pb-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => onSelect(tab.id)}>{tab.label}</button>)}
    </div>
    <div className="pb-set-tab-body">{children}</div>
  </div>;
}
