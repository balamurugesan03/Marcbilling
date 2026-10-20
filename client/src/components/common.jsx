import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Search, ScanBarcode, X, ChevronDown, Calendar } from 'lucide-react';
import { get, errMsg } from '../lib/api';
import { useDebounce } from '../hooks';
import { useAuth } from '../store/auth';
import { Modal, Spinner, Pagination, Loading, Empty } from './ui';
import { inr, variantLabel, monthStart, isoDate } from '../lib/format';

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300"><Icon className="h-5 w-5" /></div>}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, tone = 'brand', hint, onClick }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
    green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    blue: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
  };
  return (
    <div className={clsx('card card-pad flex items-start justify-between gap-3', onClick && 'cursor-pointer transition hover:border-brand-300')} onClick={onClick}>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
        <div className="mt-1.5 truncate text-2xl font-bold tabular-nums text-ink-900 dark:text-white">{value}</div>
        {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      </div>
      {Icon && <div className={clsx('rounded-xl p-2.5', tones[tone])}><Icon className="h-5 w-5" /></div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…', className, autoFocus }) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input className="input pl-8 pr-7" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      {value && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" onClick={() => onChange('')}><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

export function DateRange({ from, to, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <Calendar className="h-4 w-4 text-ink-400" />
      <input type="date" className="input w-[9.5rem]" value={from || ''} onChange={(e) => onChange({ from: e.target.value, to })} />
      <span className="text-xs text-ink-400">to</span>
      <input type="date" className="input w-[9.5rem]" value={to || ''} onChange={(e) => onChange({ from, to: e.target.value })} />
    </div>
  );
}
export const defaultRange = () => ({ from: monthStart(), to: isoDate() });

/**
 * Server-side paginated table.
 * columns: [{ key, label, render?(row), className?, num? }]
 */
export function DataTable({ url, params = {}, columns, rowKey = '_id', onRowClick, empty, reloadKey, toolbar, dense, footer, onData }) {
  const branchId = useAuth((s) => s.branchId);
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, data: null });
  const key = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [key, branchId]);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    get(url, { ...params, page, limit: params.limit || 25 })
      .then((d) => { if (alive) { setState({ loading: false, data: d }); onData?.(d); } })
      .catch((e) => { if (alive) { setState({ loading: false, data: null }); toast.error(errMsg(e)); } });
    return () => { alive = false; };
  }, [url, key, page, branchId, reloadKey]);
  const rows = state.data?.items || [];
  return (
    <div className="card overflow-hidden">
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3 dark:border-ink-800">{toolbar}</div>}
      <div className="table-wrap max-h-[calc(100vh-260px)] min-h-[200px]">
        {state.loading && !state.data ? <Loading /> : !rows.length ? (empty || <Empty />) : (
          <table className={clsx('tbl', dense && '[&_td]:py-1.5')}>
            <thead><tr>{columns.map((c) => <th key={c.key || c.label} className={clsx(c.num && 'num', c.className)}>{c.label}</th>)}</tr></thead>
            <tbody className={clsx(state.loading && 'opacity-50')}>
              {rows.map((r, i) => (
                <tr key={r[rowKey] || i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer' : ''}>
                  {columns.map((c) => <td key={c.key || c.label} className={clsx(c.num && 'num', c.className)}>{c.render ? c.render(r, i) : r[c.key]}</td>)}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot>{footer(state.data)}</tfoot>}
          </table>
        )}
      </div>
      <Pagination page={state.data?.page || 1} pages={state.data?.pages || 1} total={state.data?.total || 0} onPage={setPage} />
    </div>
  );
}

/** Async searchable dropdown (customers, suppliers…). fetcher(q) -> [{value,label,sub}] */
export function AsyncSelect({ value, onChange, fetcher, placeholder = 'Search…', label, displayValue, allowClear = true, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 250);
  const [opts, setOpts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    fetcher(dq).then((o) => { if (alive) { setOpts(o); setHi(0); } }).catch(() => {}).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [dq, open]);
  useEffect(() => {
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const choose = (o) => { onChange(o); setOpen(false); setQ(''); };
  return (
    <div className={clsx('relative', className)} ref={boxRef}>
      {label && <span className="label">{label}</span>}
      <button type="button" className="input flex items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className={clsx('truncate', !value && 'text-ink-400')}>{value ? displayValue : placeholder}</span>
        <span className="flex items-center gap-1">
          {allowClear && value && <X className="h-3.5 w-3.5 text-ink-400 hover:text-ink-700" onClick={(e) => { e.stopPropagation(); onChange(null); }} />}
          <ChevronDown className="h-4 w-4 text-ink-400" />
        </span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[260px] rounded-lg border border-ink-200 bg-white p-1.5 shadow-xl dark:border-ink-700 dark:bg-ink-900">
          <input autoFocus className="input mb-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, opts.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              if (e.key === 'Enter' && opts[hi]) { e.preventDefault(); choose(opts[hi]); }
              if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
            }} />
          <div className="max-h-64 overflow-auto">
            {loading && <div className="p-3"><Spinner className="h-4 w-4" /></div>}
            {!loading && !opts.length && <div className="p-3 text-xs text-ink-500">No results</div>}
            {opts.map((o, i) => (
              <button key={o.value} type="button" onMouseEnter={() => setHi(i)} onClick={() => choose(o)}
                className={clsx('block w-full rounded-md px-2.5 py-1.5 text-left text-sm', i === hi ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200' : 'hover:bg-ink-50 dark:hover:bg-ink-800')}>
                <div className="font-medium">{o.label}</div>{o.sub && <div className="text-xs text-ink-500">{o.sub}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const fetchSuppliers = (q) => get('/suppliers', { search: q, limit: 20, active: 'true' }).then((d) => d.items.map((s) => ({ value: s._id, label: s.name, sub: [s.mobile, s.gstin].filter(Boolean).join(' · '), raw: s })));
export const fetchCustomers = (q) => (q ? get('/customers/search', { q }) : get('/customers', { limit: 15 }).then((d) => d.items))
  .then((list) => list.map((c) => ({ value: c._id, label: `${c.name} · ${c.mobile}`, sub: `${c.code}${c.outstanding ? ` · Due ${inr(c.outstanding)}` : ''}`, raw: c })));

/** Keyboard-navigable product variant search modal (F3). */
export function VariantSearchModal({ open, onClose, onPick, initialQuery = '', branchId, showStock = true }) {
  const [q, setQ] = useState(initialQuery);
  const dq = useDebounce(q, 200);
  const [items, setItems] = useState([]);
  const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);
  useEffect(() => { if (open) { setQ(initialQuery); setHi(0); } }, [open, initialQuery]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    get('/products/variants/search', { q: dq, limit: 30, ...(branchId ? { branchId } : {}) })
      .then((r) => { if (alive) { setItems(r); setHi(0); } })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [dq, open, branchId]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  return (
    <Modal open={open} onClose={onClose} title="Search Product" size="lg">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input data-autofocus className="input py-2.5 pl-9 text-base" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, SKU, barcode, color, size… (e.g. black tee L)"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter' && items[hi]) { e.preventDefault(); onPick(items[hi]); }
          }} />
      </div>
      <div ref={listRef} className="mt-3 max-h-[55vh] overflow-auto rounded-lg border border-ink-100 dark:border-ink-800">
        {loading && !items.length ? <Loading /> : !items.length ? <Empty title="No matching products" /> : (
          <table className="tbl">
            <thead><tr><th>Product</th><th>Variant</th><th>SKU / Barcode</th><th className="num">MRP</th><th className="num">Price</th>{showStock && <th className="num">Stock</th>}</tr></thead>
            <tbody>
              {items.map((v, i) => (
                <tr key={v._id} data-i={i} onMouseEnter={() => setHi(i)} onClick={() => onPick(v)}
                  className={clsx('cursor-pointer', i === hi && '!bg-brand-50 dark:!bg-brand-500/10')}>
                  <td className="font-medium">{v.productName}<div className="text-[11px] text-ink-500">{v.brandName} · {v.categoryName}</div></td>
                  <td>{variantLabel(v) || '-'}</td>
                  <td className="font-mono text-xs">{v.sku}<div className="text-ink-500">{v.barcode}</div></td>
                  <td className="num">{inr(v.mrp)}</td>
                  <td className="num font-semibold">{inr(v.sellingPrice)}</td>
                  {showStock && <td className={clsx('num font-semibold', (v.stock || 0) <= 0 ? 'text-rose-600' : 'text-emerald-600')}>{v.stock ?? '-'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-2 text-[11px] text-ink-500">↑ ↓ to navigate · Enter to select · Esc to close</div>
    </Modal>
  );
}

/**
 * Barcode / SKU entry used by purchase, transfer, adjustment and exchange screens.
 * Resolves the exact variant via /barcodes/lookup and calls onVariant(variant).
 */
export function ScanInput({ onVariant, branchId, placeholder = 'Scan barcode or type SKU and press Enter (F3 to search)', autoFocus = true, inputRef }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(false);
  const localRef = useRef(null);
  const ref = inputRef || localRef;
  const lookup = async () => {
    const c = code.trim();
    if (!c) { setSearch(true); return; }
    setBusy(true);
    try {
      const v = await get(`/barcodes/lookup/${encodeURIComponent(c)}`, {}, branchId ? { headers: { 'x-branch-id': branchId } } : undefined);
      onVariant(v);
      setCode('');
    } catch (e) {
      if (e?.response?.status === 404) { toast.error(`Product not found: ${c}`); setSearch(true); } else toast.error(errMsg(e));
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <ScanBarcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-500" />
        <input ref={ref} autoFocus={autoFocus} className="input pl-9 font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); lookup(); }
            if (e.key === 'F3') { e.preventDefault(); setSearch(true); }
          }} />
        {busy && <Spinner className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />}
      </div>
      <button type="button" className="btn-secondary" onClick={() => setSearch(true)}><Search className="h-4 w-4" /> Search</button>
      <VariantSearchModal open={search} initialQuery={code} branchId={branchId} onClose={() => { setSearch(false); ref.current?.focus(); }}
        onPick={(v) => { setSearch(false); setCode(''); onVariant(v); setTimeout(() => ref.current?.focus(), 50); }} />
    </div>
  );
}

/** Branch dropdown limited to the user's branches. */
export function BranchSelect({ value, onChange, label = 'Branch', includeAll = false, all = false, className, exclude }) {
  const branches = useAuth((s) => s.branches);
  const [allBranches, setAll] = useState(null);
  useEffect(() => { if (all) get('/branches', { active: 'true', scope: 'company' }).then(setAll).catch(() => {}); }, [all]);
  const list = useMemo(() => (all && allBranches ? allBranches : branches).filter((b) => b._id !== exclude), [all, allBranches, branches, exclude]);
  return (
    <label className={clsx('block', className)}>
      {label && <span className="label">{label}</span>}
      <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {includeAll ? <option value="">All branches</option> : <option value="">Select branch</option>}
        {list.map((b) => <option key={b._id} value={b._id}>{b.name} ({b.code})</option>)}
      </select>
    </label>
  );
}
