"use client";
/** Test case code editor with save indicator */

import type { Case } from '../lib/types';

interface CaseEditorProps {
  selected: Case;
  code: string;
  setCode: (code: string) => void;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
}

export default function CaseEditor({ selected, code, setCode, dirty, busy, onSave }: CaseEditorProps) {
  return (
    <>
      <div className="section-title">
        <h2>{selected.name}</h2>
        <button disabled={!dirty || busy} onClick={onSave}>Save changes</button>
      </div>
      <textarea
        className="code-editor"
        aria-label="Test case code editor"
        spellCheck={false}
        value={code}
        onChange={e => setCode(e.target.value)}
      />
      <small>{dirty ? 'Unsaved changes' : 'Saved'}</small>
    </>
  );
}
