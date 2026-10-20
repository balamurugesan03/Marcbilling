import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeftRight, Trash2, CheckCircle2, Printer } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader, DataTable, ScanInput } from '../../components/common';
import { Tabs, Modal } from '../../components/ui';
import { inr, fdatetime, round2, variantLabel, PAYMENT_LABELS } from '../../lib/format';
import { computeTotals, isInterState } from '../../lib/gst';
import { printReceipt } from '../../lib/print';
import { InvoiceFinder, BillSummary, ReturnItemsTable, returnValue } from './ReturnParts';

export default function Exchange() {
  const { settings, can } = useAuth();
  const branch = useAuth((s) => s.currentBranch());
  const [tab, setTab] = useState('new');
  const [inv, setInv] = useState(null);
  const [sel, setSel] = useState({});
  const [newItems, setNewItems] = useState([]);
  const [payMode, setPayMode] = useState('cash');
  const [payRef, setPayRef] = useState('');
  const [refundMode, setRefundMode] = useState('store_credit');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const retVal = inv ? returnValue(inv.items, sel) : 0;
  const customer = inv?.sale.customer ? { stateCode: undefined, gstNumber: inv.sale.customer.gstNumber } : null;
  const { totals } = useMemo(() => computeTotals(newItems, { taxInclusive: settings?.tax?.taxInclusive ?? true, interState: isInterState(settings?.tax, branch, customer) }), [newItems, settings, branch]);
  const diff = round2(totals.grandTotal - retVal);

  const addItem = (v) => {
    if (!settings?.stock?.allowNegativeStock && (v.stock ?? 0) <= newItems.filter((i) => i.variantId === v._id).reduce((a, i) => a + i.qty, 0)) return toast.error(`Out of stock: ${v.productName} ${variantLabel(v)}`);
    const idx = newItems.findIndex((i) => i.variantId === v._id);
    if (idx >= 0) setNewItems(newItems.map((i, j) => (j === idx ? { ...i, qty: i.qty + 1 } : i)));
    else setNewItems([...newItems, { variantId: v._id, productName: v.productName, sku: v.sku, size: v.size, color: v.color, qty: 1, rate: v.sellingPrice, mrp: v.mrp, gstRate: v.gstRate, stock: v.stock }]);
    return null;
  };

  const submit = async () => {
    const returnItems = Object.entries(sel).filter(([, q]) => q > 0).map(([saleItemId, qty]) => ({ saleItemId, qty }));
    if (!returnItems.length) return toast.error('Select the item being returned');
    if (!newItems.length) return toast.error('Scan the exchange product');
    if (!reason.trim()) return toast.error('Enter a reason');
    setBusy(true);
    try {
      const ex = await post('/exchanges', {
        saleId: inv.sale._id, returnItems, reason,
        newItems: newItems.map((i) => ({ variantId: i.variantId, qty: i.qty })),
        payments: diff > 0 ? [{ mode: payMode, amount: diff, reference: payRef || undefined }] : [],
        refundMode: diff < 0 ? refundMode : undefined,
      });
      setDone(ex);
      setInv(null); setSel({}); setNewItems([]); setReason(''); setPayRef('');
    } catch (e) { toast.error(errMsg(e), { duration: 5000 }); } finally { setBusy(false); }
    return null;
  };

  return (
    <div>
      <PageHeader icon={ArrowLeftRight} title="Exchange" subtitle="Return an item from the original bill and issue another (e.g. size M → L). Price difference is collected or refunded." />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'new', label: 'New exchange' }, { value: 'history', label: 'Exchange history' }]} /></div>
      {tab === 'new' ? (
        <div className="space-y-4">
          <InvoiceFinder onLoad={(d) => { setInv(d); setSel({}); setNewItems([]); }} />
          {inv && (
            <>
              <div className="card card-pad space-y-3">
                <div className="section-title">1. Select returned product</div>
                <BillSummary inv={inv} />
                <ReturnItemsTable items={inv.items} value={sel} onChange={setSel} />
              </div>
              <div className="card card-pad space-y-3">
                <div className="section-title">2. Scan exchange (new) product</div>
                <ScanInput onVariant={addItem} autoFocus={false} />
                {newItems.length > 0 && (
                  <table className="tbl">
                    <thead><tr><th>Product</th><th>Variant</th><th className="num">Stock</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr></thead>
                    <tbody>
                      {newItems.map((i, n) => (
                        <tr key={i.variantId}>
                          <td className="font-medium">{i.productName}<div className="font-mono text-[11px] text-ink-500">{i.sku}</div></td>
                          <td>{variantLabel(i)}</td><td className="num">{i.stock}</td>
                          <td className="num"><input type="number" min={1} className="input input-sm w-16 text-right" value={i.qty} onChange={(e) => setNewItems(newItems.map((x, j) => (j === n ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))} /></td>
                          <td className="num">{inr(i.rate)}</td><td className="num font-semibold">{inr(i.qty * i.rate)}</td>
                          <td><button type="button" className="text-ink-400 hover:text-rose-600" onClick={() => setNewItems(newItems.filter((_, j) => j !== n))}><Trash2 className="h-4 w-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card card-pad grid gap-4 md:grid-cols-[1fr_320px]">
                <div className="space-y-3">
                  <div className="section-title">3. Settle difference</div>
                  <label className="block"><span className="label">Reason *</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Size change, colour change…" /></label>
                  {diff > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      <label><span className="label">Customer pays via</span><select className="input" value={payMode} onChange={(e) => setPayMode(e.target.value)}>{['cash', 'card', 'upi', 'bank'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
                      <label><span className="label">Reference</span><input className="input" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></label>
                    </div>
                  )}
                  {diff < 0 && (
                    <label className="block"><span className="label">Balance to customer as</span>
                      <select className="input" value={refundMode} onChange={(e) => setRefundMode(e.target.value)}>
                        {inv.sale.customerId && <option value="store_credit">Store credit (credit note)</option>}
                        {['cash', 'card', 'upi', 'bank'].map((m) => <option key={m} value={m}>Refund in {PAYMENT_LABELS[m]}</option>)}
                      </select>
                    </label>
                  )}
                  {!can('sale.price_change') && <p className="text-xs text-ink-500">New items are billed at their current selling price.</p>}
                </div>
                <div className="space-y-1.5 rounded-xl bg-ink-900 p-4 text-sm text-white">
                  <div className="flex justify-between"><span className="text-ink-400">Returned value</span><span className="tabular-nums">{inr(retVal)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-400">New items</span><span className="tabular-nums">{inr(totals.grandTotal)}</span></div>
                  <div className="border-t border-white/10 pt-2 text-xs uppercase text-ink-400">{diff > 0 ? 'Customer pays' : diff < 0 ? 'Refund / store credit' : 'Even exchange'}</div>
                  <div className={`text-3xl font-extrabold tabular-nums ${diff < 0 ? 'text-emerald-300' : ''}`}>{inr(Math.abs(diff < 0 ? Math.round(-diff) : diff))}</div>
                  <button type="button" className="btn-success mt-2 w-full" disabled={busy || !retVal || !newItems.length} onClick={submit}><CheckCircle2 className="h-4 w-4" /> Complete exchange</button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <DataTable url="/exchanges" columns={[
          { key: 'exchangeNo', label: 'Exchange No', render: (r) => <span className="font-mono text-xs font-semibold">{r.exchangeNo}</span> },
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'originalInvoice', label: 'Original bill', render: (r) => <span className="font-mono text-xs">{r.originalInvoice}</span> },
          { key: 'newInvoice', label: 'New bill', render: (r) => <span className="font-mono text-xs">{r.newInvoice}</span> },
          { key: 'customerName', label: 'Customer', render: (r) => r.customerName || 'Walk-in' },
          { key: 'returnValue', label: 'Returned', num: true, render: (r) => inr(r.returnValue) },
          { key: 'newValue', label: 'Issued', num: true, render: (r) => inr(r.newValue) },
          { key: 'difference', label: 'Difference', num: true, render: (r) => <b className={r.difference < 0 ? 'text-emerald-600' : ''}>{inr(r.difference)}</b> },
          { key: 'settlement', label: 'Settlement', render: (r) => r.settlement?.replace('_', ' ') },
        ]} />
      )}
      <Modal open={Boolean(done)} onClose={() => setDone(null)} size="sm">
        {done && (
          <div className="py-2 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
            <div className="text-lg font-bold">Exchange {done.exchangeNo} completed</div>
            <div className="mt-1 text-sm text-ink-500">Return {done.returnNo} · New bill {done.newInvoice}</div>
            <div className="mt-2 text-sm">{done.difference > 0 ? `Collected ${inr(done.difference)}` : done.difference < 0 ? `${done.settlement === 'store_credit' ? 'Store credit' : 'Refunded'} ${inr(Math.round(-done.difference))}` : 'Even exchange'}</div>
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" className="btn-secondary" onClick={() => printReceipt(done.newInvoiceData)}><Printer className="h-4 w-4" /> Print new bill</button>
              <button type="button" className="btn-primary" onClick={() => setDone(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
