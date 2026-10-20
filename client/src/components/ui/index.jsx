import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X, Loader2, Inbox, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useUI } from '../../store/ui';

export function Spinner({ className = 'h-5 w-5' }) {
  return <Loader2 className={clsx('animate-spin text-brand-600', className)} />;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500"><Spinner /> {label}</div>;
}

export function Empty({ title = 'Nothing here yet', hint, icon: Icon = Inbox, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="rounded-full bg-ink-100 p-3 text-ink-400 dark:bg-ink-800"><Icon className="h-6 w-6" /></div>
      <div className="text-sm font-semibold text-ink-700 dark:text-ink-200">{title}</div>
      {hint && <div className="max-w-sm text-xs text-ink-500">{hint}</div>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md', closeOnBackdrop = true, initialFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => {
      const el = initialFocus ? ref.current?.querySelector(initialFocus) : ref.current?.querySelector('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button.btn-primary');
      el?.focus();
      el?.select?.();
    }, 30);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[96vw]' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 pt-[6vh] backdrop-blur-[2px]" onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} role="dialog" aria-modal="true" className={clsx('w-full rounded-2xl bg-white shadow-2xl ring-1 ring-ink-200 dark:bg-ink-900 dark:ring-ink-800', widths[size])}>
        {title && (
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5 dark:border-ink-800">
            <h3 className="text-base font-semibold text-ink-900 dark:text-white">{title}</h3>
            <button type="button" className="btn-ghost -mr-2 p-1.5" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-800 dark:bg-ink-900/60">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Rendered once in the layout; driven by `confirm()` from store/ui. */
export function ConfirmHost() {
  const state = useUI((s) => s.confirmState);
  const close = useUI((s) => s.closeConfirm);
  const [text, setText] = useState('');
  useEffect(() => setText(state?.defaultValue || ''), [state]);
  if (!state) return null;
  const submit = () => {
    if (state.input && state.inputRequired !== false && !text.trim()) return;
    close(state.input ? text.trim() : true);
  };
  return (
    <Modal open onClose={() => close(false)} title={state.title || 'Are you sure?'} size="sm"
      footer={<>
        <button type="button" className="btn-secondary" onClick={() => close(false)}>Cancel</button>
        <button type="button" className={state.danger ? 'btn-danger' : 'btn-primary'} onClick={submit} data-autofocus={!state.input || undefined}>{state.confirmText || 'Confirm'}</button>
      </>}>
      <div className="flex gap-3">
        {state.danger && <div className="h-fit rounded-full bg-rose-100 p-2 text-rose-600 dark:bg-rose-500/15"><AlertTriangle className="h-5 w-5" /></div>}
        <div className="flex-1 space-y-3">
          {state.message && <p className="text-sm text-ink-600 dark:text-ink-300">{state.message}</p>}
          {state.input && (
            <input className="input" placeholder={state.placeholder || ''} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} data-autofocus />
          )}
        </div>
      </div>
    </Modal>
  );
}

export function Field({ label, error, hint, children, className, required }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="label">{label}{required && <span className="text-rose-500"> *</span>}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function Input({ label, error, hint, className, required, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} className={className} required={required}>
      <input className={clsx('input', error && 'input-error')} {...props} />
    </Field>
  );
}

export function Select({ label, error, hint, className, options = [], placeholder, required, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} className={className} required={required}>
      <select className={clsx('input', error && 'input-error')} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </Field>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700')}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span><span className="block text-sm font-medium text-ink-800 dark:text-ink-200">{label}</span>{hint && <span className="block text-xs text-ink-500">{hint}</span>}</span>
    </label>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200 dark:border-ink-800">
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)}
          className={clsx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition', value === t.value ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-ink-500 hover:text-ink-800 dark:hover:text-ink-200')}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 text-[10px] dark:bg-ink-800">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }) {
  if (!total) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs text-ink-500">
      <span>{total.toLocaleString('en-IN')} records</span>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2">Page {page} of {pages || 1}</span>
        <button type="button" className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

const STATUS = {
  completed: 'badge-green', received: 'badge-green', active: 'badge-green', paid: 'badge-green', open: 'badge-blue', in: 'badge-green',
  draft: 'badge-gray', sent: 'badge-blue', partial: 'badge-amber', low: 'badge-amber', unpaid: 'badge-red', out: 'badge-red',
  cancelled: 'badge-red', inactive: 'badge-gray', closed: 'badge-gray', full: 'badge-amber', exchange: 'badge-brand', return: 'badge-amber',
};
export function StatusBadge({ status, label }) {
  return <span className={STATUS[status] || 'badge-gray'}>{label || String(status || '').replace(/_/g, ' ')}</span>;
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}
