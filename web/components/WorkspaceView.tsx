"use client";
/** Workspace view — Playwright test cases and run controls */

import type { Suite, Case } from '../lib/types';
import CaseEditor from './CaseEditor';

interface WorkspaceViewProps {
  suite: Suite | undefined;
  selectedCaseId: string;
  code: string;
  setCode: (code: string) => void;
  dirty: boolean;
  busy: boolean;
  authenticated: boolean;
  running: boolean;
  scope: string;
  setScope: (s: string) => void;
  headed: boolean;
  setHeaded: (h: boolean) => void;
  onRun: (mode: string) => void;
  onNewCase: () => void;
  onChoose: (suite: Suite, c?: Case) => void;
  onEditCase: () => void;
  onDeleteCase: () => void;
  onSaveCode: () => void;
  onToggleEnabled: (c: Case) => void;
}

export default function WorkspaceView({
  suite, selectedCaseId, code, setCode, dirty, busy,
  authenticated, running, scope, setScope, headed, setHeaded,
  onRun, onNewCase, onChoose, onEditCase, onDeleteCase, onSaveCode,
  onToggleEnabled,
}: WorkspaceViewProps) {
  const selected = suite?.cases.find(c => c.id === selectedCaseId);

  return (
    <>
      <div className="toolbar">
        <label>
          Test selection
          <select aria-label="Test selection" value={scope} onChange={e => setScope(e.target.value)}>
            <option value="suite">All enabled cases</option>
            <option value="case" disabled={!selected}>Selected case</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={headed} onChange={e => setHeaded(e.target.checked)} />
          {' '}Headed browser
        </label>
        <button className="primary" disabled={!authenticated || !suite || busy || running} onClick={() => onRun('pw')}>
          Run Playwright
        </button>
        <button className="primary" disabled={!authenticated || !suite || busy || running} onClick={() => onRun('both')}>
          Run both
        </button>
      </div>
      <div className="cases">
        <div className="section-title">
          <h2>Test cases</h2>
          <button disabled={!suite} onClick={onNewCase}>New test case</button>
        </div>
        <table>
          <thead>
            <tr><th>Case</th><th>Enabled</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {suite?.cases.map(c => (
              <tr key={c.id} className={selectedCaseId === c.id ? 'selected' : ''}>
                <td>
                  <button onClick={() => onChoose(suite, c)}>{c.name}</button>
                </td>
                <td>
                  <input
                    aria-label={'Enable ' + c.name}
                    type="checkbox"
                    checked={c.enabled}
                    onChange={() => onToggleEnabled(c)}
                  />
                </td>
                <td>
                  {selectedCaseId === c.id && (
                    <>
                      <button onClick={onEditCase}>Rename</button>
                      <button onClick={onDeleteCase}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!suite?.cases.length && (
          <p>No test cases. Add a case for Playwright, or use Lighthouse without cases.</p>
        )}
      </div>
      {selected && (
        <CaseEditor
          selected={selected}
          code={code}
          setCode={setCode}
          dirty={dirty}
          busy={busy}
          onSave={onSaveCode}
        />
      )}
    </>
  );
}
