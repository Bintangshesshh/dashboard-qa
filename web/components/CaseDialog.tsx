"use client";
/** Case create/edit form inside Dialog */

import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog';

interface CaseDialogProps {
  open: boolean;
  onClose: () => void;
  editing: boolean;
  initial?: { name: string };
  onSave: (data: { name: string }) => Promise<void>;
  busy: boolean;
  error: string;
}

export default function CaseDialog({ open, onClose, editing, initial, onSave, busy, error }: CaseDialogProps) {
  const initialName = initial?.name ?? '';
  const [name, setName] = useState(initialName);

  // Do not reset on every parent render; the workspace polls runs every 4s.
  const lastInitialName = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastInitialName.current = null;
      return;
    }
    if (lastInitialName.current === initialName) return;
    lastInitialName.current = initialName;
    setName(initialName);
  }, [open, initialName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name: name.trim() });
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit case' : 'New test case'} id="case-dialog">
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input required maxLength={200} value={name} onChange={e => setName(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} type="submit">
            {editing ? 'Save changes' : 'Create case'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
