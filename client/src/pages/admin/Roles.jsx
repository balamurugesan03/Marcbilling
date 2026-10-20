import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, Plus, Save, Trash2, Lock } from 'lucide-react';
import { get, post, put, del, errMsg } from '../../lib/api';
import { confirm } from '../../store/ui';
import { PageHeader } from '../../components/common';
import { Loading, Toggle } from '../../components/ui';

export default function Roles({ matrix = false }) {
  const [roles, setRoles] = useState(null);
  const [perms, setPerms] = useState([]);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const load = async () => {
    const [r, p] = await Promise.all([get('/roles'), get('/permissions')]);
    setRoles(r);
    setPerms(p);
    return r;
  };
  useEffect(() => { load().then((r) => { setSel(r[0]?._id); }).catch((e) => toast.error(errMsg(e))); }, []);
  useEffect(() => { const r = roles?.find((x) => x._id === sel); if (r) setDraft({ ...r }); }, [sel, roles]);
  const groups = useMemo(() => perms.reduce((a, p) => { (a[p.group] = a[p.group] || []).push(p); return a; }, {}), [perms]);
  if (!roles) return <Loading />;

  const save = async () => {
    try {
      const body = { name: draft.name, description: draft.description, permissions: draft.permissions, allBranches: draft.allBranches, maxDiscountPercent: Number(draft.maxDiscountPercent) };
      if (draft._id) await put(`/roles/${draft._id}`, body);
      else { const r = await post('/roles', body); setSel(r._id); }
      toast.success('Role saved');
      await load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete role ${draft.name}?`, danger: true, confirmText: 'Delete' }))) return;
    try { await del(`/roles/${draft._id}`); toast.success('Role deleted'); const r = await load(); setSel(r[0]._id); } catch (e) { toast.error(errMsg(e)); }
  };
  const togglePerm = async (role, key) => {
    if (role.code === 'super_admin') return;
    const permissions = role.permissions.includes(key) ? role.permissions.filter((p) => p !== key) : [...role.permissions, key];
    try { await put(`/roles/${role._id}`, { permissions }); setRoles(roles.map((r) => (r._id === role._id ? { ...r, permissions } : r))); } catch (e) { toast.error(errMsg(e)); }
  };

  if (matrix) {
    return (
      <div>
        <PageHeader icon={ShieldCheck} title="Permissions Matrix" subtitle="Click a cell to grant / revoke a permission. Changes save instantly; users get them on next login / token refresh." />
        <div className="card overflow-auto">
          <table className="tbl">
            <thead><tr><th>Permission</th>{roles.map((r) => <th key={r._id} className="text-center">{r.name}</th>)}</tr></thead>
            <tbody>
              {Object.entries(groups).map(([g, list]) => [
                <tr key={g}><td colSpan={roles.length + 1} className="bg-ink-50 text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:bg-ink-800/50">{g}</td></tr>,
                ...list.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}<div className="font-mono text-[10px] text-ink-400">{p.key}</div></td>
                    {roles.map((r) => (
                      <td key={r._id} className="text-center">
                        <input type="checkbox" disabled={r.code === 'super_admin'} checked={r.permissions.includes(p.key)} onChange={() => togglePerm(r, p.key)} className="h-4 w-4 accent-brand-600" />
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const locked = draft?.code === 'super_admin';
  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Roles" subtitle="Role-based access control with per-action permissions"
        actions={<button type="button" className="btn-secondary" onClick={() => { setSel(null); setDraft({ name: '', description: '', permissions: ['dashboard.view'], allBranches: false, maxDiscountPercent: 0 }); }}><Plus className="h-4 w-4" /> New role</button>} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="card h-fit p-2">
          {roles.map((r) => (
            <button key={r._id} type="button" onClick={() => setSel(r._id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${sel === r._id ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
              <span>{r.name}</span><span className="text-[11px] text-ink-400">{r.permissions.length}</span>
            </button>
          ))}
        </div>
        {draft && (
          <div className="card card-pad space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="label">Role name</span><input className="input" disabled={locked} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label><span className="label">Max discount %</span><input type="number" className="input" disabled={locked} value={draft.maxDiscountPercent} onChange={(e) => setDraft({ ...draft, maxDiscountPercent: e.target.value })} /></label>
              <div className="flex items-end"><Toggle checked={draft.allBranches} onChange={(v) => !locked && setDraft({ ...draft, allBranches: v })} label="All branches" hint="Can view consolidated / any branch" /></div>
              <label className="sm:col-span-3"><span className="label">Description</span><input className="input" disabled={locked} value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
            </div>
            {locked && <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"><Lock className="h-4 w-4" /> Super Admin always has every permission.</div>}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(groups).map(([g, list]) => (
                <div key={g} className="rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                  <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-ink-500">{g}
                    {!locked && <button type="button" className="text-[10px] text-brand-600" onClick={() => { const all = list.every((p) => draft.permissions.includes(p.key)); setDraft({ ...draft, permissions: all ? draft.permissions.filter((k) => !list.some((p) => p.key === k)) : [...new Set([...draft.permissions, ...list.map((p) => p.key)])] }); }}>toggle all</button>}
                  </div>
                  {list.map((p) => (
                    <label key={p.key} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={locked} checked={draft.permissions.includes(p.key)} onChange={() => setDraft({ ...draft, permissions: draft.permissions.includes(p.key) ? draft.permissions.filter((k) => k !== p.key) : [...draft.permissions, p.key] })} />
                      {p.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {!locked && (
              <div className="flex justify-end gap-2">
                {draft._id && !draft.system && <button type="button" className="btn-danger mr-auto" onClick={remove}><Trash2 className="h-4 w-4" /> Delete</button>}
                <button type="button" className="btn-primary" onClick={save}><Save className="h-4 w-4" /> Save role</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
