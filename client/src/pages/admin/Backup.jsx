import { useState } from 'react';
import toast from 'react-hot-toast';
import { DatabaseBackup, Download, RotateCcw, Trash2, Upload, Plus, Eraser } from 'lucide-react';
import api, { post, del, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { useFetch } from '../../hooks';
import { PageHeader } from '../../components/common';
import { Loading, Empty, StatusBadge } from '../../components/ui';
import { fdatetime } from '../../lib/format';

const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);

export default function Backup() {
  const { data, loading, reload } = useFetch('/backups');
  const logout = useAuth((s) => s.logout);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { const b = await post('/backups'); toast.success(`Backup ${b.fileName} created`); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const download = async (b) => {
    try {
      const r = await api.get(`/backups/${b._id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = b.fileName; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const afterRestore = async (r) => {
    toast.success(`Restored ${r.restored} records. Safety backup: ${r.safetyBackup}. Please login again.`, { duration: 8000 });
    await logout();
  };
  const restore = async (b) => {
    if (!(await confirm({ title: 'Restore this backup?', message: `ALL current data will be replaced with ${b.fileName}. A safety backup of the current data is taken automatically first.`, danger: true, confirmText: 'Restore' }))) return;
    setBusy(true);
    try { afterRestore(await post(`/backups/${b._id}/restore`)); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const upload = async (file) => {
    if (!(await confirm({ title: `Restore from ${file.name}?`, message: 'ALL current data will be replaced. A safety backup is taken first.', danger: true, confirmText: 'Restore' }))) return;
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try { const r = await api.post('/backups/restore/upload', fd, { timeout: 600000 }); afterRestore(r.data.data); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async (b) => {
    if (!(await confirm({ title: `Delete ${b.fileName}?`, danger: true, confirmText: 'Delete' }))) return;
    try { await del(`/backups/${b._id}`); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div>
      <PageHeader icon={DatabaseBackup} title="Backup & Restore" subtitle="Full database backups (compressed JSON). Download them and keep copies off-site."
        actions={<>
          <label className="btn-secondary cursor-pointer"><Upload className="h-4 w-4" /> Restore from file<input type="file" accept=".gz,.json" className="hidden" disabled={busy} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>
          <button type="button" className="btn-primary" disabled={busy} onClick={create}><Plus className="h-4 w-4" /> {busy ? 'Working…' : 'Backup now'}</button>
        </>} />
      <div className="card overflow-hidden">
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No backups yet" /> : (
          <table className="tbl">
            <thead><tr><th>File</th><th>Created</th><th>By</th><th>Type</th><th className="num">Collections</th><th className="num">Records</th><th className="num">Size</th><th>Last restored</th><th /></tr></thead>
            <tbody>{data.map((b) => (
              <tr key={b._id}>
                <td className="font-mono text-xs">{b.fileName}{b.notes && <div className="font-sans text-[11px] text-ink-500">{b.notes}</div>}</td>
                <td>{fdatetime(b.createdAt)}</td><td>{b.createdByName}</td><td><StatusBadge status={b.type === 'manual' ? 'active' : 'draft'} label={b.type.replace('_', ' ')} /></td>
                <td className="num">{b.collections}</td><td className="num">{b.documents?.toLocaleString('en-IN')}</td><td className="num">{size(b.size)}</td>
                <td>{b.restoredAt ? `${fdatetime(b.restoredAt)} · ${b.restoredByName}` : '-'}</td>
                <td className="whitespace-nowrap text-right">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => download(b)} title="Download"><Download className="h-4 w-4" /></button>
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => restore(b)} title="Restore"><RotateCcw className="h-4 w-4" /></button>
                  <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={() => remove(b)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <ClearData busy={busy} setBusy={setBusy} onDone={reload} />
    </div>
  );
}

function ClearData({ busy, setBusy, onDone }) {
  const [opt, setOpt] = useState({ products: true, customers: true, suppliers: true });
  const toggle = (k) => setOpt((o) => ({ ...o, [k]: !o[k] }));
  const run = async () => {
    const what = ['all bills, returns, exchanges, purchases, stock, transfers, expenses, payments and cash sessions', opt.products && 'all products & barcodes', opt.customers && 'all customers', opt.suppliers && 'all suppliers'].filter(Boolean).join(', ');
    const ans = await confirm({ title: 'Clear all data?', message: `This permanently deletes ${what} in every branch. Bill numbers start again from 1. A safety backup is taken first.`, danger: true, confirmText: 'Clear data', input: true, placeholder: 'Type DELETE to confirm' });
    if (!ans) return;
    if (ans !== 'DELETE') { toast.error('Type DELETE (capital letters) to confirm'); return; }
    setBusy(true);
    try {
      const r = await post('/companies/current/clear-data', { ...opt, confirm: 'DELETE' }, { timeout: 600000 });
      toast.success(`Data cleared. Safety backup: ${r.safetyBackup}`, { duration: 8000 });
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card mt-6 border border-rose-200 p-4 dark:border-rose-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-rose-600"><Eraser className="h-4 w-4" /> Clear all data (fresh start)</div>
          <div className="text-sm text-ink-500">Deletes every bill, return, purchase, stock entry, transfer, expense and payment. Company, branches, users, roles, settings, categories and brands are kept.</div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={opt.products} onChange={() => toggle('products')} /> Products &amp; barcodes</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={opt.customers} onChange={() => toggle('customers')} /> Customers</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={opt.suppliers} onChange={() => toggle('suppliers')} /> Suppliers</label>
          </div>
        </div>
        <button type="button" className="btn-danger" disabled={busy} onClick={run}><Eraser className="h-4 w-4" /> {busy ? 'Working…' : 'Clear all data'}</button>
      </div>
    </div>
  );
}
