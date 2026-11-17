import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Undo2, CheckCircle2, Printer } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader, DataTable } from '../../components/common';
import { Tabs, Modal, StatusBadge } from '../../components/ui';
import { inr, fdatetime, PAYMENT_LABELS } from '../../lib/format';
import { printHtml, simpleDocHtml } from '../../lib/print';
import { InvoiceFinder, BillSummary, ReturnItemsTable, returnValue } from './ReturnParts';

export default function SalesReturn() {
  const [tab, setTab] = useState('new');
  const [inv, setInv] = useState(null);
  const [sel, setSel] = useState({});
  const [refundMode, setRefundMode] = useState('cash');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const company = useAuth((s) => s.company);
  // F2 (from any page) opens a blank return form
  const fresh = useLocation().state?.fresh;
  useEffect(() => {
    if (!fresh) return;
    setTab('new'); setInv(null); setSel({}); setReason(''); setRefundMode('cash'); setDone(null);
  }, [fresh]);
  const value = inv ? returnValue(inv.items, sel) : 0;
  const refund = Math.round(value);
  const hasCustomer = Boolean(inv?.sale.customerId);

  const submit = async () => {
    const items = Object.entries(sel).filter(([, q]) => q > 0).map(([saleItemId, qty]) => ({ saleItemId, qty }));
    if (!items.length) return toast.error('Enter return quantity');
    if (!reason.trim()) return toast.error('Enter a reason for the return');
    setBusy(true);
    try {
      const r = await post('/returns', { saleId: inv.sale._id, items, refundMode, reason });
      setDone(r);
      setInv(null);
      setSel({});
      setReason('');
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    return null;
  };
  const printNote = (r) => printHtml(simpleDocHtml({
    title: `Sales Return / Credit Note ${r.returnNo}`, company, subtitle: `Against invoice ${r.invoiceNumber}`,
    meta: [['Date', fdatetime(r.createdAt)], ['Customer', r.customerName || 'Walk-in'], ['Refund mode', PAYMENT_LABELS[r.refundMode] || r.refundMode], ['Reason', r.reason || '-']],
    columns: [{ key: 'productName', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'size', label: 'Size' }, { key: 'color', label: 'Color' }, { key: 'qty', label: 'Qty', right: true }, { key: 'amt', label: 'Amount', right: true }],
    rows: r.items.map((i) => ({ ...i, amt: inr(i.amount) })),
    totals: [['Taxable', inr(r.taxable)], ['GST', inr(r.totalTax)], ['Refund', inr(r.refundAmount)]],
  }));

  return (
    <div>
      <PageHeader icon={Undo2} title="Sales Return" subtitle="Full or partial return against the original bill. Returned stock is added back to this branch." />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'new', label: 'New return' }, { value: 'history', label: 'Return history' }]} /></div>
      {tab === 'new' ? (
        <div className="space-y-4">
          <InvoiceFinder key={fresh} onLoad={(d) => { setInv(d); setSel({}); setRefundMode('cash'); }} />
          {inv && (
            <div className="card card-pad space-y-4">
              <BillSummary inv={inv} />
              <ReturnItemsTable items={inv.items} value={sel} onChange={setSel} />
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_280px]">
                <label><span className="label">Refund mode</span>
                  <select className="input" value={refundMode} onChange={(e) => setRefundMode(e.target.value)}>
                    {['cash', 'card', 'upi', 'bank'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                    {hasCustomer && <option value="store_credit">Store credit (credit note)</option>}
                    {hasCustomer && <option value="adjust_outstanding">Adjust customer outstanding</option>}
                  </select>
                </label>
                <label><span className="label">Reason *</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Size issue, defect, customer changed mind…" /></label>
                <div className="rounded-xl bg-ink-900 p-4 text-white">
                  <div className="text-xs uppercase text-ink-400">Refund amount</div>
                  <div className="text-3xl font-extrabold tabular-nums">{inr(refund)}</div>
                  <button type="button" className="btn-success mt-3 w-full" disabled={busy || !value || inv.sale.status !== 'completed'} onClick={submit}><CheckCircle2 className="h-4 w-4" /> Complete return</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <DataTable url="/returns" params={{ type: 'return' }} columns={[
          { key: 'returnNo', label: 'Return No', render: (r) => <span className="font-mono text-xs font-semibold">{r.returnNo}</span> },
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'invoiceNumber', label: 'Invoice', render: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span> },
          { key: 'customerName', label: 'Customer', render: (r) => r.customerName || 'Walk-in' },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'totalQty', label: 'Qty', num: true },
          { key: 'refundMode', label: 'Refund', render: (r) => <StatusBadge status="return" label={PAYMENT_LABELS[r.refundMode] || r.refundMode} /> },
          { key: 'refundAmount', label: 'Amount', num: true, render: (r) => <b>{inr(r.refundAmount)}</b> },
          { key: 'p', label: '', render: (r) => <button type="button" className="btn-ghost btn-sm" onClick={() => printNote(r)}><Printer className="h-3.5 w-3.5" /></button> },
        ]} />
      )}
      <Modal open={Boolean(done)} onClose={() => setDone(null)} size="sm">
        {done && (
          <div className="py-2 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
            <div className="text-lg font-bold">Return {done.returnNo} completed</div>
            <div className="mt-1 text-sm text-ink-500">Refund {inr(done.refundAmount)} via {PAYMENT_LABELS[done.refundMode] || done.refundMode}. Stock updated.</div>
            <div className="mt-4 flex justify-center gap-2"><button type="button" className="btn-secondary" onClick={() => printNote(done)}><Printer className="h-4 w-4" /> Print credit note</button><button type="button" className="btn-primary" onClick={() => setDone(null)}>Done</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
