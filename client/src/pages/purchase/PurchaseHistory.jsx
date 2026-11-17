import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Truck, Plus, PackageCheck, Pencil, Ban, Wallet, Undo2, Printer, Tag } from 'lucide-react';
import { get, post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox, DateRange, defaultRange } from '../../components/common';
import { Modal, Loading, StatusBadge } from '../../components/ui';
import { inr, fdate, fdatetime, PAYMENT_LABELS, variantLabel } from '../../lib/format';
import { printHtml, simpleDocHtml } from '../../lib/print';
import { ReturnForm } from './PurchaseReturns';

function PayModal({ purchase, onClose, onDone }) {
  const [f, setF] = useState({ amount: purchase.dueAmount, mode: 'bank', reference: '' });
  const submit = async () => {
    try {
      await post('/payments/supplier-payment', { supplierId: purchase.supplierId, purchaseId: purchase._id, amount: Number(f.amount), mode: f.mode, reference: f.reference || undefined }, { headers: { 'x-branch-id': purchase.branchId } });
      toast.success('Payment recorded');
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Pay supplier · ${purchase.supplierName}`} size="sm" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit}>Record payment</button></>}>
      <div className="space-y-3">
        <div className="text-sm">Due on {purchase.purchaseNo}: <b>{inr(purchase.dueAmount)}</b></div>
        <label className="block"><span className="label">Amount</span><input type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="block"><span className="label">Mode</span><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{['bank', 'cash', 'upi', 'card'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
        <label className="block"><span className="label">Reference / cheque no</span><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      </div>
    </Modal>
  );
}

export function PurchaseDetail({ id, onClose, onChanged }) {
  const { can, company } = useAuth();
  const navigate = useNavigate();
  const [p, setP] = useState(null);
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const load = () => get(`/purchases/${id}`).then(setP).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [id]);
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); await load(); onChanged?.(); } catch (e) { toast.error(errMsg(e)); } };
  const receive = async () => {
    if (!(await confirm({ title: `Receive ${p.purchaseNo}?`, message: `${p.totals.totalQty} pcs will be added to ${p.branchName} stock.`, confirmText: 'Receive stock' }))) return;
    act(() => post(`/purchases/${id}/receive`, { updatePrices: true }, { headers: { 'x-branch-id': p.branchId } }), 'Stock received');
  };
  const cancel = async () => {
    const reason = await confirm({ title: 'Cancel draft purchase?', input: true, placeholder: 'Reason', danger: true, confirmText: 'Cancel purchase' });
    if (reason) act(() => post(`/purchases/${id}/cancel`, { reason }), 'Purchase cancelled');
  };
  const print = () => printHtml(simpleDocHtml({
    title: `Purchase ${p.purchaseNo}`, company, subtitle: `${p.branchName} branch`,
    meta: [['Supplier', p.supplierName], ['Supplier invoice', p.invoiceNumber], ['Invoice date', fdate(p.invoiceDate)], ['Status', p.status], ['Paid', inr(p.paidAmount)], ['Due', inr(p.dueAmount)]],
    columns: [{ key: 'productName', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'v', label: 'Variant' }, { key: 'qty', label: 'Qty', right: true }, { key: 'r', label: 'Rate', right: true }, { key: 'g', label: 'GST%', right: true }, { key: 'a', label: 'Amount', right: true }],
    rows: p.items.map((i) => ({ ...i, v: variantLabel(i), r: inr(i.rate), g: i.gstRate, a: inr(i.amount) })),
    totals: [['Taxable', inr(p.totals.taxable)], ['GST', inr(p.totals.totalTax)], ['Total', inr(p.totals.grandTotal)]],
  }));
  return (
    <Modal open onClose={onClose} title={p ? `Purchase ${p.purchaseNo}` : 'Purchase'} size="xl"
      footer={p && <>
        <button type="button" className="btn-secondary mr-auto" onClick={print}><Printer className="h-4 w-4" /> Print</button>
        {can('barcode.print') && <button type="button" className="btn-secondary" onClick={() => navigate('/products/labels', { state: { variants: p.items.map((i) => ({ _id: i.variantId, productName: i.productName, sku: i.sku, barcode: i.barcode, size: i.size, color: i.color, mrp: i.mrp, sellingPrice: i.sellingPrice, qty: i.qty })) } })}><Tag className="h-4 w-4" /> Print labels</button>}
        {p.status === 'draft' && <>
          {can('purchase.delete') && <button type="button" className="btn-danger" onClick={cancel}><Ban className="h-4 w-4" /> Cancel</button>}
          {can('purchase.edit') && <button type="button" className="btn-secondary" onClick={() => navigate(`/purchase/${id}/edit`)}><Pencil className="h-4 w-4" /> Edit</button>}
          {can('purchase.create', 'purchase.edit') && <button type="button" className="btn-primary" onClick={receive}><PackageCheck className="h-4 w-4" /> Receive stock</button>}
        </>}
        {p.status === 'received' && can('purchase.return') && <button type="button" className="btn-secondary" onClick={() => setRet(true)}><Undo2 className="h-4 w-4" /> Return</button>}
        {p.status === 'received' && p.dueAmount > 0 && can('payment.create') && <button type="button" className="btn-primary" onClick={() => setPay(true)}><Wallet className="h-4 w-4" /> Pay</button>}
      </>}>
      {!p ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div><div className="label">Supplier</div><b>{p.supplierName}</b></div>
            <div><div className="label">Supplier invoice</div>{p.invoiceNumber} · {fdate(p.invoiceDate)}</div>
            <div><div className="label">Branch</div>{p.branchName}</div>
            <div><div className="label">Status</div><div className="flex gap-1"><StatusBadge status={p.status} />{p.status === 'received' && <StatusBadge status={p.paymentStatus} />}</div></div>
          </div>
          <div className="table-wrap rounded-lg border border-ink-100 dark:border-ink-800">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th className="num">Qty</th><th className="num">Returned</th><th className="num">Rate</th><th className="num">Disc</th><th className="num">GST</th><th className="num">Taxable</th><th className="num">Amount</th></tr></thead>
              <tbody>{p.items.map((i) => <tr key={i._id}><td className="font-medium">{i.productName}</td><td>{variantLabel(i)}</td><td className="font-mono text-xs">{i.sku}</td><td className="num">{i.qty}</td><td className="num">{i.returnedQty || '-'}</td><td className="num">{inr(i.rate)}</td><td className="num">{inr(i.discount)}</td><td className="num">{i.gstRate}%</td><td className="num">{inr(i.taxable)}</td><td className="num font-semibold">{inr(i.amount)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <div className="label">Payments</div>
              {p.payments.length ? p.payments.map((x) => <div key={x._id} className="flex justify-between"><span>{fdate(x.date)} · {PAYMENT_LABELS[x.mode]}</span><span>{inr(x.amount)}</span></div>) : <div className="text-ink-500">None</div>}
            </div>
            <div>
              <div className="label">Returns</div>
              {p.returns.length ? p.returns.map((r) => <div key={r._id} className="flex justify-between"><span>{r.returnNo} · {fdatetime(r.createdAt)}</span><span>{inr(r.amount)}</span></div>) : <div className="text-ink-500">None</div>}
            </div>
            <dl className="space-y-1 rounded-lg bg-ink-50 p-3 dark:bg-ink-800/50">
              {[['Taxable', p.totals.taxable], ['CGST', p.totals.cgst], ['SGST', p.totals.sgst], ['IGST', p.totals.igst], ['Total', p.totals.grandTotal], ['Paid', p.paidAmount], ['Returned', p.returnedAmount], ['Due', p.dueAmount]].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-ink-500">{k}</dt><dd className="tabular-nums">{inr(v)}</dd></div>)}
            </dl>
          </div>
          {pay && <PayModal purchase={p} onClose={() => setPay(false)} onDone={() => { setPay(false); load(); onChanged?.(); }} />}
          {ret && <ReturnForm purchase={p} onClose={() => setRet(false)} onDone={() => { setRet(false); load(); onChanged?.(); }} />}
        </div>
      )}
    </Modal>
  );
}

export default function PurchaseHistory() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [range, setRange] = useState(defaultRange());
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(location.state?.open || null);
  const [reloadKey, setReloadKey] = useState(0);
  const ds = useDebounce(search, 300);
  return (
    <div>
      <PageHeader icon={Truck} title="Purchase History" actions={can('purchase.create') && <button type="button" className="btn-primary" onClick={() => navigate('/purchase/new')}><Plus className="h-4 w-4" /> Purchase entry</button>} />
      <DataTable url="/purchases" params={{ search: ds, ...range, status }} reloadKey={reloadKey} onRowClick={(r) => setOpen(r._id)}
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} placeholder="Purchase no, supplier invoice, supplier" className="w-72" />
          <DateRange {...range} onChange={setRange} />
          <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All status</option><option value="draft">Draft</option><option value="received">Received</option><option value="cancelled">Cancelled</option></select>
        </>}
        columns={[
          { key: 'purchaseNo', label: 'Purchase No', render: (r) => <span className="font-mono text-xs font-semibold">{r.purchaseNo}</span> },
          { key: 'invoiceDate', label: 'Inv date', render: (r) => fdate(r.invoiceDate) },
          { key: 'invoiceNumber', label: 'Supplier inv' },
          { key: 'supplierName', label: 'Supplier' },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'qty', label: 'Qty', num: true, render: (r) => r.totals.totalQty },
          { key: 'total', label: 'Total', num: true, render: (r) => <b>{inr(r.totals.grandTotal)}</b> },
          { key: 'dueAmount', label: 'Due', num: true, render: (r) => (r.status === 'received' ? inr(r.dueAmount) : '-') },
          { key: 'status', label: 'Status', render: (r) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.status === 'received' && <StatusBadge status={r.paymentStatus} />}</div> },
        ]} />
      {open && <PurchaseDetail id={open} onClose={() => setOpen(null)} onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}
