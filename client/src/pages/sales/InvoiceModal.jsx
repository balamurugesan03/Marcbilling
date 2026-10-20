import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Printer, Ban, Pencil, Copy, FileText } from 'lucide-react';
import { get, post, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { printReceipt } from '../../lib/print';
import { Modal, Loading, StatusBadge } from '../../components/ui';
import { AsyncSelect, fetchCustomers } from '../../components/common';
import { inr, fdatetime, PAYMENT_LABELS } from '../../lib/format';

function EditSale({ inv, onClose, onSaved }) {
  const { sale } = inv;
  const [customer, setCustomer] = useState(sale.customerId ? { value: sale.customerId, label: `${sale.customer?.name} · ${sale.customer?.mobile}` } : null);
  const [notes, setNotes] = useState(sale.notes || '');
  const editable = sale.payments.filter((p) => ['cash', 'card', 'upi', 'bank'].includes(p.mode));
  const [pays, setPays] = useState(editable.map((p) => ({ ...p })));
  const total = editable.reduce((a, p) => a + p.amount, 0);
  const save = async () => {
    try {
      const body = { notes, customerId: customer?.value || null };
      if (editable.length) body.payments = pays.map((p) => ({ mode: p.mode, amount: Number(p.amount), reference: p.reference }));
      const d = await put(`/sales/${sale._id}`, body);
      toast.success('Bill updated');
      onSaved(d);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${sale.invoiceNumber}`} size="md" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={save}>Save changes</button></>}>
      <div className="space-y-4">
        <AsyncSelect label="Customer" value={customer?.value} displayValue={customer?.label} onChange={setCustomer} fetcher={fetchCustomers} placeholder="Walk-in customer" />
        {editable.length > 0 && (
          <div>
            <div className="label">Payment mode correction (total must remain {inr(total)})</div>
            {pays.map((p, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <select className="input w-32" value={p.mode} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))}>{['cash', 'card', 'upi', 'bank'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select>
                <input type="number" className="input" value={p.amount} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <input className="input" placeholder="Reference" value={p.reference || ''} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPays([...pays, { mode: 'upi', amount: 0 }])}>+ Add split</button>
          </div>
        )}
        <label className="block"><span className="label">Notes</span><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <p className="text-xs text-ink-500">Item changes are done through Sales Return or Exchange so stock stays accurate.</p>
      </div>
    </Modal>
  );
}

export default function InvoiceModal({ id, onClose, onChanged }) {
  const can = useAuth((s) => s.can);
  const [inv, setInv] = useState(null);
  const [edit, setEdit] = useState(false);
  useEffect(() => { if (id) get(`/sales/${id}`).then(setInv).catch((e) => { toast.error(errMsg(e)); onClose(); }); }, [id]);
  if (!id) return null;
  const print = async (format, duplicate = false) => {
    await printReceipt(inv, { format, duplicate });
    post(`/sales/${inv.sale._id}/printed${duplicate ? '?duplicate=true' : ''}`).catch(() => {});
  };
  const cancel = async () => {
    const reason = await confirm({ title: `Cancel bill ${inv.sale.invoiceNumber}?`, message: 'Stock will be returned, payments refunded and loyalty reversed. This cannot be undone.', input: true, placeholder: 'Reason for cancellation', danger: true, confirmText: 'Cancel bill' });
    if (!reason) return;
    try {
      await post(`/sales/${inv.sale._id}/cancel`, { reason });
      toast.success('Bill cancelled');
      setInv(await get(`/sales/${id}`));
      onChanged?.();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const s = inv?.sale;
  return (
    <Modal open onClose={onClose} title={s ? `Invoice ${s.invoiceNumber}` : 'Invoice'} size="xl"
      footer={s && <>
        {can('sale.edit') && s.status === 'completed' && <button type="button" className="btn-secondary mr-auto" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> Edit</button>}
        {can('sale.cancel') && s.status === 'completed' && s.returnStatus === 'none' && s.saleType === 'sale' && <button type="button" className="btn-danger" onClick={cancel}><Ban className="h-4 w-4" /> Cancel bill</button>}
        <button type="button" className="btn-secondary" onClick={() => print('thermal')}><Printer className="h-4 w-4" /> Reprint receipt</button>
        <button type="button" className="btn-secondary" onClick={() => print('a4')}><FileText className="h-4 w-4" /> A4 invoice</button>
        <button type="button" className="btn-secondary" onClick={() => print(undefined, true)}><Copy className="h-4 w-4" /> Duplicate</button>
      </>}>
      {!inv ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div><div className="label">Date</div>{fdatetime(s.createdAt)}</div>
            <div><div className="label">Branch / Cashier</div>{inv.branch?.name} · {s.cashierName}</div>
            <div><div className="label">Customer</div>{s.customer?.name || 'Walk-in'} {s.customer?.mobile && <span className="text-ink-500">({s.customer.mobile})</span>}</div>
            <div><div className="label">Status</div><div className="flex gap-1"><StatusBadge status={s.status} />{s.returnStatus !== 'none' && <StatusBadge status={s.returnStatus} label={`${s.returnStatus} return`} />}{s.saleType === 'exchange' && <StatusBadge status="exchange" />}</div></div>
          </div>
          {s.status === 'cancelled' && <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">Cancelled on {fdatetime(s.cancelledAt)} — {s.cancelReason}</div>}
          <div className="table-wrap rounded-lg border border-ink-100 dark:border-ink-800">
            <table className="tbl">
              <thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Size</th><th>Color</th><th className="num">Qty</th><th className="num">Returned</th><th className="num">Rate</th><th className="num">Disc</th><th className="num">GST</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {inv.items.map((i, n) => (
                  <tr key={i._id}><td>{n + 1}</td><td className="font-medium">{i.productName}</td><td className="font-mono text-xs">{i.sku}</td><td>{i.size}</td><td>{i.color}</td><td className="num">{i.qty}</td><td className="num">{i.returnedQty || '-'}</td><td className="num">{inr(i.rate)}</td><td className="num">{inr(i.discount)}</td><td className="num">{i.gstRate}%</td><td className="num font-semibold">{inr(i.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <div className="label">Payments</div>
              {s.payments.map((p, i) => <div key={i} className="flex justify-between"><span>{PAYMENT_LABELS[p.mode]} {p.reference && <span className="text-ink-500">({p.reference})</span>}</span><span className="tabular-nums">{inr(p.amount)}</span></div>)}
              {s.changeReturned > 0 && <div className="flex justify-between text-ink-500"><span>Change returned</span><span>{inr(s.changeReturned)}</span></div>}
              {s.creditAmount > 0 && <div className="flex justify-between text-rose-600"><span>Credit outstanding</span><span>{inr(s.creditAmount)}</span></div>}
              {inv.returns?.length > 0 && <div className="pt-2"><div className="label">Returns</div>{inv.returns.map((r) => <div key={r._id} className="flex justify-between text-xs"><span>{r.returnNo} · {r.type} · {fdatetime(r.createdAt)}</span><span>{inr(r.amount)}</span></div>)}</div>}
            </div>
            <dl className="space-y-1 rounded-lg bg-ink-50 p-3 text-sm dark:bg-ink-800/50">
              {[['Subtotal', s.totals.subtotal], ['Discount', -s.totals.discount], ['Taxable', s.totals.taxable], ['CGST', s.totals.cgst], ['SGST', s.totals.sgst], ['IGST', s.totals.igst], ['Round off', s.totals.roundOff]].map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-ink-500">{k}</dt><dd className="tabular-nums">{inr(v)}</dd></div>)}
              <div className="flex justify-between border-t border-ink-200 pt-1 text-base font-bold dark:border-ink-700"><dt>Grand Total</dt><dd className="tabular-nums">{inr(s.totals.grandTotal)}</dd></div>
            </dl>
          </div>
          {edit && <EditSale inv={inv} onClose={() => setEdit(false)} onSaved={(d) => { setInv(d); setEdit(false); onChanged?.(); }} />}
        </div>
      )}
    </Modal>
  );
}
