"use client";
/** Lighthouse audit view */

import type { Suite } from '../lib/types';

interface LighthouseViewProps {
  suites: Suite[];
  selectedSuiteId: string;
  suite: Suite | undefined;
  authenticated: boolean;
  busy: boolean;
  running: boolean;
  onChangeSuite: (id: string) => void;
  onRun: () => void;
}

export default function LighthouseView({
  suites, selectedSuiteId, suite,
  authenticated, busy, running,
  onChangeSuite, onRun,
}: LighthouseViewProps) {
  return (
    <section className="audit">
      <h2>Run Lighthouse audit</h2>
      <p>Audit target URL for performance, accessibility, best practices and SEO. No test case required.</p>
      <label>
        Target suite
        <select aria-label="Lighthouse target suite" value={selectedSuiteId} onChange={e => onChangeSuite(e.target.value)}>
          {suites.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <p><code>{suite?.targetUrl || 'Create a suite with a target URL.'}</code></p>
      <button className="primary" disabled={!authenticated || !suite || busy || running} onClick={onRun}>
        Run Lighthouse
      </button>
      <p className="muted">Lighthouse-only runs do not execute Playwright cases.</p>
    </section>
  );
}
