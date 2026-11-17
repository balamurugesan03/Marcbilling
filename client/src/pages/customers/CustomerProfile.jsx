import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { User, Pencil, Wallet, Gift, ArrowLeft } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useFetch } from '../../hooks';
import { PageHeader, StatCard } from '../../components/common';
import { Loading, Tabs, StatusBadge, Modal, Empty } from '../../components/ui';
import { inr, fdate, fdatetime, PAYMENT_LABELS } from '../../lib/format';
import CustomerForm from './CustomerForm';
import InvoiceModal from '../sales/InvoiceModal';

function ReceiptModal({ customer, onClose, onDone }) {
  const [f, setF] = useState({ amount: customer.outstanding, mode: 'cash', reference: '' });
  const submit = async () => {
    try {
      await post('/payments/customer-receipt', { customerId: customer._id, amount: Number(f.amount), mode: f.mode, reference: f.reference || undefined });
      toast.success('Payment received');
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={`Receive payment · ${customer.name}`} size="sm" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit}>Receive</button></>}>
      <div className="space-y-3">
        <div className="text-sm">Outstanding: <b className="text-rose-600">{inr(customer.outstanding)}</b></div>
        <label className="block"><span className="label">Amount</span><input type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="block"><span className="label">Mode</span><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{['cash', 'upi', 'card', 'bank'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
        <label className="block"><span className="label">Reference</span><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      </div>
    </Modal>
  );
}

function LoyaltyAdjust({ customer, onClose, onDone }) {
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const submit = async () => {
    try { await post('/customers/loyalty/adjust', { customerId: customer._id, points: Number(points), note }); toast.success('Points adjusted'); onDone(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Adjust loyalty points" size="sm" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit}>Save</button></>}>
      <div className="space-y-3">
        <div className="text-sm">Current balance: <b>{customer.loyaltyPoints}</b> points</div>
        <label className="block"><span className="label">Points (+ add / − deduct)</span><input type="number" className="input" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
        <label className="block"><span className="label">Reason</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const { data, loading, reload } = useFetch(`/customers/${id}`);
  const [tab, setTab] = useState('sales');
  const [modal, setModal] = useState(null);
  const [invoice, setInvoice] = useState(null);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const c = data.customer;
  return (
    <div>
      <PageHeader icon={User} title={c.name} subtitle={`${c.code} · ${c.mobile}${c.email ? ` · ${c.email}` : ''}${c.gstNumber ? ` · GSTIN ${c.gstNumber}` : ''}`}
        actions={<>
          <button type="button" className="btn-ghost" onClick={() => navigate('/customers')}><ArrowLeft className="h-4 w-4" /> Back</button>
          {can('customer.edit') && <button type="button" className="btn-secondary" onClick={() => setModal('loyalty')}><Gift className="h-4 w-4" /> Adjust points</button>}
          {c.outstanding > 0 && can('payment.create', 'customer.edit') && <button type="button" className="btn-secondary" onClick={() => setModal('receipt')}><Wallet className="h-4 w-4" /> Receive payment</button>}
          {can('customer.edit') && <button type="button" className="btn-primary" onClick={() => setModal('edit')}><Pencil className="h-4 w-4" /> Edit</button>}
        </>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total purchases" value={inr(data.stats.total)} hint={`${data.stats.bills} bills · avg ${inr(data.stats.avg)}`} />
        <StatCard label="Returns" value={inr(c.totalReturns || 0)} tone="amber" hint={`${data.returns.length} return(s)`} />
        <StatCard label="Exchanges" value={data.exchanges.length} tone="violet" />
        <StatCard label="Outstanding" value={inr(c.outstanding)} tone="red" hint={c.storeCredit ? `Store credit ${inr(c.storeCredit)}` : undefined} />
        <StatCard label="Loyalty points" value={c.loyaltyPoints} tone="green" hint={[c.dob && `DOB ${fdate(c.dob)}`, c.anniversary && `Anniv ${fdate(c.anniversary)}`].filter(Boolean).join(' · ')} />
      </div>
      <div className="card mt-4 overflow-hidden">
        <div className="px-4 pt-2"><Tabs value={tab} onChange={setTab} tabs={[
          { value: 'sales', label: 'Purchase history', count: data.sales.length }, { value: 'returns', label: 'Returns', count: data.returns.length },
          { value: 'exchanges', label: 'Exchanges', count: data.exchanges.length }, { value: 'loyalty', label: 'Loyalty', count: data.loyalty.length }, { value: 'receipts', label: 'Receipts', count: data.receipts.length },
        ]} /></div>
        <div className="table-wrap">
          {tab === 'sales' && (data.sales.length ? <table className="tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Branch</th><th className="num">Items</th><th>Payment</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{data.sales.map((s) => <tr key={s._id} className="cursor-pointer" onClick={() => setInvoice(s._id)}><td className="font-mono text-xs font-semibold">{s.invoiceNumber}</td><td>{fdatetime(s.createdAt)}</td><td>{s.branchId?.name}</td><td className="num">{s.itemCount}</td><td>{s.payments.map((p) => PAYMENT_LABELS[p.mode]).join(' + ')}</td><td className="num font-semibold">{inr(s.totals.grandTotal)}</td><td><StatusBadge status={s.status} />{s.creditAmount > 0 && <span className="badge-red ml-1">Due {inr(s.creditAmount)}</span>}</td></tr>)}</tbody></table> : <Empty />)}
          {tab === 'returns' && (data.returns.length ? <table className="tbl"><thead><tr><th>Return</th><th>Date</th><th>Invoice</th><th className="num">Qty</th><th>Mode</th><th className="num">Value</th></tr></thead>
            <tbody>{data.returns.map((r) => <tr key={r._id}><td className="font-mono text-xs">{r.returnNo}</td><td>{fdatetime(r.createdAt)}</td><td className="font-mono text-xs">{r.invoiceNumber}</td><td className="num">{r.totalQty}</td><td>{PAYMENT_LABELS[r.refundMode] || r.refundMode}</td><td className="num">{inr(r.amount)}</td></tr>)}</tbody></table> : <Empty />)}
          {tab === 'exchanges' && (data.exchanges.length ? <table className="tbl"><thead><tr><th>Exchange</th><th>Date</th><th>Original</th><th>New bill</th><th className="num">Difference</th></tr></thead>
            <tbody>{data.exchanges.map((x) => <tr key={x._id}><td className="font-mono text-xs">{x.exchangeNo}</td><td>{fdatetime(x.createdAt)}</td><td className="font-mono text-xs">{x.originalInvoice}</td><td className="font-mono text-xs">{x.newInvoice}</td><td className="num">{inr(x.difference)}</td></tr>)}</tbody></table> : <Empty />)}
          {tab === 'loyalty' && (data.loyalty.length ? <table className="tbl"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="num">Points</th><th className="num">Balance</th><th>Note</th></tr></thead>
            <tbody>{data.loyalty.map((l) => <tr key={l._id}><td>{fdatetime(l.createdAt)}</td><td><span className="badge-gray">{l.type}</span></td><td className="font-mono text-xs">{l.refNo}</td><td className={`num font-semibold ${l.points > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{l.points > 0 ? `+${l.points}` : l.points}</td><td className="num">{l.balanceAfter}</td><td className="text-xs text-ink-500">{l.note}</td></tr>)}</tbody></table> : <Empty />)}
          {tab === 'receipts' && (data.receipts.length ? <table className="tbl"><thead><tr><th>Date</th><th>Receipt</th><th>Mode</th><th className="num">Amount</th></tr></thead>
            <tbody>{data.receipts.map((p) => <tr key={p._id}><td>{fdatetime(p.date)}</td><td className="font-mono text-xs">{p.paymentNo}</td><td>{PAYMENT_LABELS[p.mode]}</td><td className="num">{inr(p.amount)}</td></tr>)}</tbody></table> : <Empty />)}
        </div>
      </div>
      {modal === 'edit' && <CustomerForm doc={c} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal === 'receipt' && <ReceiptModal customer={c} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'loyalty' && <LoyaltyAdjust customer={c} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {invoice && <InvoiceModal id={invoice} onClose={() => setInvoice(null)} onChanged={reload} />}
    </div>
  );
}
