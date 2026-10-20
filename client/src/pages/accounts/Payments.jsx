import { useState } from 'react';
import toast from 'react-hot-toast';
import { CreditCard, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox, DateRange, defaultRange, AsyncSelect, fetchCustomers, fetchSuppliers } from '../../components/common';
import { Modal } from '../../components/ui';
import { inr, fdatetime, PAYMENT_LABELS, titleCase } from '../../lib/format';

function PartyPayment({ kind, onClose, onDone }) {
  const [party, setParty] = useState(null);
  const [f, setF] = useState({ amount: '', mode: kind === 'customer' ? 'cash' : 'bank', reference: '', notes: '' });
  const due = kind === 'customer' ? party?.raw?.outstanding : party?.raw?.balance;
  const submit = async () => {
    if (!party) return toast.error(`Select ${kind}`);
    try {
      const body = { amount: Number(f.amount), mode: f.mode, reference: f.reference || undefined, notes: f.notes || undefined };
      if (kind === 'customer') await post('/payments/customer-receipt', { ...body, customerId: party.value });
      else await post('/payments/supplier-payment', { ...body, supplierId: party.value });
      toast.success('Payment recorded');
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
    return null;
  };
  return (
    <Modal open onClose={onClose} title={kind === 'customer' ? 'Receive from customer (outstanding)' : 'Pay supplier'} size="sm" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit}>Save</button></>}>
      <div className="space-y-3">
        <AsyncSelect label={kind === 'customer' ? 'Customer' : 'Supplier'} value={party?.value} displayValue={party?.label} onChange={(p) => { setParty(p); setF((x) => ({ ...x, amount: (kind === 'customer' ? p?.raw?.outstanding : p?.raw?.balance) || '' })); }} fetcher={kind === 'customer' ? fetchCustomers : fetchSuppliers} />
        {party && <div className="text-sm">{kind === 'customer' ? 'Outstanding' : 'Payable'}: <b>{inr(due || 0)}</b></div>}
        <label className="block"><span className="label">Amount</span><input type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="block"><span className="label">Mode</span><select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{['cash', 'bank', 'upi', 'card'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
        <label className="block"><span className="label">Reference</span><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        <label className="block"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {kind === 'supplier' && <p className="text-xs text-ink-500">Allocated automatically to the oldest unpaid purchase invoices.</p>}
      </div>
    </Modal>
  );
}

export default function Payments() {
  const [search, setSearch] = useState('');
  const [range, setRange] = useState(defaultRange());
  const [type, setType] = useState('');
  const [mode, setMode] = useState('');
  const [modal, setModal] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const ds = useDebounce(search, 300);
  return (
    <div>
      <PageHeader icon={CreditCard} title="Payments" subtitle="All money in and out: sales receipts, refunds, customer collections and supplier payments"
        actions={<><button type="button" className="btn-secondary" onClick={() => setModal('customer')}><ArrowDownLeft className="h-4 w-4 text-emerald-600" /> Customer receipt</button><button type="button" className="btn-primary" onClick={() => setModal('supplier')}><ArrowUpRight className="h-4 w-4" /> Supplier payment</button></>} />
      <DataTable url="/payments" params={{ search: ds, ...range, type, mode }} reloadKey={reloadKey}
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} className="w-64" placeholder="Payment no, ref, party" />
          <DateRange {...range} onChange={setRange} />
          <select className="input w-44" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{['sale', 'sale_refund', 'sale_cancel', 'customer_receipt', 'supplier_payment', 'supplier_refund'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select>
          <select className="input w-32" value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All modes</option>{['cash', 'card', 'upi', 'bank'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select>
        </>}
        columns={[
          { key: 'paymentNo', label: 'Payment No', render: (r) => <span className="font-mono text-xs">{r.paymentNo}</span> },
          { key: 'date', label: 'Date', render: (r) => fdatetime(r.date) },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'type', label: 'Type', render: (r) => titleCase(r.type) },
          { key: 'refNo', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.refNo}{r.reference && <span className="ml-1 text-ink-500">({r.reference})</span>}</span> },
          { key: 'partyName', label: 'Party' },
          { key: 'mode', label: 'Mode', render: (r) => PAYMENT_LABELS[r.mode] },
          { key: 'userName', label: 'By' },
          { key: 'amount', label: 'Amount', num: true, render: (r) => <b className={r.direction === 'in' ? 'text-emerald-600' : 'text-rose-600'}>{r.direction === 'in' ? '+' : '−'}{inr(r.amount)}</b> },
        ]} />
      {modal && <PartyPayment kind={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
