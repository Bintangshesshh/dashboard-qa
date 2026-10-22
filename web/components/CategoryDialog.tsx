"use client";
/** Category create/edit form inside Dialog */

import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog';

interface CategoryDialogProps {
  open: boolean;
  onClose: () => void;
  editing: boolean;
  initial?: { name: string; description: string };
  onSave: (data: { name: string; description: string }) => Promise<void>;
  busy: boolean;
  error: string;
}

export default function CategoryDialog({ open, onClose, editing, initial, onSave, busy, error }: CategoryDialogProps) {
  const initialName = initial?.name ?? '';
  const initialDescription = initial?.description ?? '';

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  const initialKey = JSON.stringify([initialName, initialDescription]);
  const lastInitialKey = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastInitialKey.current = null;
      return;
    }
    if (lastInitialKey.current === initialKey) return;
    lastInitialKey.current = initialKey;
    setName(initialName);
    setDescription(initialDescription);
  }, [open, initialKey, initialName, initialDescription]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name: name.trim(), description });
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit category' : 'New category'} id="category-dialog">
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input required maxLength={200} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          Description (optional)
          <input maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} type="submit">
            {editing ? 'Save changes' : 'Create category'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
