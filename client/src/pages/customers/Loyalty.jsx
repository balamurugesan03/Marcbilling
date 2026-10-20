import { useState } from 'react';
import { Gift } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { PageHeader, DataTable, DateRange } from '../../components/common';
import { fdatetime } from '../../lib/format';

export default function Loyalty() {
  const settings = useAuth((s) => s.settings);
  const [type, setType] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const l = settings?.loyalty;
  return (
    <div>
      <PageHeader icon={Gift} title="Loyalty" subtitle={l?.enabled ? `1 point per ₹${l.amountPerPoint} spent · 1 point = ₹${l.pointValue} · min ${l.minRedeemPoints} points to redeem` : 'Loyalty programme is disabled in settings'} />
      <DataTable url="/customers/loyalty" params={{ type, ...range }}
        toolbar={<><select className="input w-36" value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{['earn', 'redeem', 'reverse', 'adjust'].map((t) => <option key={t} value={t}>{t}</option>)}</select><DateRange {...range} onChange={setRange} /></>}
        columns={[
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'customer', label: 'Customer', render: (r) => <><b>{r.customerId?.name}</b><div className="text-xs text-ink-500">{r.customerId?.mobile}</div></> },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'type', label: 'Type', render: (r) => <span className={r.points > 0 ? 'badge-green' : 'badge-red'}>{r.type}</span> },
          { key: 'refNo', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.refNo}</span> },
          { key: 'points', label: 'Points', num: true, render: (r) => <b className={r.points > 0 ? 'text-emerald-600' : 'text-rose-600'}>{r.points > 0 ? `+${r.points}` : r.points}</b> },
          { key: 'balanceAfter', label: 'Balance', num: true },
          { key: 'note', label: 'Note' },
        ]} />
    </div>
  );
}
