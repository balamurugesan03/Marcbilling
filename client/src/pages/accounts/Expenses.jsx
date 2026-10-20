import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Receipt, Plus, Ban } from 'lucide-react';
import { get, post, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox, DateRange, defaultRange, BranchSelect } from '../../components/common';
import { Modal, StatusBadge } from '../../components/ui';
import { inr, fdate, isoDate, PAYMENT_LABELS } from '../../lib/format';

function ExpenseForm({ doc, cats, onClose, onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const [f, setF] = useState({
    branchId: doc?.branchId?._id || doc?.branchId || (branchId !== 'all' ? branchId : ''), categoryId: doc?.categoryId || cats[0]?._id || '', date: isoDate(doc?.date || new Date()),
    amount: doc?.amount || '', paymentMode: doc?.paymentMode || 'cash', reference: doc?.reference || '', paidTo: doc?.paidTo || '', notes: doc?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    try {
      const body = { ...f, amount: Number(f.amount) };
      if (doc) await put(`/expenses/${doc._id}`, body); else await post('/expenses', body);
      toast.success('Expense saved');
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title={doc ? `Edit ${doc.expenseNo}` : 'New Expense'} size="md" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        {!doc && <BranchSelect value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} />}
        <label><span className="label">Category</span><select className="input" value={f.categoryId} onChange={set('categoryId')}>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select></label>
        <label><span className="label">Date</span><input type="date" className="input" value={f.date} onChange={set('date')} /></label>
        <label><span className="label">Amount</span><input type="number" className="input" value={f.amount} onChange={set('amount')} /></label>
        <label><span className="label">Paid via</span><select className="input" value={f.paymentMode} onChange={set('paymentMode')}>{['cash', 'bank', 'upi', 'card'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
        <label><span className="label">Paid to</span><input className="input" value={f.paidTo} onChange={set('paidTo')} /></label>
        <label><span className="label">Reference</span><input className="input" value={f.reference} onChange={set('reference')} /></label>
        <label className="col-span-2"><span className="label">Notes</span><input className="input" value={f.notes} onChange={set('notes')} /></label>
      </div>
      {f.paymentMode === 'cash' && <p className="mt-2 text-xs text-ink-500">Cash expenses reduce the expected cash in your open cash session.</p>}
    </Modal>
  );
}

export default function Expenses() {
  const [cats, setCats] = useState([]);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState(defaultRange());
  const [categoryId, setCategoryId] = useState('');
  const [mode, setMode] = useState('');
  const [edit, setEdit] = useState(null);
  const [summary, setSummary] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const ds = useDebounce(search, 300);
  useEffect(() => { get('/expense-categories', { all: 'true', active: 'true' }).then((d) => setCats(d.items)).catch(() => {}); }, []);
  const cancel = async (r) => {
    if (!(await confirm({ title: `Cancel expense ${r.expenseNo}?`, danger: true, confirmText: 'Cancel expense' }))) return;
    try { await post(`/expenses/${r._id}/cancel`); toast.success('Expense cancelled'); setReloadKey((k) => k + 1); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div>
      <PageHeader icon={Receipt} title="Expenses" subtitle={summary ? `Total ${inr(summary.total)} for the period` : 'Branch expenses (cash / bank)'}
        actions={<><Link to="/admin/expense-categories" className="btn-secondary">Categories</Link><button type="button" className="btn-primary" onClick={() => setEdit({})} disabled={!cats.length}><Plus className="h-4 w-4" /> New expense</button></>} />
      <DataTable url="/expenses" params={{ search: ds, ...range, categoryId, paymentMode: mode }} reloadKey={reloadKey} onData={(d) => setSummary(d.summary)}
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} className="w-60" />
          <DateRange {...range} onChange={setRange} />
          <select className="input w-40" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
          <select className="input w-32" value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Cash & bank</option>{['cash', 'bank', 'upi', 'card'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select>
        </>}
        columns={[
          { key: 'expenseNo', label: 'No', render: (r) => <span className="font-mono text-xs">{r.expenseNo}</span> },
          { key: 'date', label: 'Date', render: (r) => fdate(r.date) },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'categoryName', label: 'Category' },
          { key: 'paidTo', label: 'Paid to' },
          { key: 'paymentMode', label: 'Mode', render: (r) => PAYMENT_LABELS[r.paymentMode] },
          { key: 'userName', label: 'By' },
          { key: 'amount', label: 'Amount', num: true, render: (r) => <b>{inr(r.amount)}</b> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'a', label: '', render: (r) => r.status === 'active' && (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(r)}>Edit</button>
              <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={() => cancel(r)}><Ban className="h-3.5 w-3.5" /></button>
            </div>
          ) },
        ]} />
      {edit && <ExpenseForm doc={edit._id ? edit : null} cats={cats} onClose={() => setEdit(null)} onDone={() => { setEdit(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
