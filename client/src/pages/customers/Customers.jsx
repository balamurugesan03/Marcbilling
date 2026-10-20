import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox } from '../../components/common';
import { inr, fdate } from '../../lib/format';
import CustomerForm from './CustomerForm';

export default function Customers() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const ds = useDebounce(search, 300);
  return (
    <div>
      <PageHeader icon={Users} title="Customers" actions={can('customer.manage') && <button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus className="h-4 w-4" /> New customer</button>} />
      <DataTable url="/customers" params={{ search: ds, outstanding: filter === 'due' ? 'true' : undefined, storeCredit: filter === 'credit' ? 'true' : undefined }} reloadKey={reloadKey}
        onRowClick={(r) => navigate(`/customers/${r._id}`)}
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} placeholder="Name, mobile, code, email" className="w-72" />
          <select className="input w-44" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All customers</option><option value="due">With outstanding</option><option value="credit">With store credit</option></select>
        </>}
        columns={[
          { key: 'code', label: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: 'name', label: 'Customer', render: (r) => <><b>{r.name}</b><div className="text-xs text-ink-500">{r.email}</div></> },
          { key: 'mobile', label: 'Mobile' },
          { key: 'city', label: 'City' },
          { key: 'totalBills', label: 'Bills', num: true },
          { key: 'totalPurchases', label: 'Purchases', num: true, render: (r) => inr(r.totalPurchases) },
          { key: 'loyaltyPoints', label: 'Points', num: true, render: (r) => <span className="badge-brand">{r.loyaltyPoints}</span> },
          { key: 'storeCredit', label: 'Store credit', num: true, render: (r) => (r.storeCredit ? inr(r.storeCredit) : '-') },
          { key: 'outstanding', label: 'Outstanding', num: true, render: (r) => (r.outstanding ? <b className="text-rose-600">{inr(r.outstanding)}</b> : '-') },
          { key: 'lastPurchaseAt', label: 'Last visit', render: (r) => fdate(r.lastPurchaseAt) },
        ]} />
      {edit && <CustomerForm doc={edit._id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
