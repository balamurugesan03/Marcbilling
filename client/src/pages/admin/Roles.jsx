import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { ShieldCheck, Plus, Save, Trash2, Lock } from 'lucide-react';
import { get, post, put, del, errMsg } from '../../lib/api';
import { confirm } from '../../store/ui';
import { useAuth } from '../../store/auth';
import { PageHeader } from '../../components/common';
import { Loading, Toggle } from '../../components/ui';

const ACTIONS = [['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete']];
const ACTION_BADGE = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', other: 'Action' };

/** Permissions arranged by module: { module, view, create, edit, delete, other: [] } */
function useModules(perms) {
  return useMemo(() => {
    const map = new Map();
    perms.forEach((p) => {
      if (!map.has(p.group)) map.set(p.group, { module: p.group, other: [] });
      const m = map.get(p.group);
      const a = p.action || 'other';
      if (a === 'other') m.other.push(p); else m[a] = p;
    });
    return [...map.values()];
  }, [perms]);
}

/** Module-wise grid: one row per module, View / Create / Edit / Delete columns, special actions on the right. */
function ModuleGrid({ modules, value, onChange, disabled }) {
  const has = (p) => p && value.includes(p.key);
  const set = (keys, on) => onChange(on ? [...new Set([...value, ...keys])] : value.filter((k) => !keys.includes(k)));
  const rowKeys = (m) => [...ACTIONS.map(([a]) => m[a]?.key), ...m.other.map((p) => p.key)].filter(Boolean);
  const colKeys = (a) => modules.map((m) => m[a]?.key).filter(Boolean);
  const Cell = ({ p }) => (p
    ? <input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand-600" title={p.label} disabled={disabled} checked={has(p)} onChange={() => set([p.key], !has(p))} />
    : <span className="text-ink-300 dark:text-ink-600">—</span>);
  return (
    <div className="table-wrap rounded-xl border border-ink-100 dark:border-ink-800">
      <table className="tbl">
        <thead>
          <tr>
            <th>Module</th>
            {ACTIONS.map(([a, l]) => {
              const keys = colKeys(a);
              const all = keys.length > 0 && keys.every((k) => value.includes(k));
              return (
                <th key={a} className="w-24 text-center">
                  <div>{l}</div>
                  {!disabled && <button type="button" className="text-[10px] font-normal normal-case text-brand-600" onClick={() => set(keys, !all)}>{all ? 'none' : 'all'}</button>}
                </th>
              );
            })}
            <th>Other actions</th>
            <th className="w-16 text-center">All</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => {
            const keys = rowKeys(m);
            const all = keys.every((k) => value.includes(k));
            return (
              <tr key={m.module} className={clsx(keys.some((k) => value.includes(k)) && 'bg-brand-50/40 dark:bg-brand-500/5')}>
                <td className="font-semibold">{m.module}</td>
                {ACTIONS.map(([a]) => <td key={a} className="text-center"><Cell p={m[a]} /></td>)}
                <td>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {m.other.map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" disabled={disabled} checked={has(p)} onChange={() => set([p.key], !has(p))} /> {p.label}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="text-center">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer accent-ink-700" title="Everything in this module" disabled={disabled} checked={all} onChange={() => set(keys, !all)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Roles({ matrix = false }) {
  const can = useAuth((s) => s.can);
  const [roles, setRoles] = useState(null);
  const [perms, setPerms] = useState([]);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const modules = useModules(perms);
  const load = async () => {
    const [r, p] = await Promise.all([get('/roles'), get('/permissions')]);
    setRoles(r);
    setPerms(p);
    return r;
  };
  useEffect(() => { load().then((r) => { setSel(r[0]?._id); }).catch((e) => toast.error(errMsg(e))); }, []);
  useEffect(() => { const r = roles?.find((x) => x._id === sel); if (r) setDraft({ ...r }); }, [sel, roles]);
  if (!roles) return <Loading />;

  const save = async () => {
    try {
      const body = { name: draft.name, description: draft.description, permissions: draft.permissions, allBranches: draft.allBranches, maxDiscountPercent: Number(draft.maxDiscountPercent) };
      if (draft._id) await put(`/roles/${draft._id}`, body);
      else { const r = await post('/roles', body); setSel(r._id); }
      toast.success('Role saved — users get the new access on their next login / token refresh');
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
    const editable = can('role.edit');
    return (
      <div>
        <PageHeader icon={ShieldCheck} title="Permissions Matrix" subtitle={editable ? 'Every role side by side, module-wise. Click a cell to grant / revoke; it saves instantly.' : 'Every role side by side, module-wise (read only).'} />
        <div className="card overflow-auto">
          <table className="tbl">
            <thead><tr><th>Module / action</th>{roles.map((r) => <th key={r._id} className="text-center">{r.name}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => [
                <tr key={m.module}><td colSpan={roles.length + 1} className="bg-ink-50 text-[11px] font-bold uppercase tracking-wide text-ink-500 dark:bg-ink-800/50">{m.module}</td></tr>,
                ...[...ACTIONS.map(([a]) => m[a]), ...m.other].filter(Boolean).map((p) => (
                  <tr key={p.key}>
                    <td><span className={clsx('mr-2 inline-block w-14 rounded px-1.5 py-0.5 text-center text-[10px] font-bold uppercase', p.action === 'view' ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' : p.action === 'create' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : p.action === 'edit' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : p.action === 'delete' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}>{ACTION_BADGE[p.action] || 'Action'}</span>{p.label}</td>
                    {roles.map((r) => (
                      <td key={r._id} className="text-center">
                        <input type="checkbox" disabled={!editable || r.code === 'super_admin'} checked={r.permissions.includes(p.key)} onChange={() => togglePerm(r, p.key)} className="h-4 w-4 accent-brand-600" />
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
  const readOnly = locked || (draft?._id ? !can('role.edit') : !can('role.create'));
  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Roles" subtitle="Role-based access: choose View / Create / Edit / Delete for every module"
        actions={can('role.create') && <button type="button" className="btn-secondary" onClick={() => { setSel(null); setDraft({ name: '', description: '', permissions: ['dashboard.view'], allBranches: false, maxDiscountPercent: 0 }); }}><Plus className="h-4 w-4" /> New role</button>} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="card h-fit p-2">
          {roles.map((r) => (
            <button key={r._id} type="button" onClick={() => setSel(r._id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${sel === r._id ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>
              <span>{r.name}</span><span className="text-[11px] text-ink-400">{r.permissions.length}</span>
            </button>
          ))}
        </div>
        {draft && (
          <div className="card card-pad min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="label">Role name</span><input className="input" disabled={readOnly} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label><span className="label">Max discount %</span><input type="number" className="input" disabled={readOnly} value={draft.maxDiscountPercent} onChange={(e) => setDraft({ ...draft, maxDiscountPercent: e.target.value })} /></label>
              <div className="flex items-end"><Toggle checked={draft.allBranches} onChange={(v) => !readOnly && setDraft({ ...draft, allBranches: v })} label="All branches" hint="Can view consolidated / any branch" /></div>
              <label className="sm:col-span-3"><span className="label">Description</span><input className="input" disabled={readOnly} value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
            </div>
            {locked && <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"><Lock className="h-4 w-4" /> Super Admin always has every permission.</div>}
            <ModuleGrid modules={modules} value={draft.permissions} disabled={readOnly} onChange={(permissions) => setDraft({ ...draft, permissions })} />
            {!readOnly && (
              <div className="flex justify-end gap-2">
                {draft._id && !draft.system && can('role.delete') && <button type="button" className="btn-danger mr-auto" onClick={remove}><Trash2 className="h-4 w-4" /> Delete</button>}
                <button type="button" className="btn-primary" onClick={save}><Save className="h-4 w-4" /> Save role</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
