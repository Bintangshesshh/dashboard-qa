"use client";
/** Suite create/edit form inside Dialog */

import { useState } from 'react';
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
  const [name, setName] = useState(initial?.name || '');
  const [targetUrl, setTargetUrl] = useState(initial?.targetUrl || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId || '');

  // Reset form when dialog opens with new initial values
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setName(initial?.name || '');
    setTargetUrl(initial?.targetUrl || '');
    setDescription(initial?.description || '');
    setCategoryId(initial?.categoryId || '');
  }

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
          <input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} />
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
