import { useState } from 'react';
import toast from 'react-hot-toast';
import { Wallet, LogIn, LogOut, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useFetch } from '../../hooks';
import { PageHeader, DataTable, DateRange } from '../../components/common';
import { Loading, Modal, StatusBadge, Empty } from '../../components/ui';
import { inr, fdatetime, round2 } from '../../lib/format';

const DENOMS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

function CloseModal({ session, onClose, onDone }) {
  const [counts, setCounts] = useState({});
  const [manual, setManual] = useState('');
  const [notes, setNotes] = useState('');
  const counted = round2(DENOMS.reduce((a, d) => a + d * (Number(counts[d]) || 0), 0));
  const actual = manual !== '' ? Number(manual) : counted;
  const diff = round2(actual - session.summary.expected);
  const submit = async () => {
    try {
      await post('/cash/close', { actualClosing: actual, denominations: Object.fromEntries(Object.entries(counts).filter(([, v]) => Number(v) > 0)), notes });
      toast.success('Cash session closed');
      onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Modal open onClose={onClose} title="Close cash session (day end)" size="lg" footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit}>Close session</button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="label">Denomination count</div>
          <div className="grid grid-cols-2 gap-2">
            {DENOMS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm"><span className="w-14 text-right font-mono">₹{d} ×</span><input type="number" min={0} className="input input-sm" value={counts[d] || ''} onChange={(e) => setCounts({ ...counts, [d]: e.target.value })} /></label>
            ))}
          </div>
          <label className="mt-3 block"><span className="label">Or enter counted total</span><input type="number" className="input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={String(counted)} /></label>
          <label className="mt-3 block"><span className="label">Notes</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        <div className="space-y-1.5 rounded-xl bg-ink-50 p-4 text-sm dark:bg-ink-800/50">
          {[['Opening cash', session.openingCash], ['+ Cash sales', session.summary.cashSales], ['+ Cash receipts', session.summary.cashReceipts], ['+ Cash in', session.summary.cashIn], ['− Cash refunds', -session.summary.cashRefunds], ['− Cash expenses', -session.summary.cashExpenses], ['− Supplier payments', -session.summary.supplierPayments], ['− Cash out', -session.summary.cashOut]].map(([k, v]) => (
            <div key={k} className="flex justify-between"><span className="text-ink-500">{k}</span><span className="tabular-nums">{inr(v)}</span></div>
          ))}
          <div className="flex justify-between border-t border-ink-200 pt-2 font-bold dark:border-ink-700"><span>Expected closing</span><span>{inr(session.summary.expected)}</span></div>
          <div className="flex justify-between font-bold"><span>Actual (counted)</span><span>{inr(actual)}</span></div>
          <div className={`flex justify-between rounded-lg p-2 font-bold ${diff === 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15'}`}><span>Difference ({diff >= 0 ? 'excess' : 'short'})</span><span>{inr(diff)}</span></div>
        </div>
      </div>
    </Modal>
  );
}

export default function Cash() {
  const { branchId } = useAuth();
  const { data: current, loading, reload } = useFetch('/cash/current');
  const [opening, setOpening] = useState('');
  const [mv, setMv] = useState(null);
  const [closing, setClosing] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = () => { reload(); setReloadKey((k) => k + 1); };
  const open = async () => {
    try { await post('/cash/open', { openingCash: Number(opening) || 0 }); toast.success('Cash session opened'); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  const movement = async () => {
    try { await post('/cash/movement', { type: mv.type, amount: Number(mv.amount), reason: mv.reason }); toast.success(`Cash ${mv.type} recorded`); setMv(null); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };
  const s = current?.summary;
  return (
    <div>
      <PageHeader icon={Wallet} title="Cash Management" subtitle="Opening cash, cash in/out and daily cashier closing" />
      {branchId === 'all' ? <div className="card card-pad mb-4"><Empty title="Select a branch" hint="Cash sessions are per branch and per cashier." /></div> : loading && !current ? <Loading /> : !current ? (
        <div className="card card-pad mb-4 flex flex-wrap items-end gap-3">
          <div className="mr-auto"><div className="section-title">No open cash session</div><div className="text-sm text-ink-500">Open the till with the cash in the drawer to start tracking.</div></div>
          <label><span className="label">Opening cash</span><input type="number" className="input w-40" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" /></label>
          <button type="button" className="btn-primary" onClick={open}><LogIn className="h-4 w-4" /> Open session</button>
        </div>
      ) : (
        <div className="card card-pad mb-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="mr-auto"><div className="section-title">Session {current.sessionNo} <StatusBadge status="open" /></div><div className="text-xs text-ink-500">Opened {fdatetime(current.openedAt)} by {current.userName}</div></div>
            <button type="button" className="btn-secondary" onClick={() => setMv({ type: 'in', amount: '', reason: '' })}><ArrowDownCircle className="h-4 w-4 text-emerald-600" /> Cash in</button>
            <button type="button" className="btn-secondary" onClick={() => setMv({ type: 'out', amount: '', reason: '' })}><ArrowUpCircle className="h-4 w-4 text-rose-600" /> Cash out</button>
            <button type="button" className="btn-primary" onClick={() => setClosing(true)}><LogOut className="h-4 w-4" /> Close (day end)</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[['Opening', current.openingCash], ['Cash sales', s.cashSales], ['Receipts', s.cashReceipts], ['Cash in − out', s.cashIn - s.cashOut], ['Refunds + expenses', -(s.cashRefunds + s.cashExpenses + s.supplierPayments)], ['Expected in drawer', s.expected]].map(([k, v], i) => (
              <div key={k} className={`rounded-xl p-3 ${i === 5 ? 'bg-ink-900 text-white' : 'bg-ink-50 dark:bg-ink-800/50'}`}><div className={`text-xs ${i === 5 ? 'text-ink-400' : 'text-ink-500'}`}>{k}</div><div className="text-lg font-bold tabular-nums">{inr(v)}</div></div>
            ))}
          </div>
          {current.movements?.length > 0 && (
            <table className="tbl mt-4"><thead><tr><th>Time</th><th>Type</th><th>Reason</th><th>By</th><th className="num">Amount</th></tr></thead>
              <tbody>{current.movements.map((m) => <tr key={m._id}><td>{fdatetime(m.at)}</td><td><span className={m.type === 'in' ? 'badge-green' : 'badge-red'}>Cash {m.type}</span></td><td>{m.reason}</td><td>{m.userName}</td><td className="num">{inr(m.amount)}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
      <div className="section-title mb-2">Session history</div>
      <DataTable url="/cash/sessions" params={range} reloadKey={reloadKey} toolbar={<DateRange {...range} onChange={setRange} />}
        columns={[
          { key: 'sessionNo', label: 'Session', render: (r) => <span className="font-mono text-xs font-semibold">{r.sessionNo}</span> },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'userName', label: 'Cashier' },
          { key: 'openedAt', label: 'Opened', render: (r) => fdatetime(r.openedAt) },
          { key: 'closedAt', label: 'Closed', render: (r) => fdatetime(r.closedAt) },
          { key: 'openingCash', label: 'Opening', num: true, render: (r) => inr(r.openingCash) },
          { key: 'cashSales', label: 'Cash sales', num: true, render: (r) => inr(r.summary?.cashSales) },
          { key: 'expected', label: 'Expected', num: true, render: (r) => inr(r.summary?.expected) },
          { key: 'actualClosing', label: 'Actual', num: true, render: (r) => (r.status === 'closed' ? inr(r.actualClosing) : '-') },
          { key: 'difference', label: 'Diff', num: true, render: (r) => (r.status === 'closed' ? <b className={r.difference ? 'text-rose-600' : 'text-emerald-600'}>{inr(r.difference)}</b> : '-') },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      {mv && (
        <Modal open onClose={() => setMv(null)} title={`Cash ${mv.type}`} size="sm" footer={<><button type="button" className="btn-secondary" onClick={() => setMv(null)}>Cancel</button><button type="button" className="btn-primary" onClick={movement}>Save</button></>}>
          <div className="space-y-3">
            <label className="block"><span className="label">Amount</span><input type="number" className="input" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} /></label>
            <label className="block"><span className="label">Reason</span><input className="input" value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} placeholder={mv.type === 'in' ? 'Change float added' : 'Deposited to bank'} /></label>
          </div>
        </Modal>
      )}
      {closing && current && <CloseModal session={current} onClose={() => setClosing(false)} onDone={() => { setClosing(false); refresh(); }} />}
    </div>
  );
}
