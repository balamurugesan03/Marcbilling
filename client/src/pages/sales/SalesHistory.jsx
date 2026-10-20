import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ReceiptText } from 'lucide-react';
import { useAppEvent } from '../../hooks';
import { PageHeader, DataTable, SearchBox, DateRange, defaultRange } from '../../components/common';
import { StatusBadge } from '../../components/ui';
import { inr, fdatetime, PAYMENT_LABELS } from '../../lib/format';
import { useDebounce } from '../../hooks';
import InvoiceModal from './InvoiceModal';

export default function SalesHistory() {
  const [sp] = useSearchParams();
  const [search, setSearch] = useState(sp.get('search') || '');
  const [range, setRange] = useState(sp.get('search') ? { from: '', to: '' } : defaultRange());
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [open, setOpen] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [summary, setSummary] = useState(null);
  const ds = useDebounce(search, 300);
  useAppEvent('sale', () => setReloadKey((k) => k + 1));
  return (
    <div>
      <PageHeader icon={ReceiptText} title="Sales History" subtitle={summary ? `${summary.bills} completed bills · ${inr(summary.total)}` : 'All invoices'} />
      <DataTable url="/sales" params={{ search: ds, ...range, status, paymentMode: mode }} reloadKey={reloadKey} onRowClick={(r) => setOpen(r._id)} onData={(d) => setSummary(d.summary)}
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} placeholder="Invoice no, customer mobile / name" className="w-72" />
          <DateRange {...range} onChange={setRange} />
          <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All status</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
          <select className="input w-36" value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All payments</option>{['cash', 'card', 'upi', 'bank', 'credit', 'store_credit', 'loyalty'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select>
        </>}
        columns={[
          { key: 'invoiceNumber', label: 'Invoice', render: (r) => <span className="font-mono text-xs font-semibold">{r.invoiceNumber}</span> },
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'customer', label: 'Customer', render: (r) => (r.customer?.name ? <>{r.customer.name}<div className="text-xs text-ink-500">{r.customer.mobile}</div></> : <span className="text-ink-400">Walk-in</span>) },
          { key: 'cashierName', label: 'Cashier' },
          { key: 'qty', label: 'Qty', num: true, render: (r) => r.totals.totalQty },
          { key: 'payments', label: 'Payment', render: (r) => r.payments.map((p) => PAYMENT_LABELS[p.mode]).join(' + ') },
          { key: 'total', label: 'Amount', num: true, render: (r) => <b>{inr(r.totals.grandTotal)}</b> },
          { key: 'status', label: 'Status', render: (r) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.returnStatus !== 'none' && <StatusBadge status={r.returnStatus} label={`${r.returnStatus} ret`} />}{r.saleType === 'exchange' && <StatusBadge status="exchange" />}</div> },
        ]} />
      {open && <InvoiceModal id={open} onClose={() => setOpen(null)} onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}
