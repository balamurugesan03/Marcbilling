import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { get } from '../../lib/api';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox, DateRange } from '../../components/common';
import { Modal } from '../../components/ui';
import { fdatetime } from '../../lib/format';

function Json({ value }) {
  if (value == null) return <div className="text-xs text-ink-400">—</div>;
  return <pre className="max-h-[50vh] overflow-auto rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed dark:bg-ink-800">{JSON.stringify(value, null, 2)}</pre>;
}

export default function AuditLogs() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [actions, setActions] = useState([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [open, setOpen] = useState(null);
  const ds = useDebounce(search, 300);
  useEffect(() => { get('/audit-logs/actions').then((a) => setActions(a.sort())).catch(() => {}); }, []);
  return (
    <div>
      <PageHeader icon={History} title="Audit Logs" subtitle="Who did what, when — with old and new values" />
      <DataTable url="/audit-logs" params={{ search: ds, action, ...range }} onRowClick={setOpen} dense
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} className="w-60" placeholder="Reference, user, action" />
          <select className="input w-56" value={action} onChange={(e) => setAction(e.target.value)}><option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <DateRange {...range} onChange={setRange} />
        </>}
        columns={[
          { key: 'createdAt', label: 'Date & time', render: (r) => fdatetime(r.createdAt) },
          { key: 'userName', label: 'User' },
          { key: 'action', label: 'Action', render: (r) => <span className="badge-blue normal-case">{r.action}</span> },
          { key: 'entity', label: 'Entity' },
          { key: 'refNo', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.refNo}</span> },
          { key: 'ip', label: 'IP' },
          { key: 'userAgent', label: 'Device', render: (r) => <span className="block max-w-[220px] truncate text-xs text-ink-500">{r.userAgent}</span> },
        ]} />
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${open.action} · ${open.refNo || ''}`} size="xl">
          <div className="mb-3 text-sm text-ink-500">{fdatetime(open.createdAt)} · {open.userName} · {open.ip} · {open.userAgent}</div>
          <div className="grid gap-3 md:grid-cols-2"><div><div className="label">Old value</div><Json value={open.oldValue} /></div><div><div className="label">New value</div><Json value={open.newValue} /></div></div>
        </Modal>
      )}
    </div>
  );
}
