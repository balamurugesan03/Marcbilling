import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { UserCog, Plus } from 'lucide-react';
import { get, post, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox } from '../../components/common';
import { Modal, Input, Select, StatusBadge, Toggle } from '../../components/ui';
import { fdatetime } from '../../lib/format';

function UserForm({ doc, roles, branches, onClose, onSaved }) {
  const [f, setF] = useState({
    name: doc?.name || '', username: doc?.username || '', email: doc?.email || '', mobile: doc?.mobile || '', password: '',
    roleId: doc?.roleId?._id || roles.find((r) => r.code === 'cashier')?._id || '', branchIds: (doc?.branchIds || []).map((b) => b._id || b),
    defaultBranchId: doc?.defaultBranchId || '', active: doc?.active ?? true,
  });
  const role = roles.find((r) => r._id === f.roleId);
  const toggleBranch = (id) => setF({ ...f, branchIds: f.branchIds.includes(id) ? f.branchIds.filter((b) => b !== id) : [...f.branchIds, id] });
  const submit = async (e) => {
    e.preventDefault();
    if (!role?.allBranches && !f.branchIds.length) return toast.error('Assign at least one branch');
    try {
      const body = { ...f, defaultBranchId: f.defaultBranchId || f.branchIds[0] };
      if (doc) { delete body.username; if (!body.password) delete body.password; await put(`/users/${doc._id}`, body); } else await post('/users', body);
      toast.success('User saved');
      onSaved();
    } catch (err) { toast.error(errMsg(err)); }
    return null;
  };
  return (
    <Modal open onClose={onClose} title={doc ? `Edit ${doc.name}` : 'New User'} size="lg">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Input label="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="Username" required disabled={Boolean(doc)} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />
        <Input label="Mobile" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
        <Input label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label={doc ? 'Reset password (optional)' : 'Password'} type="password" required={!doc} minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Select label="Role" value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })} options={roles.map((r) => ({ value: r._id, label: r.name }))} />
        <div className="col-span-2">
          <div className="label">Branches {role?.allBranches && <span className="text-emerald-600">(role has access to all branches)</span>}</div>
          <div className="flex flex-wrap gap-2">
            {branches.map((b) => (
              <label key={b._id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${f.branchIds.includes(b._id) ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10' : 'border-ink-200 dark:border-ink-700'}`}>
                <input type="checkbox" checked={f.branchIds.includes(b._id)} onChange={() => toggleBranch(b._id)} /> {b.name}
              </label>
            ))}
          </div>
        </div>
        <Select label="Default branch" value={f.defaultBranchId} onChange={(e) => setF({ ...f, defaultBranchId: e.target.value })} placeholder="First assigned" options={branches.filter((b) => f.branchIds.includes(b._id)).map((b) => ({ value: b._id, label: b.name }))} />
        <div className="flex items-end"><Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" hint="Disabled users cannot log in" /></div>
        <div className="col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary">Save user</button></div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const [search, setSearch] = useState('');
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [edit, setEdit] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const me = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const ds = useDebounce(search, 300);
  useEffect(() => { get('/roles').then(setRoles); get('/branches').then(setBranches); }, []);
  return (
    <div>
      <PageHeader icon={UserCog} title="Users" subtitle="Staff accounts, roles and branch access" actions={can('user.create') && <button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus className="h-4 w-4" /> New user</button>} />
      <DataTable url="/users" params={{ search: ds }} reloadKey={reloadKey} onRowClick={can('user.edit') ? (r) => setEdit(r) : undefined} toolbar={<SearchBox value={search} onChange={setSearch} className="w-64" />}
        columns={[
          { key: 'name', label: 'Name', render: (r) => <><b>{r.name}</b>{r._id === me._id && <span className="badge-brand ml-2">You</span>}<div className="text-xs text-ink-500">@{r.username}</div></> },
          { key: 'role', label: 'Role', render: (r) => <span className="badge-blue">{r.roleId?.name}</span> },
          { key: 'branches', label: 'Branches', render: (r) => r.branchIds?.map((b) => b.name).join(', ') || '-' },
          { key: 'mobile', label: 'Mobile' },
          { key: 'lastLoginAt', label: 'Last login', render: (r) => fdatetime(r.lastLoginAt) },
          { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> },
        ]} />
      {edit && <UserForm doc={edit._id ? edit : null} roles={roles} branches={branches} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
