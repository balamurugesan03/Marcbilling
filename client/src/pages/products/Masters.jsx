import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, FolderTree, Award, Truck, Store, Receipt, Upload } from 'lucide-react';
import { get, post, put, del, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox } from '../../components/common';
import { Modal, Input, Select, StatusBadge, Toggle } from '../../components/ui';
import { inr } from '../../lib/format';

const GST = [0, 5, 12, 18, 28].map((g) => ({ value: g, label: `${g}%` }));
const addr = (prefix = 'address') => [
  { name: `${prefix}.line1`, label: 'Address line 1', span: 2 }, { name: `${prefix}.line2`, label: 'Address line 2', span: 2 },
  { name: `${prefix}.city`, label: 'City' }, { name: `${prefix}.state`, label: 'State' }, { name: `${prefix}.pincode`, label: 'Pincode' },
];

const CONFIG = {
  categories: {
    title: 'Categories', icon: FolderTree, url: '/categories', perms: { create: ['product.create', 'product.edit'], edit: ['product.create', 'product.edit'], delete: ['product.edit', 'product.delete'] }, subtitle: 'Categories and sub-categories with default GST / HSN',
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'code', label: 'Code' },
      { name: 'parentId', label: 'Parent category (for sub-category)', type: 'parent' },
      { name: 'defaultGstRate', label: 'Default GST', type: 'select', options: GST, number: true }, { name: 'defaultHsnCode', label: 'Default HSN' },
      { name: 'active', label: 'Active', type: 'toggle' },
    ],
    columns: [
      { key: 'name', label: 'Name', render: (r) => <span className={r.parentId ? 'pl-4' : 'font-semibold'}>{r.parentId ? '↳ ' : ''}{r.name}</span> },
      { key: 'parent', label: 'Parent', render: (r) => r.parentId?.name || '-' },
      { key: 'defaultGstRate', label: 'GST', num: true, render: (r) => `${r.defaultGstRate}%` }, { key: 'defaultHsnCode', label: 'HSN' },
      { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> },
    ],
    defaults: { active: true, defaultGstRate: 5 },
  },
  brands: {
    title: 'Brands', icon: Award, url: '/brands', perms: { create: ['product.create', 'product.edit'], edit: ['product.create', 'product.edit'], delete: ['product.edit', 'product.delete'] },
    fields: [{ name: 'name', label: 'Name', required: true, span: 2 }, { name: 'description', label: 'Description', span: 2 }, { name: 'active', label: 'Active', type: 'toggle' }],
    columns: [{ key: 'name', label: 'Brand', render: (r) => <b>{r.name}</b> }, { key: 'description', label: 'Description' }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }],
    defaults: { active: true },
  },
  suppliers: {
    title: 'Suppliers', icon: Truck, url: '/suppliers', perms: { create: ['supplier.create'], edit: ['supplier.edit'], delete: ['supplier.delete'] },
    fields: [
      { name: 'name', label: 'Supplier name', required: true, span: 2 }, { name: 'code', label: 'Code' }, { name: 'contactPerson', label: 'Contact person' },
      { name: 'mobile', label: 'Mobile' }, { name: 'email', label: 'Email' }, { name: 'gstin', label: 'GSTIN', upper: true }, { name: 'stateCode', label: 'State code', hint: 'e.g. 33 for Tamil Nadu (decides IGST)' },
      ...addr(), { name: 'openingBalance', label: 'Opening balance (payable)', type: 'number', createOnly: true }, { name: 'active', label: 'Active', type: 'toggle' },
    ],
    columns: [
      { key: 'name', label: 'Supplier', render: (r) => <><b>{r.name}</b><div className="text-xs text-ink-500">{r.code}</div></> },
      { key: 'contactPerson', label: 'Contact', render: (r) => <>{r.contactPerson}<div className="text-xs text-ink-500">{r.mobile}</div></> },
      { key: 'gstin', label: 'GSTIN', render: (r) => <span className="font-mono text-xs">{r.gstin}</span> },
      { key: 'city', label: 'City', render: (r) => r.address?.city },
      { key: 'balance', label: 'Payable', num: true, render: (r) => <b className={r.balance > 0 ? 'text-rose-600' : ''}>{inr(r.balance)}</b> },
      { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> },
    ],
    defaults: { active: true, openingBalance: 0 },
  },
  branches: {
    title: 'Branches', icon: Store, url: '/branches', perms: { create: ['branch.create'], edit: ['branch.edit'], delete: ['branch.delete'] }, noPaging: true,
    subtitle: 'One main branch, any number of sub branches — each keeps its own bills, stock and accounts',
    deleteMessage: 'The branch and ALL its bills, returns, purchases, stock, transfers, expenses and payments will be deleted permanently. A safety backup is taken first. Deleting the main branch makes the next branch the main.',
    deleteInput: true,
    fields: [
      { name: 'type', label: 'Branch type', type: 'select', options: [{ value: 'main', label: 'Main branch' }, { value: 'sub', label: 'Sub branch' }], hint: 'Only one main branch — choosing Main moves the current main under it' },
      { name: 'name', label: 'Branch name', required: true }, { name: 'code', label: 'Code', required: true, upper: true },
      { name: 'displayName', label: 'Company name (on bill & barcode)', span: 2, hint: 'Printed on this branch\'s bills and barcode labels. Empty = branch name' },
      { name: 'logoUrl', label: 'Bill logo', type: 'image', upload: '/branches/logo', hint: 'Printed on the left of this branch\'s bills, same size as now. Empty = default store logo' },
      { name: 'gstin', label: 'GSTIN', upper: true },
      { name: 'stateCode', label: 'State code', hint: 'e.g. 33 (Tamil Nadu), 32 (Kerala)' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email' },
      { name: 'managerName', label: 'Manager' }, ...addr(), { name: 'active', label: 'Active', type: 'toggle' },
    ],
    columns: [
      { key: 'name', label: 'Branch', render: (r) => <><b>{r.name}</b> <span className="badge-gray ml-1">{r.code}</span>{r.displayName && <div className="text-xs text-ink-500">{r.displayName}</div>}</> },
      { key: 'type', label: 'Type', render: (r) => (r.type === 'main' ? <span className="badge-green">Main</span> : <span className="badge-gray">Sub</span>) },
      { key: 'gstin', label: 'GSTIN', render: (r) => <span className="font-mono text-xs">{r.gstin}</span> }, { key: 'stateCode', label: 'State' },
      { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City', render: (r) => r.address?.city }, { key: 'managerName', label: 'Manager' },
      { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> },
    ],
    defaults: { active: true, type: 'sub' },
  },
  expenseCategories: {
    title: 'Expense Categories', icon: Receipt, url: '/expense-categories', perms: { create: ['expense.create', 'expense.edit'], edit: ['expense.edit'], delete: ['expense.delete'] },
    fields: [{ name: 'name', label: 'Name', required: true, span: 2 }, { name: 'description', label: 'Description', span: 2 }, { name: 'active', label: 'Active', type: 'toggle' }],
    columns: [{ key: 'name', label: 'Category', render: (r) => <b>{r.name}</b> }, { key: 'description', label: 'Description' }, { key: 'active', label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> }],
    defaults: { active: true },
  },
};

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => {
  const keys = p.split('.');
  const copy = { ...o };
  let cur = copy;
  keys.slice(0, -1).forEach((k) => { cur[k] = { ...(cur[k] || {}) }; cur = cur[k]; });
  cur[keys[keys.length - 1]] = v;
  return copy;
};

function MasterForm({ cfg, doc, onClose, onSaved }) {
  const [f, setF] = useState(doc || cfg.defaults || {});
  const [parents, setParents] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cfg.fields.some((x) => x.type === 'parent')) get('/categories', { all: 'true', parentId: 'root' }).then((d) => setParents(d.items.filter((p) => p._id !== doc?._id))); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {};
    cfg.fields.forEach((fl) => {
      if (fl.createOnly && doc) return;
      let v = getPath(f, fl.name);
      if (fl.type === 'parent') v = typeof v === 'object' && v ? v._id : v || null;
      if (fl.number || fl.type === 'number') v = v === '' || v == null ? undefined : Number(v);
      if (v !== undefined) Object.assign(body, setPath(body, fl.name, v));
    });
    try {
      const saved = doc ? await put(`${cfg.url}/${doc._id}`, body) : await post(cfg.url, body);
      toast.success(`${cfg.title.replace(/ies$/, 'y').replace(/s$/, '')} saved`);
      onSaved(saved);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${doc ? 'Edit' : 'New'} ${cfg.title.replace(/ies$/, 'y').replace(/s$/, '')}`} size="lg">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cfg.fields.filter((fl) => !(fl.createOnly && doc)).map((fl) => {
          const span = fl.span === 2 ? 'col-span-2' : 'col-span-2 sm:col-span-1';
          const v = getPath(f, fl.name);
          if (fl.type === 'image') return (
            <div key={fl.name} className="col-span-2 sm:col-span-4">
              <div className="mb-1 text-sm font-medium">{fl.label}</div>
              <div className="flex items-center gap-3">
                <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-ink-300 bg-white p-1">
                  {v ? <img src={v} alt="logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-ink-400">No logo</span>}
                </div>
                <label className="btn-secondary cursor-pointer"><Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload logo'}
                  <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={async (e) => {
                    const file = e.target.files[0]; e.target.value = '';
                    if (!file) return;
                    const fd = new FormData(); fd.append('logo', file);
                    setBusy(true);
                    try { const r = await post(fl.upload, fd); setF((cur) => setPath(cur, fl.name, r.logoUrl)); toast.success('Logo uploaded — click Save'); } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
                  }} />
                </label>
                {v && <button type="button" className="btn-ghost text-rose-600" onClick={() => setF(setPath(f, fl.name, ''))}>Remove</button>}
              </div>
              {fl.hint && <div className="mt-1 text-xs text-ink-500">{fl.hint}</div>}
            </div>
          );
          if (fl.type === 'toggle') return <div key={fl.name} className="col-span-2 sm:col-span-4"><Toggle checked={v !== false} onChange={(c) => setF(setPath(f, fl.name, c))} label={fl.label} /></div>;
          if (fl.type === 'select') return <Select key={fl.name} className={span} label={fl.label} hint={fl.hint} value={v ?? ''} onChange={(e) => setF(setPath(f, fl.name, e.target.value))} options={fl.options} />;
          if (fl.type === 'parent') return <Select key={fl.name} className="col-span-2" label={fl.label} value={(v && v._id) || v || ''} onChange={(e) => setF(setPath(f, fl.name, e.target.value))} placeholder="— Top-level category —" options={parents.map((p) => ({ value: p._id, label: p.name }))} />;
          return <Input key={fl.name} className={span} label={fl.label} required={fl.required} hint={fl.hint} type={fl.type === 'number' ? 'number' : 'text'} value={v ?? ''} onChange={(e) => setF(setPath(f, fl.name, fl.upper ? e.target.value.toUpperCase() : e.target.value))} />;
        })}
        <div className="col-span-2 flex justify-end gap-2 pt-2 sm:col-span-4"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

export default function Masters({ kind }) {
  const cfg = CONFIG[kind];
  const can = useAuth((s) => s.can);
  const reloadBranches = useAuth((s) => s.bootstrap);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [branchRows, setBranchRows] = useState(null);
  const ds = useDebounce(search, 300);
  // module-wise: New needs create, the pencil / row click needs edit, the bin needs delete
  const canCreate = can(...cfg.perms.create);
  const canEdit = can(...cfg.perms.edit);
  const canDelete = !cfg.noDelete && cfg.perms.delete.length > 0 && can(...cfg.perms.delete);
  useEffect(() => { if (cfg.noPaging) get(cfg.url).then(setBranchRows).catch((e) => toast.error(errMsg(e))); }, [reloadKey, kind]);
  const remove = async (r) => {
    const ans = await confirm({ title: `Delete ${r.name}?`, message: cfg.deleteMessage || 'Items in use cannot be deleted — mark them inactive instead.', danger: true, confirmText: 'Delete',
      ...(cfg.deleteInput ? { input: true, placeholder: 'Type DELETE to confirm' } : {}) });
    if (!ans) return;
    if (cfg.deleteInput && ans !== 'DELETE') { toast.error('Type DELETE (capital letters) to confirm'); return; }
    try {
      const res = await del(`${cfg.url}/${r._id}`);
      toast.success(res?.safetyBackup ? `Deleted ${r.name} with ${res.bills} bills, ${res.purchases} purchases. Backup: ${res.safetyBackup}` : 'Deleted', { duration: 6000 }); setReloadKey((k) => k + 1); if (kind === 'branches') reloadBranches(); } catch (e) { toast.error(errMsg(e)); }
  };
  const columns = [...cfg.columns, (canEdit || canDelete) && {
    key: 'actions', label: '', render: (r) => (
      <div className="flex justify-end gap-1">
        {canEdit && <button type="button" className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setEdit(r); }}><Pencil className="h-3.5 w-3.5" /></button>}
        {canDelete && <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={(e) => { e.stopPropagation(); remove(r); }}><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
    ),
  }].filter(Boolean);
  return (
    <div>
      <PageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} actions={canCreate && <button type="button" className="btn-primary" onClick={() => setEdit({})}><Plus className="h-4 w-4" /> New</button>} />
      {cfg.noPaging ? (
        <div className="card overflow-hidden"><table className="tbl"><thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>{(branchRows || []).map((r) => <tr key={r._id}>{columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}</tr>)}</tbody></table></div>
      ) : (
        <DataTable url={cfg.url} params={{ search: ds }} reloadKey={reloadKey} columns={columns} onRowClick={canEdit ? (r) => setEdit(r) : undefined}
          toolbar={<SearchBox value={search} onChange={setSearch} className="w-72" />} />
      )}
      {edit && <MasterForm cfg={cfg} doc={edit._id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setReloadKey((k) => k + 1); if (kind === 'branches') reloadBranches(); }} />}
    </div>
  );
}
