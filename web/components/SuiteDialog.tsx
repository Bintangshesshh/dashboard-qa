"use client";
/** Suite create/edit form inside Dialog */

import { useEffect, useRef, useState } from 'react';
import type { Category } from '../lib/types';
import Dialog from './Dialog';

interface SuiteDialogProps {
  open: boolean;
  onClose: () => void;
  editing: boolean;
  categories: Category[];
  initial?: { name: string; targetUrl: string; description: string; categoryId: string | null };
  onSave: (data: { name: string; targetUrl: string; description: string; categoryId: string | null }) => Promise<void>;
  busy: boolean;
  error: string;
}

export default function SuiteDialog({ open, onClose, editing, categories, initial, onSave, busy, error }: SuiteDialogProps) {
  const initialName = initial?.name ?? '';
  const initialTargetUrl = initial?.targetUrl ?? '';
  const initialDescription = initial?.description ?? '';
  const initialCategoryId = initial?.categoryId ?? '';

  const [name, setName] = useState(initialName);
  const [targetUrl, setTargetUrl] = useState(initialTargetUrl);
  const [description, setDescription] = useState(initialDescription);
  const [categoryId, setCategoryId] = useState(initialCategoryId);

  // Reset only when the dialog opens or its actual initial values change.
  // The parent re-renders every few seconds to poll runs; comparing object
  // identity here would wipe out whatever the user is typing.
  const initialKey = JSON.stringify([initialName, initialTargetUrl, initialDescription, initialCategoryId]);
  const lastInitialKey = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastInitialKey.current = null;
      return;
    }
    if (lastInitialKey.current === initialKey) return;
    lastInitialKey.current = initialKey;
    setName(initialName);
    setTargetUrl(initialTargetUrl);
    setDescription(initialDescription);
    setCategoryId(initialCategoryId);
  }, [open, initialKey, initialName, initialTargetUrl, initialDescription, initialCategoryId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name.trim(),
      targetUrl,
      description,
      categoryId: categoryId || null,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? 'Edit suite' : 'New suite'} id="suite-dialog">
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input required maxLength={200} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          Target URL
          <input required type="url" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} />
        </label>
        <label>
          Description (optional)
          <input maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
        </label>
        {categories.length > 0 && (
          <label>
            Category
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p role="alert" aria-describedby="suite-dialog-title">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} type="submit">
            {editing ? 'Save changes' : 'Create suite'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
