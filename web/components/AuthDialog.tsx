"use client";
/** Sign-in and registration dialog backed by the SQLite account store */

import { useEffect, useState } from 'react';
import type { User } from '../lib/types';
import * as api from '../lib/api';
import Dialog from './Dialog';

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (user: User) => void;
}

type Mode = 'login' | 'register';

export default function AuthDialog({ open, onClose, onAuthenticated }: AuthDialogProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirm('');
    setError('');
  }, [open]);

  function switchMode(next: Mode) {
    setMode(next);
    setPassword('');
    setConfirm('');
    setError('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const result = mode === 'register'
        ? await api.register(name.trim(), email.trim(), password)
        : await api.login(email.trim(), password);
      if (!result.user) throw new Error('The server did not return an account.');
      onAuthenticated(result.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'register' ? 'Create account' : 'Sign in'}
      id="auth-dialog"
    >
      <div className="actions auth-tabs" role="group" aria-label="Account action">
        <button type="button" aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>
          Sign in
        </button>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => switchMode('register')}>
          Create account
        </button>
      </div>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <label>
            Name
            <input
              required
              maxLength={100}
              autoComplete="name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </label>
        )}
        <label>
          Email
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            minLength={8}
            maxLength={200}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
        {mode === 'register' && (
          <label>
            Confirm password
            <input
              required
              type="password"
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
            />
          </label>
        )}
        {mode === 'register' && (
          <p className="auth-hint">
            The first registered account becomes the administrator. Later accounts join as members.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
