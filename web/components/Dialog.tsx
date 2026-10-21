"use client";
/** Accessible dialog with focus trap, Escape close, and restore focus */

import { useEffect, useRef, useCallback, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  id?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Dialog({ open, onClose, title, children, id }: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Capture the element that opened the dialog
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
    }
  }, [open]);

  // Focus first focusable element when dialog opens
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const first = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE);
    if (first) first.focus();
    else dialogRef.current.focus();
  }, [open]);

  // Restore focus when dialog closes
  useEffect(() => {
    if (!open && triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Set aria-hidden on siblings
  useEffect(() => {
    if (!open) return;
    const siblings: Element[] = [];
    for (const el of document.body.children) {
      if (el === dialogRef.current?.parentElement && !el.getAttribute('aria-hidden')) continue;
      if (!el.getAttribute('aria-hidden')) {
        el.setAttribute('aria-hidden', 'true');
        siblings.push(el);
      }
    }
    return () => {
      for (const el of siblings) el.removeAttribute('aria-hidden');
    };
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onClose]);

  if (!open) return null;

  const dialogId = id || 'dialog';
  const titleId = dialogId + '-title';

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </div>
  );
}
