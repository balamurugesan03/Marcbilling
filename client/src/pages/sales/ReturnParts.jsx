import { useState } from 'react';
import toast from 'react-hot-toast';
import { FileSearch } from 'lucide-react';
import { get, errMsg } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { inr, fdatetime, round2 } from '../../lib/format';

/** Loads an original bill by invoice number. */
export function InvoiceFinder({ onLoad, autoFocus = true }) {
  const [no, setNo] = useState('');
  const [busy, setBusy] = useState(false);
  const find = async (e) => {
    e?.preventDefault();
    if (!no.trim()) return;
    setBusy(true);
    try {
      const inv = await get(`/sales/invoice/${encodeURIComponent(no.trim())}`);
      if (inv.sale.status !== 'completed') toast.error('This bill is cancelled');
      onLoad(inv);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={find} className="card flex flex-wrap items-end gap-2 p-4">
      <label className="min-w-[260px] flex-1"><span className="label">Original bill / invoice number (scan the barcode on the receipt)</span>
        <input autoFocus={autoFocus} className="input py-2.5 font-mono text-base" placeholder="INV-2026-000123" value={no} onChange={(e) => setNo(e.target.value)} />
      </label>
      <button className="btn-primary py-2.5" disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : <FileSearch className="h-4 w-4" />} Load bill</button>
    </form>
  );
}

export function BillSummary({ inv }) {
  const s = inv.sale;
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-4">
      <div><div className="label">Invoice</div><span className="font-mono font-semibold">{s.invoiceNumber}</span></div>
      <div><div className="label">Date</div>{fdatetime(s.createdAt)}</div>
      <div><div className="label">Customer</div>{s.customer?.name || 'Walk-in'} {s.customer?.mobile && <span className="text-ink-500">({s.customer.mobile})</span>}</div>
      <div><div className="label">Bill total</div><b>{inr(s.totals.grandTotal)}</b> <span className="text-ink-500">({inv.branch?.name})</span></div>
    </div>
  );
}

/** Table of sold items with return qty inputs; value = { [saleItemId]: qty } */
export function ReturnItemsTable({ items, value, onChange }) {
  const set = (id, q, max) => onChange({ ...value, [id]: Math.max(0, Math.min(max, Number(q) || 0)) });
  return (
    <div className="table-wrap rounded-lg border border-ink-100 dark:border-ink-800">
      <table className="tbl">
        <thead><tr><th>Product</th><th>Size</th><th>Color</th><th className="num">Sold</th><th className="num">Returned</th><th className="num">Unit value</th><th className="num w-36">Return qty</th><th className="num">Refund value</th></tr></thead>
        <tbody>
          {items.map((i) => {
            const max = i.qty - (i.returnedQty || 0);
            const unit = round2(i.amount / i.qty);
            const q = value[i._id] || 0;
            return (
              <tr key={i._id} className={max === 0 ? 'opacity-50' : ''}>
                <td className="font-medium">{i.productName}<div className="font-mono text-[11px] text-ink-500">{i.sku}</div></td>
                <td>{i.size}</td><td>{i.color}</td><td className="num">{i.qty}</td><td className="num">{i.returnedQty || 0}</td><td className="num">{inr(unit)}</td>
                <td className="num">
                  <div className="inline-flex items-center gap-1">
                    <input type="number" min={0} max={max} disabled={!max} className="input input-sm w-16 text-right" value={q || ''} placeholder="0" onChange={(e) => set(i._id, e.target.value, max)} />
                    <button type="button" className="btn-ghost btn-sm" disabled={!max} onClick={() => set(i._id, max, max)}>All</button>
                  </div>
                </td>
                <td className="num font-semibold">{q ? inr(round2(i.amount * (q / i.qty))) : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const returnValue = (items, sel) => round2(items.reduce((a, i) => a + (sel[i._id] ? (i.amount * sel[i._id]) / i.qty : 0), 0));
