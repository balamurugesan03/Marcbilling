import { useState } from 'react';
import toast from 'react-hot-toast';
import { Undo2, Search } from 'lucide-react';
import { get, post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader, DataTable, DateRange, defaultRange } from '../../components/common';
import { Modal } from '../../components/ui';
import { inr, fdatetime, round2, variantLabel, PAYMENT_LABELS } from '../../lib/format';

export function ReturnForm({ purchase, onClose, onDone }) {
  const [sel, setSel] = useState({});
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState('adjust');
  const [refundMode, setRefundMode] = useState('bank');
  const [busy, setBusy] = useState(false);
  const value = round2(purchase.items.reduce((a, i) => a + (sel[i._id] ? (i.amount * sel[i._id]) / i.qty : 0), 0));
  const submit = async () => {
    const items = Object.entries(sel).filter(([, q]) => q > 0).map(([purchaseItemId, qty]) => ({ purchaseItemId, qty }));
    if (!items.length) return toast.error('Enter return quantity');
    if (!reason.trim()) return toast.error('Enter reason');
    setBusy(true);
    try {
      const r = await post('/purchases/returns', { purchaseId: purchase._id, items, reason, settlement, refundMode: settlement === 'refund' ? refundMode : undefined });
      toast.success(`Purchase return ${r.returnNo} saved — stock reduced`);
      onDone(r);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    return null;
  };
  return (
    <Modal open onClose={onClose} title={`Purchase Return · ${purchase.purchaseNo} (${purchase.supplierName})`} size="xl"
      footer={<><span className="mr-auto text-sm">Return value <b>{inr(value)}</b></span><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" disabled={busy || !value} onClick={submit}>Save return</button></>}>
      <table className="tbl">
        <thead><tr><th>Product</th><th>Variant</th><th className="num">Purchased</th><th className="num">Returned</th><th className="num">Rate</th><th className="num w-28">Return qty</th><th className="num">Value</th></tr></thead>
        <tbody>
          {purchase.items.map((i) => {
            const max = i.qty - (i.returnedQty || 0);
            return (
              <tr key={i._id}>
                <td className="font-medium">{i.productName}<div className="font-mono text-[11px] text-ink-500">{i.sku}</div></td><td>{variantLabel(i)}</td>
                <td className="num">{i.qty}</td><td className="num">{i.returnedQty || 0}</td><td className="num">{inr(i.rate)}</td>
                <td className="num"><input type="number" min={0} max={max} disabled={!max} className="input input-sm w-20 text-right" value={sel[i._id] || ''} placeholder="0" onChange={(e) => setSel({ ...sel, [i._id]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) })} /></td>
                <td className="num">{sel[i._id] ? inr((i.amount * sel[i._id]) / i.qty) : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label><span className="label">Reason *</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged, wrong size, excess…" /></label>
        <label><span className="label">Settlement</span><select className="input" value={settlement} onChange={(e) => setSettlement(e.target.value)}><option value="adjust">Adjust against supplier payable</option><option value="refund">Supplier refunds money</option></select></label>
        {settlement === 'refund' && <label><span className="label">Refund mode</span><select className="input" value={refundMode} onChange={(e) => setRefundMode(e.target.value)}>{['bank', 'cash', 'upi', 'card'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>}
      </div>
      <p className="mt-2 text-xs text-ink-500">Returned quantity is deducted from {purchase.branchName} stock; it cannot exceed the stock available there.</p>
    </Modal>
  );
}

export default function PurchaseReturns() {
  const can = useAuth((s) => s.can);
  const [range, setRange] = useState(defaultRange());
  const [no, setNo] = useState('');
  const [purchase, setPurchase] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const find = async (e) => {
    e.preventDefault();
    try {
      const list = await get('/purchases', { search: no.trim(), status: 'received', limit: 1 });
      if (!list.items.length) return toast.error('No received purchase found');
      setPurchase(await get(`/purchases/${list.items[0]._id}`));
    } catch (err) { toast.error(errMsg(err)); }
    return null;
  };
  return (
    <div>
      <PageHeader icon={Undo2} title="Purchase Return" subtitle="Return goods to supplier — decreases stock and supplier payable" />
      {can('purchase.manage') && (
        <form onSubmit={find} className="card mb-4 flex flex-wrap items-end gap-2 p-4">
          <label className="min-w-[260px] flex-1"><span className="label">Purchase no / supplier invoice no</span><input className="input" value={no} onChange={(e) => setNo(e.target.value)} placeholder="PUR-2026-00001" /></label>
          <button className="btn-primary"><Search className="h-4 w-4" /> Find purchase</button>
        </form>
      )}
      <DataTable url="/purchases/returns" params={range} reloadKey={reloadKey} toolbar={<DateRange {...range} onChange={setRange} />}
        columns={[
          { key: 'returnNo', label: 'Return No', render: (r) => <span className="font-mono text-xs font-semibold">{r.returnNo}</span> },
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'purchaseNo', label: 'Purchase', render: (r) => <span className="font-mono text-xs">{r.purchaseNo}</span> },
          { key: 'supplierName', label: 'Supplier' },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'totalQty', label: 'Qty', num: true },
          { key: 'amount', label: 'Amount', num: true, render: (r) => <b>{inr(r.amount)}</b> },
          { key: 'settlement', label: 'Settlement', render: (r) => (r.settlement === 'refund' ? `Refund (${PAYMENT_LABELS[r.refundMode]})` : 'Adjusted') },
          { key: 'reason', label: 'Reason' },
        ]} />
      {purchase && <ReturnForm purchase={purchase} onClose={() => setPurchase(null)} onDone={() => { setPurchase(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
