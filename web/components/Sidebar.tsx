"use client";
/** Sidebar with category → suite → case tree navigation */

import type { Category, Suite, Case } from '../lib/types';

interface SidebarProps {
  collapsed: boolean;
  authenticated: boolean;
  categories: Category[];
  suites: Suite[];
  selectedSuiteId: string;
  selectedCaseId: string;
  query: string;
  setQuery: (q: string) => void;
  open: Record<string, boolean>;
  setOpen: (fn: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  onChoose: (suite: Suite, c?: Case) => void;
  onNewSuite: () => void;
  onNewCategory: () => void;
  onEditCategory: (cat: Category) => void;
  onDeleteCategory: (cat: Category) => void;
}

export default function Sidebar({
  collapsed, authenticated, categories, suites,
  selectedSuiteId, selectedCaseId, query, setQuery,
  open, setOpen, onChoose, onNewSuite, onNewCategory,
  onEditCategory, onDeleteCategory,
}: SidebarProps) {
  const filtered = suites.filter(s =>
    s.name.toLowerCase().includes(query.toLowerCase()) ||
    s.cases.some(c => c.name.toLowerCase().includes(query.toLowerCase()))
  );

  // Group suites by categoryId
  const catMap = new Map<string, Category>();
  for (const cat of categories) catMap.set(cat.id, cat);

  const grouped = new Map<string, Suite[]>();
  for (const s of filtered) {
    const key = s.categoryId || '__uncategorized__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  // Keep empty categories visible so a newly created category does not
  // disappear. While searching, only show categories that have matches.
  const searching = query.trim().length > 0;
  const orderedKeys: string[] = [];
  for (const cat of categories) {
    if (!searching || grouped.has(cat.id)) orderedKeys.push(cat.id);
  }
  if (grouped.has('__uncategorized__')) orderedKeys.push('__uncategorized__');

  const renderSuiteTree = (s: Suite) => (
    <details
      key={s.id}
      open={open[s.id] ?? true}
      onToggle={e => {
        const expanded = e.currentTarget.open;
        setOpen(o => o[s.id] === expanded ? o : { ...o, [s.id]: expanded });
      }}
    >
      <summary>{s.name}</summary>
      <button
        className={'suite ' + (selectedSuiteId === s.id ? 'selected' : '')}
        onClick={() => onChoose(s)}
      >
        {s.name}
        <small>{s.cases.length} cases</small>
      </button>
      {s.cases.map(c => (
        <button
          key={c.id}
          className={'tree-case ' + (selectedCaseId === c.id ? 'selected' : '')}
          onClick={() => onChoose(s, c)}
        >
          {c.name}
        </button>
      ))}
    </details>
  );

  return (
    <aside
      id="sidebar"
      hidden={collapsed}
      aria-label="Suite navigation"
    >
      <div className="section-title">
        <h2>Suites</h2>
        <div className="actions">
          <button disabled={!authenticated} onClick={onNewCategory}>New category</button>
          <button disabled={!authenticated} onClick={onNewSuite}>New suite</button>
        </div>
      </div>
      <input
        aria-label="Search suites"
        placeholder="Search suites"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      {orderedKeys.length > 0 ? orderedKeys.map(key => {
        const suitesInGroup = grouped.get(key) || [];
        if (key === '__uncategorized__') {
          return (
            <div key="__uncategorized__" className="category-group">
              <div className="category-header">
                <span className="category-name">Uncategorized</span>
              </div>
              {suitesInGroup.map(renderSuiteTree)}
            </div>
          );
        }
        const cat = catMap.get(key);
        if (!cat) return null;
        return (
          <div key={key} className="category-group">
            <div className="category-header">
              <span className="category-name">{cat.name}</span>
              <div className="category-actions">
                <button className="inline-btn" onClick={() => onEditCategory(cat)} title="Edit category">✏️</button>
                <button className="inline-btn" onClick={() => onDeleteCategory(cat)} title="Delete category">🗑️</button>
              </div>
            </div>
            {suitesInGroup.map(renderSuiteTree)}
            {suitesInGroup.length === 0 && <p className="muted">No suites in this category.</p>}
          </div>
        );
      }) : (
        // No categories yet — flat list like before
        filtered.map(renderSuiteTree)
      )}

      {!suites.length && (
        <p className="muted">
          {authenticated ? 'No suites. Create a target suite to begin.' : 'Connect to load suites.'}
        </p>
      )}
    </aside>
  );
}
