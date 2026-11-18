import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  ScanBarcode, Search, User, UserPlus, X, Minus, Plus, Trash2, PauseCircle, History, CreditCard, Printer, FilePlus2,
  Keyboard, Wallet, Gift, BadgePercent, CheckCircle2, PackageX, Clock3, Receipt, Undo2,
} from 'lucide-react';
import { get, post, del, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { usePOS } from '../../store/pos';
import { confirm } from '../../store/ui';
import { useHotkeys, useScanner, useDebounce, useAppEvent } from '../../hooks';
import { computeTotals, isInterState } from '../../lib/gst';
import { inr, round2, variantLabel, ftime, PAYMENT_LABELS } from '../../lib/format';
import { printReceipt } from '../../lib/print';
import { beep } from '../../lib/beep';
import { Modal, Kbd, Spinner, Empty } from '../../components/ui';
import { VariantSearchModal } from '../../components/common';
import { InvoiceFinder, BillSummary, ReturnItemsTable, returnValue } from './ReturnParts';

const SHORTCUTS = [
  ['F1', 'Sales / new bill (any page)'], ['F3', 'Direct print last bill'], ['F4', 'Purchase entry (any page)'],
  ['F5', 'New product (any page)'], ['F6', 'Reports (any page)'], ['F7', 'Sales summary, product-wise (any page)'], ['F8', 'Purchase summary (any page)'],
  ['F9', 'Cash payment (any page)'], ['F10', 'Cash receipt (any page)'], ['F11', 'GST billing (any page)'], ['F12', 'GST report (any page)'], ['Alt+S', 'Product search'], ['Alt+P / Enter', 'Payment'],
  ['F2', 'Sales return from an old bill (popup)'], ['R', 'Customer does not want it: return 1 (minus line)'], ['Ctrl+R', 'Item from an earlier bill: return'], ['Alt+C', 'Customer search'], ['Alt+N', 'New customer'], ['Alt+H', 'Hold bill'], ['Alt+R', 'Recall bill'], ['Del', 'Remove selected item'],
  ['Q', 'Change quantity'], ['D', 'Item discount'], ['B', 'Bill discount'], ['E', 'Change rate'], ['↑ / ↓', 'Select item'], ['+ / −', 'Qty of selected (empty scan box)'],
  ['3*CODE', 'Scan with quantity'], ['Esc', 'Close popup'],
];

/* ---------------------------------- small modals ---------------------------------- */

function NumberModal({ open, title, label, initial, onClose, onSubmit, integer = true, suffix }) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(String(initial ?? '')); }, [open, initial]);
  const submit = () => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || (integer && (!Number.isInteger(n) || n === 0))) return toast.error('Enter a valid number');
    onSubmit(n);
    return null;
  };
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel <Kbd>Esc</Kbd></button><button type="button" className="btn-primary" onClick={submit}>Apply <Kbd>↵</Kbd></button></>}>
      <label className="label">{label}</label>
      <div className="relative">
        <input data-autofocus type="number" step={integer ? 1 : 0.01} className="input py-3 text-2xl font-bold tabular-nums" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400">{suffix}</span>}
      </div>
    </Modal>
  );
}

function DiscountModal({ open, onClose, line, maxPct, onSubmit, title = 'Item Discount', base }) {
  const [mode, setMode] = useState('amount');
  const [v, setV] = useState('');
  useEffect(() => {
    if (!open) return;
    if (line?.discountPercent) { setMode('percent'); setV(String(line.discountPercent)); } else { setMode('amount'); setV(String(line?.discount || '')); }
  }, [open]);
  const gross = base ?? (line ? line.qty * line.rate : 0);
  const amt = mode === 'percent' ? round2((gross * (Number(v) || 0)) / 100) : Number(v) || 0;
  const pct = gross ? round2((amt / gross) * 100) : 0;
  const submit = () => {
    if (amt < 0 || amt > gross) return toast.error('Discount cannot exceed the amount');
    if (pct > maxPct + 0.001) return toast.error(`Your discount limit is ${maxPct}%`);
    onSubmit(mode === 'percent' ? { discountPercent: Number(v) || 0, discount: 0 } : { discount: amt, discountPercent: 0 });
    return null;
  };
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit}>Apply <Kbd>↵</Kbd></button></>}>
      <div className="mb-3 flex rounded-lg bg-ink-100 p-1 text-sm dark:bg-ink-800">
        {['amount', 'percent'].map((m) => <button key={m} type="button" className={clsx('flex-1 rounded-md py-1.5 font-medium', mode === m && 'bg-white shadow dark:bg-ink-700')} onClick={() => setMode(m)}>{m === 'amount' ? '₹ Amount' : '% Percent'}</button>)}
      </div>
      <input data-autofocus type="number" className="input py-3 text-2xl font-bold" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === '%') { e.preventDefault(); setMode('percent'); } }} />
      <div className="mt-2 flex justify-between text-xs text-ink-500"><span>On {inr(gross)}</span><span>= {inr(amt)} ({pct}%) · Limit {maxPct}%</span></div>
    </Modal>
  );
}

/**
 * Discount typed straight into the bill. mode "amount": "50" = ₹50 off ("10%" still works); mode "percent": "10" = 10 % off.
 * Each box shows the discount in its own unit, so the ₹ box and the % box always agree.
 * Applied on Enter / leaving the box, with the same checks as the discount popup (amount, role limit).
 */
function DiscInput({ value, gross, maxPct, onApply, onDone, className, mode = 'amount' }) {
  const curAmt = value?.discountPercent ? round2((gross * value.discountPercent) / 100) : round2(value?.discount || 0);
  const curPct = value?.discountPercent ? value.discountPercent : gross && curAmt ? round2((curAmt / gross) * 100) : 0;
  const shown = mode === 'percent' ? (curPct ? String(curPct) : '') : (curAmt ? String(curAmt) : '');
  const [v, setV] = useState(shown);
  const [editing, setEditing] = useState(false);
  const cancel = useRef(false);
  useEffect(() => { if (!editing) setV(shown); }, [shown, editing]);
  const commit = () => {
    setEditing(false);
    if (cancel.current) { cancel.current = false; setV(shown); return; }
    const t = v.trim().replace(/\s/g, '');
    if (t === shown) return;
    const isPct = mode === 'percent' || t.endsWith('%');
    const n = Number(t.replace('%', '')) || 0;
    const amt = isPct ? round2((gross * n) / 100) : round2(n);
    const fail = (msg) => { toast.error(msg); setV(shown); };
    if (n < 0 || amt > gross + 0.001) return fail('Discount cannot exceed the amount');
    if (gross && round2((amt / gross) * 100) > maxPct + 0.001) return fail(`Your discount limit is ${maxPct}%`);
    onApply(isPct ? { discountPercent: n, discount: 0 } : { discount: amt, discountPercent: 0 });
    return null;
  };
  return (
    <input type="text" inputMode="decimal" placeholder={mode === 'percent' ? '%' : '₹'} title={mode === 'percent' ? 'Discount percent (10 = 10 %), press Enter' : 'Discount amount in ₹ (50), press Enter'}
      className={clsx('input input-sm text-right tabular-nums text-rose-600', className)} value={v}
      onChange={(e) => setV(e.target.value.replace(/[^\d.%]/g, ''))}
      onFocus={(e) => { setEditing(true); e.target.select(); }}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); onDone?.(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel.current = true; e.currentTarget.blur(); onDone?.(); }
      }} />
  );
}

/** ₹ and % discount boxes side by side: type in either, the other follows. */
function DiscPair({ className, ...props }) {
  return (
    <div className={clsx('flex items-center justify-end gap-1', className)}>
      <DiscInput {...props} mode="amount" className="w-[4.5rem]" />
      <DiscInput {...props} mode="percent" className="w-14" />
    </div>
  );
}

function CustomerModal({ open, onClose, onPick, onNew }) {
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 200);
  const [list, setList] = useState([]);
  const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (open) { setQ(''); setList([]); } }, [open]);
  useEffect(() => {
    if (!open || !dq) { setList([]); return; }
    setLoading(true);
    get('/customers/search', { q: dq }).then((r) => { setList(r); setHi(0); }).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  }, [dq, open]);
  return (
    <Modal open={open} onClose={onClose} title="Customer Search" size="md" footer={<button type="button" className="btn-secondary" onClick={() => onNew(q)}><UserPlus className="h-4 w-4" /> New customer <Kbd>Alt+N</Kbd></button>}>
      <input data-autofocus className="input py-2.5 text-base" placeholder="Mobile number or name" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) onPick(list[hi]); else if (q) onNew(q); }
          if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); e.stopPropagation(); onNew(q); }
        }} />
      <div className="mt-3 max-h-80 overflow-auto">
        {loading && <div className="p-4"><Spinner /></div>}
        {!loading && dq && !list.length && <div className="rounded-lg bg-ink-50 p-4 text-center text-sm text-ink-500 dark:bg-ink-800">No customer found. Press <Kbd>Enter</Kbd> to create “{dq}”.</div>}
        {list.map((c, i) => (
          <button type="button" key={c._id} onMouseEnter={() => setHi(i)} onClick={() => onPick(c)} className={clsx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left', i === hi ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-ink-50 dark:hover:bg-ink-800')}>
            <div><div className="font-semibold">{c.name}</div><div className="text-xs text-ink-500">{c.mobile} · {c.code}</div></div>
            <div className="text-right text-xs text-ink-500"><div>{c.loyaltyPoints} pts</div>{c.outstanding > 0 && <div className="text-rose-600">Due {inr(c.outstanding)}</div>}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function NewCustomerModal({ open, onClose, initial, onCreated }) {
  const [f, setF] = useState({ name: '', mobile: '', email: '', dob: '', gstNumber: '', address: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const digits = (initial || '').replace(/\D/g, '');
    setF({ name: digits.length >= 6 ? '' : initial || '', mobile: digits.length >= 6 ? digits : '', email: '', dob: '', gstNumber: '', address: '' });
  }, [open, initial]);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const c = await post('/customers', f);
      toast.success(`Customer ${c.name} created`);
      onCreated(c);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New Customer" size="md" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={submit}>Save customer <Kbd>↵</Kbd></button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <label className="col-span-2 sm:col-span-1"><span className="label">Mobile *</span><input className="input" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} required data-autofocus={!f.mobile || undefined} inputMode="numeric" /></label>
        <label className="col-span-2 sm:col-span-1"><span className="label">Name *</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-autofocus={f.mobile ? true : undefined} /></label>
        <label><span className="label">Email</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label><span className="label">Date of birth</span><input className="input" type="date" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} /></label>
        <label><span className="label">GST number</span><input className="input uppercase" value={f.gstNumber} onChange={(e) => setF({ ...f, gstNumber: e.target.value })} /></label>
        <label><span className="label">Address</span><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function RecallModal({ open, onClose, onRecall }) {
  const [list, setList] = useState(null);
  const [hi, setHi] = useState(0);
  const load = useCallback(() => get('/sales/hold').then((r) => { setList(r); setHi(0); }).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => { if (open) load(); }, [open, load]);
  useAppEvent('hold', () => open && load());
  const remove = async (h) => {
    if (!(await confirm({ title: 'Delete held bill?', message: `${h.holdNo} · ${inr(h.amount)}`, danger: true, confirmText: 'Delete' }))) return;
    try { await del(`/sales/hold/${h._id}`); toast.success('Held bill deleted'); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (!list?.length || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
      if (e.key === 'Enter') { e.preventDefault(); onRecall(list[hi]); }
      if (e.key === 'Delete') { e.preventDefault(); remove(list[hi]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, list, hi]);
  return (
    <Modal open={open} onClose={onClose} title="Recall Held Bill" size="lg">
      {!list ? <Spinner /> : !list.length ? <Empty title="No held bills" /> : (
        <table className="tbl">
          <thead><tr><th>Bill No</th><th>Customer</th><th className="num">Items</th><th className="num">Amount</th><th>Cashier</th><th>Time</th><th /></tr></thead>
          <tbody>
            {list.map((h, i) => (
              <tr key={h._id} onMouseEnter={() => setHi(i)} onClick={() => onRecall(h)} className={clsx('cursor-pointer', i === hi && '!bg-brand-50 dark:!bg-brand-500/10')}>
                <td className="font-mono text-xs font-semibold">{h.holdNo}</td><td>{h.customerName || 'Walk-in'}{h.customerMobile && <div className="text-xs text-ink-500">{h.customerMobile}</div>}</td>
                <td className="num">{h.itemCount}</td><td className="num font-semibold">{inr(h.amount)}</td><td>{h.cashierName}</td><td>{ftime(h.createdAt)}</td>
                <td><button type="button" className="btn-ghost btn-sm text-rose-600" onClick={(e) => { e.stopPropagation(); remove(h); }}><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-2 text-[11px] text-ink-500">↑ ↓ select · Enter recall · Del delete · Esc close</div>
    </Modal>
  );
}

function NotFoundModal({ code, onClose, onCreate, onSearch }) {
  useEffect(() => {
    if (!code) return undefined;
    const onKey = (e) => {
      if (e.key.toLowerCase() === 'c') { e.preventDefault(); onCreate(); }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); onSearch(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [code]);
  return (
    <Modal open={Boolean(code)} onClose={onClose} size="sm">
      <div className="flex flex-col items-center py-2 text-center">
        <div className="mb-3 rounded-full bg-rose-100 p-3 text-rose-600 dark:bg-rose-500/15"><PackageX className="h-7 w-7" /></div>
        <div className="text-lg font-bold">Product Not Found</div>
        <div className="mt-1 font-mono text-sm text-ink-500">{code}</div>
        <div className="mt-5 grid w-full gap-2">
          <button type="button" className="btn-primary" onClick={onCreate}>Create Product <Kbd>C</Kbd></button>
          <button type="button" className="btn-secondary" onClick={onSearch}>Search Product <Kbd>S</Kbd></button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
        </div>
      </div>
    </Modal>
  );
}

const MODE_ICONS = { cash: Wallet, card: CreditCard, upi: ScanBarcode, bank: Receipt, credit: Clock3, store_credit: Gift, loyalty: BadgePercent };

function PaymentModal({ open, onClose, total, customer, settings, onComplete, busy }) {
  const enabled = settings?.payment?.enabledModes || ['cash', 'card', 'upi'];
  const [rows, setRows] = useState([]);
  const firstRef = useRef(null);
  useEffect(() => { if (open) setRows([{ mode: settings?.payment?.defaultMode || 'cash', amount: total, reference: '' }]); }, [open, total]);
  const paid = round2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const cash = round2(rows.filter((r) => r.mode === 'cash').reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const balance = round2(total - paid);
  const change = balance < 0 ? -balance : 0;
  const loyaltyMax = customer && settings?.loyalty?.enabled ? Math.min(customer.loyaltyPoints * settings.loyalty.pointValue, total) : 0;
  const available = (m) => {
    if (!enabled.includes(m)) return false;
    if (m === 'credit') return Boolean(customer);
    if (m === 'store_credit') return Boolean(customer?.storeCredit > 0);
    if (m === 'loyalty') return Boolean(customer && settings?.loyalty?.enabled && customer.loyaltyPoints >= settings.loyalty.minRedeemPoints);
    return true;
  };
  // Editing a non-cash amount re-balances the cash row so split payments stay exact (e.g. 2500 = UPI 1500 + cash 1000).
  const rebalance = (list, changedIdx) => {
    const cashIdx = list.findIndex((r, i) => r.mode === 'cash' && i !== changedIdx);
    if (cashIdx < 0) return list;
    const others = list.reduce((a, r, i) => (i === cashIdx ? a : a + (Number(r.amount) || 0)), 0);
    return list.map((r, i) => (i === cashIdx ? { ...r, amount: Math.max(0, round2(total - others)) } : r));
  };
  // Cash is what the customer hands over, so it may exceed the bill; only non-cash edits re-balance the cash row.
  const setAmount = (i, amount) => setRows((rs) => {
    const list = rs.map((x, j) => (j === i ? { ...x, amount } : x));
    return rs[i].mode === 'cash' ? list : rebalance(list, i);
  });
  const cashIdx = rows.findIndex((r) => r.mode === 'cash');
  const cashDue = Math.max(0, round2(total - (paid - cash)));
  // quick tender: exact amount plus the next round notes a customer typically hands over
  const tenders = cashIdx < 0 || cashDue <= 0 ? [] : [...new Set([cashDue, ...[100, 500, 1000, 2000].map((n) => Math.ceil(cashDue / n) * n)])].sort((a, b) => a - b).slice(0, 5);
  const addMode = (mode) => {
    if (rows.some((r) => r.mode === mode)) return;
    const nonCashPaid = rows.filter((r) => r.mode !== 'cash').reduce((a, r) => a + (Number(r.amount) || 0), 0);
    let amount = Math.max(0, round2(total - nonCashPaid));
    if (mode === 'store_credit') amount = Math.min(amount, customer.storeCredit);
    if (mode === 'loyalty') amount = Math.min(amount, Math.floor(loyaltyMax / (settings.loyalty.pointValue || 1)) * (settings.loyalty.pointValue || 1));
    const next = [...rows, { mode, amount, reference: '' }];
    setRows(rebalance(next, next.length - 1));
    setTimeout(() => document.querySelector(`[data-pay='${next.length - 1}']`)?.focus(), 30);
  };
  const fullIn = (mode) => setRows([{ mode, amount: total, reference: '' }]);
  const validate = () => {
    const nonCash = round2(paid - cash);
    if (nonCash > total + 0.001) return 'Non-cash payments exceed the bill amount';
    if (balance > 0.001) return `Balance ₹${balance} pending`;
    if (change > cash + 0.001) return 'Excess is only allowed in cash';
    const sc = rows.filter((r) => r.mode === 'store_credit').reduce((a, r) => a + Number(r.amount || 0), 0);
    if (sc > (customer?.storeCredit || 0) + 0.001) return 'Store credit exceeds available balance';
    const lp = rows.filter((r) => r.mode === 'loyalty').reduce((a, r) => a + Number(r.amount || 0), 0);
    if (lp > loyaltyMax + 0.001) return 'Loyalty redemption exceeds available points';
    return null;
  };
  const submit = () => {
    const err = validate();
    if (err) return toast.error(err);
    onComplete(rows.filter((r) => Number(r.amount) > 0).map((r) => ({ mode: r.mode, amount: Number(r.amount), reference: r.reference || undefined })));
    return null;
  };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const map = { F10: 'cash', F11: 'card', F12: 'upi' };
      if (map[e.key]) { e.preventDefault(); fullIn(map[e.key]); }
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); submit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Modal open={open} onClose={onClose} title="Payment" size="lg" initialFocus="[data-pay='0']">
      <div className="grid gap-5 md:grid-cols-[1fr_240px]">
        <div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {['cash', 'card', 'upi', 'bank', 'credit', 'store_credit', 'loyalty'].filter(available).map((m) => {
              const I = MODE_ICONS[m];
              return <button key={m} type="button" className="btn-secondary btn-sm" onClick={() => addMode(m)}><I className="h-3.5 w-3.5" /> {PAYMENT_LABELS[m]}</button>;
            })}
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className="input w-36" value={r.mode} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))}>
                  {['cash', 'card', 'upi', 'bank', 'credit', 'store_credit', 'loyalty'].filter((m) => available(m) || m === r.mode).map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                </select>
                <input ref={i === 0 ? firstRef : undefined} data-pay={i} type="number" className="input flex-1 text-right text-lg font-bold tabular-nums" value={r.amount}
                  onChange={(e) => setAmount(i, e.target.value)}
                  onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
                {['card', 'upi', 'bank'].includes(r.mode) && <input className="input w-32" placeholder="Ref / Txn no" value={r.reference} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />}
                {rows.length > 1 && <button type="button" className="btn-ghost p-2 text-rose-600" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
          {tenders.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-500">Cash received:</span>
              {tenders.map((v) => (
                <button key={v} type="button" className={clsx('btn-sm rounded-lg border px-3 py-1.5 text-sm font-semibold tabular-nums transition', Number(rows[cashIdx].amount) === v ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800')} onClick={() => setAmount(cashIdx, v)}>{inr(v)}</button>
              ))}
            </div>
          )}
          {customer && (
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800"><div className="text-ink-500">Loyalty</div><div className="font-semibold">{customer.loyaltyPoints} pts {loyaltyMax > 0 && `(${inr(loyaltyMax)})`}</div></div>
              <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800"><div className="text-ink-500">Store credit</div><div className="font-semibold">{inr(customer.storeCredit)}</div></div>
              <div className="rounded-lg bg-ink-50 p-2 dark:bg-ink-800"><div className="text-ink-500">Outstanding</div><div className="font-semibold">{inr(customer.outstanding)}</div></div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-ink-500"><span><Kbd>F10</Kbd> Full cash</span><span><Kbd>F11</Kbd> Full card</span><span><Kbd>F12</Kbd> Full UPI</span><span><Kbd>Enter</Kbd> Complete</span></div>
        </div>
        <div className="space-y-2 rounded-xl bg-ink-900 p-4 text-white dark:bg-black/40">
          <div className="text-xs uppercase tracking-wide text-ink-400">Bill amount</div>
          <div className="text-3xl font-extrabold tabular-nums">{inr(total)}</div>
          <div className="flex justify-between border-t border-white/10 pt-2 text-sm"><span className="text-ink-400">{change > 0 ? 'Received' : 'Paid'}</span><span className="tabular-nums">{inr(paid)}</span></div>
          {balance > 0 && <div className="flex justify-between text-sm text-amber-300"><span>Balance</span><span className="font-bold tabular-nums">{inr(balance)}</span></div>}
          {change > 0 && <div className="rounded-lg bg-emerald-500/15 p-3 text-emerald-300"><div className="text-xs uppercase tracking-wide">Balance to return</div><div className="text-3xl font-extrabold tabular-nums">{inr(change)}</div></div>}
          <button type="button" className="btn-success btn-lg mt-3 w-full" disabled={busy} onClick={submit}>{busy ? <Spinner className="h-5 w-5 text-white" /> : <CheckCircle2 className="h-5 w-5" />} Complete <Kbd>↵</Kbd></button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Customer brings back items of an earlier bill: scan the barcode on that bill (or type the invoice number),
 * tick what comes back, and those pieces join the current bill as minus lines at the price paid on that bill.
 */
function OldBillReturnModal({ open, onClose, cartItems, settings, canOverride, onAdd }) {
  const [inv, setInv] = useState(null);
  const [sel, setSel] = useState({});
  useEffect(() => { if (open) { setInv(null); setSel({}); } }, [open]);
  const inCart = (id) => -cartItems.filter((l) => l.returnRef?.saleItemId === id).reduce((a, l) => a + l.qty, 0);
  // pieces already put into this bill count as returned, so they cannot be added twice
  const shown = inv ? inv.items.map((i) => ({ ...i, returnedQty: (i.returnedQty || 0) + inCart(i._id) })) : [];
  const value = inv ? returnValue(shown, sel) : 0;
  const policy = settings?.returnPolicy;
  const days = inv ? Math.floor((Date.now() - new Date(inv.sale.createdAt).getTime()) / 86400000) : 0;
  const blocked = !inv ? null
    : inv.sale.status !== 'completed' ? 'This bill is cancelled'
      : !policy?.enabled ? 'Returns are disabled in settings'
        : days > policy.days && !canOverride ? `Return period of ${policy.days} days is over (bill is ${days} days old)` : null;
  const add = () => {
    const picked = Object.entries(sel).filter(([, q]) => q > 0);
    if (!picked.length) return toast.error('Enter the quantity being returned');
    onAdd(inv, picked.map(([id, n]) => ({ it: inv.items.find((i) => i._id === id), n })));
    return null;
  };
  return (
    <Modal open={open} onClose={onClose} title="Return from an old bill" size="xl"
      footer={inv && <><button type="button" className="btn-secondary" onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
        <button type="button" className="btn-primary" disabled={Boolean(blocked) || !value} onClick={add}><Undo2 className="h-4 w-4" /> Add −{inr(value)} to this bill</button></>}>
      <div className="space-y-4">
        <InvoiceFinder key={String(open)} onLoad={(d) => { setInv(d); setSel({}); }} />
        {inv && (
          <>
            <BillSummary inv={inv} />
            {blocked ? <div className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{blocked}</div>
              : <ReturnItemsTable items={shown} value={sel} onChange={setSel} />}
            <p className="text-xs text-ink-500">Returned items come into the current bill as minus lines at the price paid on bill {inv.sale.invoiceNumber}; their stock goes back in when this bill is saved. Then scan whatever the customer buys instead.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Counter returns are worth more than the new items: choose how the difference goes back to the customer. */
function RefundModal({ open, amount, customer, settings, busy, onClose, onComplete }) {
  const enabled = settings?.payment?.enabledModes || ['cash', 'card', 'upi'];
  const modes = [...['cash', 'upi', 'card', 'bank'].filter((m) => enabled.includes(m)), ...(customer ? ['store_credit'] : [])];
  const [mode, setMode] = useState('cash');
  useEffect(() => { if (open) setMode(modes[0] || 'cash'); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (!busy) onComplete(mode); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setMode(modes[(modes.indexOf(mode) + 1) % modes.length]); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setMode(modes[(modes.indexOf(mode) - 1 + modes.length) % modes.length]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Modal open={open} onClose={onClose} title="Refund to customer" size="sm">
      <div className="rounded-xl bg-rose-50 p-4 text-center text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        <div className="text-xs uppercase tracking-wide">Returned items are worth more — give back</div>
        <div className="text-4xl font-extrabold tabular-nums">{inr(amount)}</div>
      </div>
      <div className="label mt-4">Refund by</div>
      <div className="grid grid-cols-2 gap-2">
        {modes.map((m) => {
          const I = MODE_ICONS[m];
          return (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={clsx('flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold', mode === m ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800')}>
              <I className="h-4 w-4" /> {m === 'upi' ? 'GPay / UPI' : PAYMENT_LABELS[m]}
            </button>
          );
        })}
      </div>
      <button type="button" className="btn-success btn-lg mt-4 w-full" disabled={busy} onClick={() => onComplete(mode)}>
        {busy ? <Spinner className="h-5 w-5 text-white" /> : <CheckCircle2 className="h-5 w-5" />} Refund {inr(amount)} & save <Kbd>↵</Kbd>
      </button>
      <div className="mt-2 text-center text-[11px] text-ink-500"><Kbd>←</Kbd> <Kbd>→</Kbd> change mode</div>
    </Modal>
  );
}

function SuccessModal({ data, onClose, onPrint }) {
  useEffect(() => {
    if (!data) return undefined;
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'F1') { e.preventDefault(); onClose(); }
      if (e.key === 'F3') { e.preventDefault(); onPrint('thermal'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data]);
  if (!data) return null;
  const { sale } = data;
  return (
    <Modal open onClose={onClose} size="sm">
      <div className="flex flex-col items-center py-2 text-center">
        <div className="mb-2 rounded-full bg-emerald-100 p-3 text-emerald-600 dark:bg-emerald-500/15"><CheckCircle2 className="h-8 w-8" /></div>
        <div className="text-lg font-bold">Bill saved</div>
        <div className="font-mono text-sm text-ink-500">{sale.invoiceNumber}</div>
        <div className="mt-3 text-3xl font-extrabold tabular-nums">{inr(sale.totals.grandTotal)}</div>
        {sale.changeReturned > 0 && <div className="mt-2 rounded-lg bg-emerald-50 px-4 py-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Return change <b className="text-xl">{inr(sale.changeReturned)}</b></div>}
        {sale.loyaltyEarned > 0 && <div className="mt-2 text-xs text-ink-500">+{sale.loyaltyEarned} loyalty points earned</div>}
        <div className="mt-5 grid w-full grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={() => onPrint('thermal')}><Printer className="h-4 w-4" /> Receipt <Kbd>F3</Kbd></button>
          <button type="button" className="btn-secondary" onClick={() => onPrint('a4')}><Printer className="h-4 w-4" /> A4 Invoice</button>
          <button type="button" className="btn-primary col-span-2" data-autofocus onClick={onClose}><FilePlus2 className="h-4 w-4" /> New bill <Kbd>Enter</Kbd></button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------- POS screen ---------------------------------- */

export default function POS() {
  const navigate = useNavigate();
  const { user, settings, branchId, can } = useAuth();
  const branch = useAuth((s) => s.currentBranch());
  const pos = usePOS();
  const { items, customer, billDiscount, selected, withGst } = pos;
  const [code, setCode] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [modal, setModal] = useState(null); // search | customer | newCustomer | recall | pay | qty | disc | billDisc | rate | help
  const [searchInit, setSearchInit] = useState('');
  const [newCustInit, setNewCustInit] = useState('');
  const [notFound, setNotFound] = useState(null);
  const [success, setSuccess] = useState(null);
  const [paying, setPaying] = useState(false);
  const [stats, setStats] = useState(null);
  const scanRef = useRef(null);
  const tableRef = useRef(null);

  const allowNegative = settings?.stock?.allowNegativeStock;
  const maxPct = user?.role?.maxDiscountPercent ?? 0;
  const interState = isInterState(settings?.tax, branch, customer);
  const { lines, totals } = useMemo(() => computeTotals(withGst ? items : items.map((i) => (i.returnRef ? i : { ...i, gstRate: 0 })), { taxInclusive: settings?.tax?.taxInclusive ?? true, interState, billDiscount }), [items, settings, interState, billDiscount, withGst]);
  const sel = items[selected];

  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 30), []);
  const closeModal = () => { setModal(null); focusScan(); };
  const loadStats = useCallback(() => { if (branchId && branchId !== 'all') get('/sales/counter-stats').then(setStats).catch(() => {}); }, [branchId]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { tableRef.current?.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: 'nearest' }); }, [selected, items.length]);
  // refresh customer balances (points, credit) when recalled from storage
  useEffect(() => { if (customer?._id) get(`/customers/${customer._id}`).then((p) => pos.setCustomer(p.customer)).catch(() => pos.setCustomer(null)); }, []);

  const addVariant = (v, qty = 1) => {
    const inCart = items.filter((i) => i.variantId === v._id && i.qty > 0).reduce((a, i) => a + i.qty, 0);
    if (!allowNegative && v.stock != null && inCart + qty > v.stock) {
      beep('err');
      toast.error(`Out of stock: ${v.productName} ${variantLabel(v)} (available ${v.stock})`);
      return;
    }
    pos.addVariant(v, qty);
    beep('ok');
  };

  const scan = async (raw) => {
    let c = String(raw || '').trim();
    if (!c) return;
    let qty = 1;
    const m = c.match(/^(\d{1,3})\*(.+)$/);
    if (m) { qty = Number(m[1]); c = m[2].trim(); }
    setScanBusy(true);
    try {
      const v = await get(`/barcodes/lookup/${encodeURIComponent(c)}`);
      addVariant(v, qty);
      setCode('');
    } catch (e) {
      beep('err');
      if (e?.response?.status === 404) { setNotFound(c); setCode(''); } else toast.error(errMsg(e));
    } finally {
      setScanBusy(false);
    }
  };

  useScanner((c) => { if (!modal && !notFound && !success) scan(c); }, { enabled: !modal && !notFound && !success });

  const newBill = async () => {
    if (items.length && !(await confirm({ title: 'Start a new bill?', message: 'The current bill will be cleared. Hold it (Alt+H) if you need it later.', confirmText: 'Clear bill', danger: true }))) return focusScan();
    pos.clear();
    setCode('');
    focusScan();
    return null;
  };

  // F1 (from any page) starts a new bill; newBill still asks before clearing a non-empty cart
  const { fresh, openReturn } = useLocation().state || {};
  useEffect(() => { if (fresh) newBill(); }, [fresh]);
  // F2 (from any page): open the "return from an old bill" popup on top of the current bill
  useEffect(() => { if (openReturn) openOldReturn(); }, [openReturn]);
  const openOldReturn = () => {
    if (!can('sale.return')) { toast.error('You are not allowed to take returns'); return; }
    setModal('oldReturn');
  };
  const addOldReturns = async (inv, picked) => {
    picked.forEach(({ it, n }) => pos.addOldBillReturn(it, n, { saleId: inv.sale._id, invoiceNumber: inv.sale.invoiceNumber, maxQty: it.qty - (it.returnedQty || 0) }));
    // the returning customer becomes the customer of this bill (if none chosen yet)
    if (!customer && inv.sale.customerId) get(`/customers/${inv.sale.customerId}`).then((p) => pos.setCustomer(p.customer)).catch(() => {});
    beep('ok');
    toast.success(`Returned from ${inv.sale.invoiceNumber}: now scan what the customer buys`);
    closeModal();
  };

  const hold = async () => {
    if (!items.length) return toast.error('Nothing to hold');
    try {
      if (pos.heldBillId) await del(`/sales/hold/${pos.heldBillId}`).catch(() => {});
      const h = await post('/sales/hold', { customerId: customer?._id, items, billDiscount, amount: totals.grandTotal });
      toast.success(`Bill held as ${h.holdNo}`);
      pos.clear();
    } catch (e) { toast.error(errMsg(e)); }
    focusScan();
    return null;
  };

  const recall = async (h) => {
    if (items.length && !(await confirm({ title: 'Replace current bill?', message: 'The current bill has items. Hold it first if you need it.', confirmText: 'Replace' }))) return;
    try {
      const full = await get(`/sales/hold/${h._id}`);
      let cust = null;
      if (full.customerId) cust = (await get(`/customers/${full.customerId}`)).customer;
      pos.load({ items: full.items, customer: cust, billDiscount: full.billDiscount, heldBillId: full._id });
      toast.success(`Recalled ${full.holdNo}`);
      const short = full.items.filter((i) => !allowNegative && i.stock < i.qty);
      if (short.length) toast.error(`Stock changed for ${short.map((i) => i.sku).join(', ')}`);
    } catch (e) { toast.error(errMsg(e)); }
    closeModal();
  };

  const hasReturns = items.some((i) => i.qty < 0);
  const returnTotal = round2(lines.filter((l) => l.qty < 0).reduce((a, l) => a + l.amount, 0));
  const soldNet = Math.max(0, round2(lines.reduce((a, l) => a + l.gross - l.lineDiscount, 0))); // bill discount base: net of returns
  const openPay = () => {
    if (!items.length) return toast.error('Add items to the bill first');
    if (totals.grandTotal < 0) { setModal('refund'); return null; } // returns are worth more than the new items
    if (totals.grandTotal === 0) {
      if (!hasReturns) return toast.error('Bill total must be greater than zero');
      complete([]); // even exchange through counter returns: nothing to collect
      return null;
    }
    setModal('pay');
    return null;
  };

  const complete = async (payments, refundMode) => {
    setPaying(true);
    try {
      const inv = await post('/sales', {
        customerId: customer?._id, billDiscount, payments, refundMode, heldBillId: pos.heldBillId || undefined, withGst,
        items: items.map((i) => ({ variantId: i.variantId, qty: i.qty, rate: i.rate, discount: i.discount || undefined, discountPercent: i.discountPercent || undefined, saleItemId: i.returnRef?.saleItemId })),
      });
      pos.clear();
      pos.setLastSale(inv.sale._id);
      setModal(null);
      setSuccess(inv);
      loadStats();
      if (settings?.printer?.autoPrintAfterSale) {
        printReceipt(inv);
        post(`/sales/${inv.sale._id}/printed`).catch(() => {});
      }
    } catch (e) {
      beep('err');
      toast.error(errMsg(e), { duration: 5000 });
    } finally {
      setPaying(false);
    }
  };

  const printLast = async (format) => {
    const id = success?.sale?._id || pos.lastSaleId;
    if (!id) return toast.error('No bill printed yet in this session');
    try {
      const inv = success?.sale?._id === id ? success : await get(`/sales/${id}`);
      await printReceipt(inv, { format });
      post(`/sales/${id}/printed`).catch(() => {});
    } catch (e) { toast.error(errMsg(e)); }
    return null;
  };

  const needLine = (fn) => () => { if (!sel) { toast.error('Select an item first'); return; } fn(); };
  // +/- change how many pieces: on a return line (minus qty) "+" means one more piece returned
  const changeQty = (i, delta) => {
    const line = items[i];
    if (!line) return;
    const ret = line.qty < 0;
    const q = line.qty + (ret ? -delta : delta);
    if (q === 0 || Math.sign(q) !== Math.sign(line.qty)) return;
    const inCart = items.filter((x) => x.variantId === line.variantId && x.qty > 0).reduce((a, x) => a + x.qty, 0);
    if (!ret && delta > 0 && !allowNegative && line.stock != null && inCart + delta > line.stock) { beep('err'); toast.error(`Only ${line.stock} in stock`); return; }
    pos.updateLine(i, { qty: q });
  };
  // R / row Return button: customer doesn't want one piece of a billed item -> a minus line appears under it
  // (R on a minus line undoes one piece)
  const returnItem = (index = selected) => {
    const line = items[index];
    if (!line) { toast.error('Select the item the customer does not want, then press R'); return; }
    if (line.qty > 0 && !can('sale.return')) { toast.error('You are not allowed to take returns'); return; }
    const r = pos.returnOne(index);
    if (r.error) { beep('err'); toast.error(r.error); return; }
    if (r.undone) { toast('Return undone'); return; }
    beep('ok');
    toast.success(`${line.productName}: −${-r.line.qty} returned`);
  };
  // Ctrl+R: the scanned item was bought earlier and brought back -> the line itself turns minus
  const flipReturn = () => {
    if (!sel) { toast.error('Scan the returned item first, then press Ctrl+R'); return; }
    if (sel.qty > 0 && !can('sale.return')) { toast.error('You are not allowed to take returns'); return; }
    const line = pos.toggleReturn(selected);
    if (!line) { toast.error('Use R on this item (it has a return line)'); return; }
    if (line.qty < 0) { beep('ok'); toast.success(`${line.productName}: brought back — RETURN (−${-line.qty})`); } else toast('Return removed — sold item again');
  };

  const anyModal = Boolean(modal || notFound || success);
  const editQty = needLine(() => setModal('qty'));
  const editDisc = needLine(() => (sel.qty < 0 ? toast.error('No discount on a return item') : can('sale.discount') ? setModal('disc') : toast.error('You are not allowed to give discounts')));
  const editBillDisc = () => (can('sale.discount') ? (items.length ? setModal('billDisc') : toast.error('Add items first')) : toast.error('You are not allowed to give discounts'));
  const editRate = needLine(() => (sel.returnRef ? toast.error('Price comes from the old bill') : can('sale.price_change') ? setModal('rate') : toast.error('You are not allowed to change the selling price')));
  // single-key shortcuts (no Ctrl needed); in the scan box they only fire while it is empty
  const letterKeys = { q: editQty, d: editDisc, b: editBillDisc, e: editRate, r: () => returnItem() };
  useHotkeys({
    // F1 / F2 / F4–F12 are app-wide (see Layout)
    F3: () => printLast(),
    'alt+s': () => { setSearchInit(code); setModal('search'); },
    'alt+c': () => setModal('customer'),
    'alt+h': hold,
    'alt+r': () => setModal('recall'),
    'alt+n': () => { setNewCustInit(''); setModal('newCustomer'); },
    'alt+p': openPay,
    ...letterKeys,
    'ctrl+q': editQty,
    'ctrl+d': editDisc,
    'ctrl+b': editBillDisc,
    'ctrl+e': editRate,
    'ctrl+r': flipReturn,
    Delete: needLine(() => pos.removeLine(selected)),
    ArrowDown: () => pos.select(selected + 1),
    ArrowUp: () => pos.select(selected - 1),
    '?': () => setModal('help'),
  }, { enabled: !anyModal, allowInInputs: [] });

  if (!branchId || branchId === 'all') {
    return <div className="p-8"><Empty title="Select a branch to start billing" hint="Billing always happens in a specific branch. Choose one from the branch switcher at the top." /></div>;
  }

  return (
    <div className="flex h-full flex-col bg-ink-100/60 dark:bg-ink-950">
      {/* counter bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-ink-200 bg-white px-4 py-2 text-xs dark:border-ink-800 dark:bg-ink-900">
        <span className="font-semibold text-ink-900 dark:text-white">{branch?.name} · Counter</span>
        <span className="text-ink-500">Cashier: <b className="text-ink-700 dark:text-ink-200">{user?.name}</b></span>
        {stats && <span className="text-ink-500">Today: <b className="text-ink-700 dark:text-ink-200">{stats.bills} bills · {inr(stats.amount)}</b></span>}
        {stats && (stats.cashSession ? <span className="badge-green">Cash session {stats.cashSession.sessionNo}</span> : can('cash.manage') && <button type="button" className="badge-amber" onClick={() => navigate('/accounts/cash')}>No cash session — open</button>)}
        {pos.heldBillId && <span className="badge-blue">Recalled bill</span>}
        {can('sale.return') && <button type="button" className="btn-secondary btn-sm border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:hover:bg-rose-500/10" onClick={openOldReturn}><Undo2 className="h-4 w-4" /> Sales Return (old bill) <Kbd>F2</Kbd></button>}
        <div className="flex-1" />
        <button type="button" className="flex items-center gap-1 text-ink-500 hover:text-brand-600" onClick={() => setModal('help')}><Keyboard className="h-4 w-4" /> Shortcuts <Kbd>?</Kbd></button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_360px]">
        {/* left: scan + items */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="card flex items-center gap-2 p-2.5">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-500" />
              <input ref={scanRef} autoFocus className="input border-2 py-3 pl-11 font-mono text-lg tracking-wide focus:border-brand-500" placeholder="Scan barcode / type SKU and press Enter"
                value={code} onChange={(e) => setCode(e.target.value)} disabled={anyModal}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (code.trim()) scan(code); else if (items.length) openPay(); }
                  else if (!code && e.key === 'Delete' && sel) { e.preventDefault(); pos.removeLine(selected); }
                  else if (!code && !e.ctrlKey && !e.altKey && letterKeys[e.key.toLowerCase()]) { e.preventDefault(); letterKeys[e.key.toLowerCase()](); }
                  else if (!code && (e.key === '+' || e.key === '=')) { e.preventDefault(); changeQty(selected, 1); }
                  else if (!code && e.key === '-') { e.preventDefault(); changeQty(selected, -1); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); pos.select(selected + 1); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); pos.select(selected - 1); }
                }} />
              {scanBusy && <Spinner className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2" />}
            </div>
            <button type="button" className="btn-secondary py-3" onClick={() => { setSearchInit(code); setModal('search'); }}><Search className="h-4 w-4" /> Search <Kbd>Alt+S</Kbd></button>
          </div>

          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <div ref={tableRef} className="min-h-0 flex-1 overflow-auto">
              {!items.length ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center text-ink-400">
                  <ScanBarcode className="h-12 w-12 opacity-40" />
                  <div className="text-sm font-medium">Scan a product barcode to start billing</div>
                  <div className="text-xs">or press <Kbd>Alt+S</Kbd> to search · <Kbd>Alt+R</Kbd> to recall a held bill</div>
                </div>
              ) : (
                <table className="tbl">
                  <thead><tr><th className="w-10">#</th><th>Barcode</th><th>Product</th><th>Size</th><th>Color</th><th className="num w-32">Qty</th><th className="num">Rate</th><th className="num">Disc ₹ / %</th><th className="num">GST</th><th className="num">Amount</th><th className="w-28" /></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.key} data-row={i} onClick={() => { pos.select(i); focusScan(); }} className={clsx('cursor-pointer', l.qty < 0 && 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300', i === selected && '!bg-brand-50 ring-1 ring-inset ring-brand-300 dark:!bg-brand-500/10 dark:ring-brand-500/40')}>
                        <td className="text-ink-400">{i + 1}</td>
                        <td className="font-mono text-xs">{l.barcode}</td>
                        <td className="max-w-[260px] truncate font-medium">{l.qty < 0 && <span className="badge-red mr-1.5">{l.returnRef ? `RETURN · ${l.returnRef.invoiceNumber}` : 'RETURN'}</span>}{l.productName}<div className="font-mono text-[10px] text-ink-400">{l.sku}</div></td>
                        <td>{l.size || '-'}</td>
                        <td>{l.color || '-'}</td>
                        <td className="num">
                          <div className="inline-flex items-center gap-1">
                            <button type="button" tabIndex={-1} className="rounded p-0.5 hover:bg-ink-200 dark:hover:bg-ink-700" onClick={(e) => { e.stopPropagation(); changeQty(i, -1); }}><Minus className="h-3.5 w-3.5" /></button>
                            <span className="w-8 text-center font-bold">{l.qty}</span>
                            <button type="button" tabIndex={-1} className="rounded p-0.5 hover:bg-ink-200 dark:hover:bg-ink-700" onClick={(e) => { e.stopPropagation(); changeQty(i, 1); }}><Plus className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                        <td className="num">{inr(l.rate)}{l.rate !== l.originalRate && <div className="text-[10px] text-amber-600 line-through">{inr(l.originalRate)}</div>}</td>
                        <td className="num text-rose-600">
                          {l.qty > 0 && can('sale.discount') ? (
                            <>
                              <DiscPair value={l} gross={l.gross} maxPct={maxPct} onApply={(d) => pos.updateLine(i, d)} onDone={focusScan} />
                              {round2(l.discountTotal - l.lineDiscount) > 0 && <div className="text-[10px]">bill -{inr(l.discountTotal - l.lineDiscount)}</div>}
                            </>
                          ) : (l.discountTotal ? `-${inr(l.discountTotal)}` : '-')}
                        </td>
                        <td className="num text-xs text-ink-500">{l.gstRate}%</td>
                        <td className={clsx('num font-semibold', l.qty < 0 && 'text-rose-600')}>{inr(l.amount)}</td>
                        <td className="whitespace-nowrap">
                          {l.qty > 0 && can('sale.return') && <button type="button" tabIndex={-1} title="Customer doesn't want it: return 1 (R)" className="mr-2 inline-flex items-center gap-0.5 rounded border border-rose-200 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:hover:bg-rose-500/10" onClick={(e) => { e.stopPropagation(); pos.select(i); returnItem(i); focusScan(); }}><Undo2 className="h-3.5 w-3.5" /> Return</button>}
                          <button type="button" tabIndex={-1} className="text-ink-400 hover:text-rose-600" onClick={(e) => { e.stopPropagation(); pos.removeLine(i); focusScan(); }}><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-ink-100 px-4 py-2 text-xs text-ink-500 dark:border-ink-800">
              <span>Items: <b className="text-ink-800 dark:text-ink-100">{items.length}</b></span>
              <span>Qty: <b className="text-ink-800 dark:text-ink-100">{totals.totalQty}</b></span>
              {sel && <span>Selected: <b className="text-ink-800 dark:text-ink-100">{sel.productName} {variantLabel(sel)}</b> · stock {sel.stock ?? '-'}</span>}
              <div className="flex-1" />
              <span><Kbd>Q</Kbd> Qty</span><span><Kbd>D</Kbd> Disc</span>{can('sale.return') && <span><Kbd>R</Kbd> Return</span>}{can('sale.price_change') && <span><Kbd>E</Kbd> Rate</span>}<span><Kbd>Del</Kbd> Remove</span>
            </div>
          </div>
        </div>

        {/* right: customer + totals */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="card p-3">
            {customer ? (
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">{customer.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{customer.name}</div>
                  <div className="text-xs text-ink-500">{customer.mobile} · {customer.code}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="badge-brand">{customer.loyaltyPoints} pts</span>
                    {customer.storeCredit > 0 && <span className="badge-green">Credit {inr(customer.storeCredit)}</span>}
                    {customer.outstanding > 0 && <span className="badge-red">Due {inr(customer.outstanding)}</span>}
                    {interState && <span className="badge-amber">IGST</span>}
                  </div>
                </div>
                <button type="button" className="btn-ghost p-1.5" onClick={() => pos.setCustomer(null)} aria-label="Remove customer"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setModal('customer')}><User className="h-4 w-4" /> Customer <Kbd>Alt+C</Kbd></button>
                <button type="button" className="btn-secondary" onClick={() => { setNewCustInit(''); setModal('newCustomer'); }}><UserPlus className="h-4 w-4" /> <Kbd>Alt+N</Kbd></button>
              </div>
            )}
          </div>

          <div className="card flex flex-1 flex-col p-4">
            <label className={clsx('mb-3 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold', withGst ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300')}>
              <span>{withGst ? 'With GST' : 'Without GST'}</span>
              <span className="flex items-center gap-2 text-xs font-normal">{withGst ? 'ON' : 'OFF'}
                <button type="button" role="switch" aria-checked={withGst} aria-label="Bill with GST" onClick={() => pos.setWithGst(!withGst)}
                  className={clsx('relative h-6 w-11 rounded-full transition', withGst ? 'bg-emerald-500' : 'bg-ink-300 dark:bg-ink-600')}>
                  <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', withGst ? 'left-[22px]' : 'left-0.5')} />
                </button>
              </span>
            </label>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-ink-500">Subtotal</dt><dd className="tabular-nums">{inr(totals.subtotal)}</dd></div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Discount {totals.billDiscount > 0 && <span className="text-[11px]">(bill {inr(totals.billDiscount)})</span>}</dt>
                <dd className={clsx('tabular-nums', totals.discount > 0 && 'text-rose-600')}>{totals.discount > 0 ? `-${inr(totals.discount)}` : inr(0)}</dd>
              </div>
              {can('sale.discount') && items.length > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-ink-500">Bill discount <span className="text-[11px]">(₹ / %)</span></dt>
                  <dd><DiscPair value={{ discount: billDiscount }} gross={soldNet} maxPct={Math.min(maxPct, settings?.discount?.maxBillDiscountPercent ?? 100)}
                    onApply={(d) => pos.setBillDiscount(d.discountPercent ? round2((soldNet * d.discountPercent) / 100) : d.discount)} onDone={focusScan} /></dd>
                </div>
              )}
              <div className="flex justify-between"><dt className="text-ink-500">Taxable</dt><dd className="tabular-nums">{inr(totals.taxable)}</dd></div>
              {interState ? <div className="flex justify-between"><dt className="text-ink-500">IGST</dt><dd className="tabular-nums">{inr(totals.igst)}</dd></div> : (
                <div className="flex justify-between"><dt className="text-ink-500">GST (CGST {inr(totals.cgst)} + SGST {inr(totals.sgst)})</dt><dd className="tabular-nums">{inr(totals.totalTax)}</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-ink-500">Round off</dt><dd className="tabular-nums">{inr(totals.roundOff)}</dd></div>
              {hasReturns && <div className="flex justify-between font-semibold text-rose-600"><dt>Returned items</dt><dd className="tabular-nums">{inr(returnTotal)}</dd></div>}
            </dl>
            <div className="mt-3 rounded-xl bg-ink-900 p-4 text-white dark:bg-black/40">
              <div className="text-xs uppercase tracking-widest text-ink-400">{totals.grandTotal < 0 ? 'Refund to customer' : 'Grand Total'}</div>
              <div className={clsx('text-4xl font-extrabold tabular-nums', totals.grandTotal < 0 && 'text-rose-300')}>{inr(Math.abs(totals.grandTotal))}</div>
              {!withGst ? <div className="text-[11px] font-semibold text-amber-300">Without GST</div> : settings?.tax?.taxInclusive && <div className="text-[11px] text-ink-400">Prices inclusive of GST</div>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" onClick={editBillDisc}><BadgePercent className="h-4 w-4" /> Bill disc <Kbd>B</Kbd></button>
              <button type="button" className="btn-secondary" onClick={hold}><PauseCircle className="h-4 w-4" /> Hold <Kbd>Alt+H</Kbd></button>
              <button type="button" className="btn-secondary" onClick={() => setModal('recall')}><History className="h-4 w-4" /> Recall <Kbd>Alt+R</Kbd></button>
              <button type="button" className="btn-secondary" onClick={() => printLast()}><Printer className="h-4 w-4" /> Print <Kbd>F3</Kbd></button>
              <button type="button" className="btn-secondary col-span-2" onClick={newBill}><FilePlus2 className="h-4 w-4" /> New bill <Kbd>F1</Kbd></button>
            </div>
            <div className="flex-1" />
            <button type="button" className="btn-primary btn-lg mt-3 w-full py-4 text-lg" onClick={openPay} disabled={!items.length}><CreditCard className="h-5 w-5" /> {totals.grandTotal < 0 ? `Refund ${inr(-totals.grandTotal)}` : `Pay ${inr(totals.grandTotal)}`} <Kbd>Alt+P</Kbd></button>
          </div>
        </div>
      </div>

      <VariantSearchModal open={modal === 'search'} initialQuery={searchInit} onClose={closeModal} onPick={(v) => { addVariant(v); closeModal(); }} />
      <CustomerModal open={modal === 'customer'} onClose={closeModal} onPick={(c) => { pos.setCustomer(c); closeModal(); }} onNew={(q) => { setNewCustInit(q); setModal('newCustomer'); }} />
      <NewCustomerModal open={modal === 'newCustomer'} initial={newCustInit} onClose={closeModal} onCreated={(c) => { pos.setCustomer(c); closeModal(); }} />
      <RecallModal open={modal === 'recall'} onClose={closeModal} onRecall={recall} />
      <PaymentModal open={modal === 'pay'} onClose={closeModal} total={totals.grandTotal} customer={customer} settings={settings} onComplete={complete} busy={paying} />
      <NumberModal open={modal === 'qty'} title={sel?.qty < 0 ? 'Returned Quantity' : 'Change Quantity'} label={sel ? `${sel.productName} ${variantLabel(sel)} (stock ${sel.stock ?? '-'})` : ''} initial={sel ? Math.abs(sel.qty) : ''} onClose={closeModal}
        onSubmit={(q) => {
          if (sel.qty < 0) { pos.updateLine(selected, { qty: -q }); closeModal(); return null; } // return line keeps its minus sign
          const others = items.filter((x, i) => x.variantId === sel.variantId && x.qty > 0 && i !== selected).reduce((a, x) => a + x.qty, 0);
          if (!allowNegative && sel.stock != null && q + others > sel.stock) return toast.error(`Only ${sel.stock} in stock`);
          pos.updateLine(selected, { qty: q });
          closeModal();
          return null;
        }} />
      <NumberModal open={modal === 'rate'} title="Change Selling Price" integer={false} label={sel ? `${sel.productName} · MRP ${inr(sel.mrp)} · Std ${inr(sel.originalRate)}` : ''} initial={sel?.rate} onClose={closeModal}
        onSubmit={(r) => {
          if (sel.mrp && r > sel.mrp) return toast.error('Rate cannot exceed MRP');
          pos.updateLine(selected, { rate: round2(r) });
          closeModal();
          return null;
        }} />
      <DiscountModal open={modal === 'disc'} line={sel} maxPct={maxPct} onClose={closeModal} onSubmit={(d) => { pos.updateLine(selected, d); closeModal(); }} />
      <DiscountModal open={modal === 'billDisc'} title="Bill Discount" line={{ discount: billDiscount }} base={soldNet}
        maxPct={Math.min(maxPct, settings?.discount?.maxBillDiscountPercent ?? 100)} onClose={closeModal}
        onSubmit={(d) => { pos.setBillDiscount(d.discountPercent ? round2((soldNet * d.discountPercent) / 100) : d.discount); closeModal(); }} />
      <OldBillReturnModal open={modal === 'oldReturn'} onClose={closeModal} cartItems={items} settings={settings} canOverride={can('sale.cancel')} onAdd={addOldReturns} />
      <RefundModal open={modal === 'refund'} amount={-totals.grandTotal} customer={customer} settings={settings} busy={paying} onClose={closeModal} onComplete={(mode) => complete([], mode)} />
      <NotFoundModal code={notFound} onClose={() => { setNotFound(null); focusScan(); }}
        onCreate={() => { const c = notFound; setNotFound(null); navigate(`/products/new?barcode=${encodeURIComponent(c)}&return=/pos`); }}
        onSearch={() => { setSearchInit(''); setNotFound(null); setModal('search'); }} />
      <SuccessModal data={success} onClose={() => { setSuccess(null); focusScan(); }} onPrint={(format) => printLast(format)} />
      <Modal open={modal === 'help'} onClose={closeModal} title="Keyboard Shortcuts" size="md">
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {SHORTCUTS.map(([k, d]) => <div key={k} className="flex items-center justify-between gap-2 text-sm"><span className="text-ink-600 dark:text-ink-300">{d}</span><Kbd>{k}</Kbd></div>)}
        </div>
      </Modal>
    </div>
  );
}
