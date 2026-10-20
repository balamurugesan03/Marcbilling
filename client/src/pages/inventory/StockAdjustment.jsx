import { useState } from 'react';
import toast from 'react-hot-toast';
import { SlidersHorizontal, Plus, Trash2 } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader, DataTable, ScanInput, BranchSelect, DateRange } from '../../components/common';
import { Modal, Empty } from '../../components/ui';
import { fdatetime, variantLabel, inr, titleCase } from '../../lib/format';

const TYPES = [
  { value: 'damage', label: 'Damage (−)' }, { value: 'missing', label: 'Missing (−)' }, { value: 'found', label: 'Found stock (+)' },
  { value: 'correction', label: 'Manual correction (±)' }, { value: 'opening', label: 'Opening stock (±)' },
];

function AdjustmentForm({ onClose, onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const [branch, setBranch] = useState(branchId !== 'all' ? branchId : '');
  const [type, setType] = useState('damage');
  const [mode, setMode] = useState('delta');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const signed = ['correction', 'opening'].includes(type);
  const add = (v) => {
    if (items.some((i) => i.variantId === v._id)) return setItems(items.map((i) => (i.variantId === v._id ? { ...i, qty: (Number(i.qty) || 0) + 1 } : i)));
    setItems([...items, { variantId: v._id, productName: v.productName, sku: v.sku, size: v.size, color: v.color, stock: v.stock ?? 0, qty: mode === 'set' ? v.stock ?? 0 : 1 }]);
    return null;
  };
  const submit = async () => {
    if (!branch) return toast.error('Select branch');
    if (!items.length) return toast.error('Add items');
    if (!reason.trim()) return toast.error('Enter reason');
    setBusy(true);
    try {
      const r = await post('/stock/adjustments', { branchId: branch, type, mode, reason, items: items.map((i) => ({ variantId: i.variantId, qty: Number(i.qty) })) });
      toast.success(`Adjustment ${r.adjustmentNo} saved`);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    return null;
  };
  return (
    <Modal open onClose={onClose} title="New Stock Adjustment" size="xl" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy} onClick={submit}>Save adjustment</button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <BranchSelect value={branch} onChange={(v) => { setBranch(v); setItems([]); }} />
        <label><span className="label">Type</span><select className="input" value={type} onChange={(e) => { setType(e.target.value); if (!['correction', 'opening'].includes(e.target.value)) setMode('delta'); }}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        <label><span className="label">Entry mode</span><select className="input" value={mode} disabled={!signed} onChange={(e) => setMode(e.target.value)}><option value="delta">Quantity change</option><option value="set">Physical count (set stock to)</option></select></label>
        <label><span className="label">Reason *</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Stock audit, torn, theft…" /></label>
      </div>
      <div className="mt-4">{branch ? <ScanInput onVariant={add} branchId={branch} /> : <div className="text-sm text-ink-500">Select a branch to add items.</div>}</div>
      {items.length ? (
        <table className="tbl mt-3">
          <thead><tr><th>Product</th><th>Variant</th><th className="num">Current</th><th className="num w-32">{mode === 'set' ? 'Counted qty' : signed ? 'Change (±)' : 'Qty'}</th><th className="num">After</th><th /></tr></thead>
          <tbody>
            {items.map((i, n) => {
              const q = Number(i.qty) || 0;
              const after = mode === 'set' ? q : i.stock + (signed ? q : (type === 'found' ? 1 : -1) * Math.abs(q));
              return (
                <tr key={i.variantId}>
                  <td className="font-medium">{i.productName}<div className="font-mono text-[10px] text-ink-500">{i.sku}</div></td><td>{variantLabel(i)}</td>
                  <td className="num">{i.stock}</td>
                  <td className="num"><input type="number" className="input input-sm w-24 text-right" value={i.qty} onChange={(e) => setItems(items.map((x, j) => (j === n ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td className={`num font-semibold ${after < 0 ? 'text-rose-600' : ''}`}>{after}</td>
                  <td><button type="button" className="text-ink-400 hover:text-rose-600" onClick={() => setItems(items.filter((_, j) => j !== n))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <Empty title="No items" />}
    </Modal>
  );
}

export default function StockAdjustment() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div>
      <PageHeader icon={SlidersHorizontal} title="Stock Adjustment" subtitle="Damage, missing, found stock, corrections and opening stock — every change is audited"
        actions={<button type="button" className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New adjustment</button>} />
      <DataTable url="/stock/adjustments" params={{ type, ...range }} reloadKey={reloadKey}
        toolbar={<><select className="input w-44" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select><DateRange {...range} onChange={setRange} /></>}
        columns={[
          { key: 'adjustmentNo', label: 'Adj No', render: (r) => <span className="font-mono text-xs font-semibold">{r.adjustmentNo}</span> },
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'type', label: 'Type', render: (r) => <span className="badge-gray">{titleCase(r.type)}</span> },
          { key: 'items', label: 'Items', render: (r) => <div className="max-w-md truncate text-xs">{r.items.map((i) => `${i.sku} (${i.qty > 0 ? '+' : ''}${i.qty})`).join(', ')}</div> },
          { key: 'totalQty', label: 'Net qty', num: true, render: (r) => <b className={r.totalQty < 0 ? 'text-rose-600' : 'text-emerald-600'}>{r.totalQty}</b> },
          { key: 'totalValue', label: 'Value', num: true, render: (r) => inr(r.totalValue) },
          { key: 'reason', label: 'Reason' },
          { key: 'userName', label: 'By' },
        ]} />
      {open && <AdjustmentForm onClose={() => setOpen(false)} onDone={() => { setOpen(false); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
