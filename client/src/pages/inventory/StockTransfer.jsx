import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeftRight, Plus, Send, PackageCheck, Ban, Trash2, Printer, Save } from 'lucide-react';
import { get, post, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { useAppEvent } from '../../hooks';
import { PageHeader, DataTable, ScanInput, BranchSelect } from '../../components/common';
import { Modal, Loading, StatusBadge, Empty, Tabs } from '../../components/ui';
import { fdatetime, variantLabel, inr, titleCase } from '../../lib/format';
import { printHtml, simpleDocHtml } from '../../lib/print';

function TransferForm({ transfer, onClose, onDone }) {
  const branchId = useAuth((s) => s.branchId);
  const [from, setFrom] = useState(transfer?.fromBranchId?._id || (branchId !== 'all' ? branchId : ''));
  const [to, setTo] = useState(transfer?.toBranchId?._id || '');
  const [notes, setNotes] = useState(transfer?.notes || '');
  const [items, setItems] = useState(transfer?.items?.map((i) => ({ variantId: i.variantId, productName: i.productName, sku: i.sku, size: i.size, color: i.color, qty: i.qty, stock: i.sourceStock })) || []);
  const [busy, setBusy] = useState(false);
  const add = (v) => {
    const i = items.findIndex((x) => x.variantId === v._id);
    const have = i >= 0 ? Number(items[i].qty) : 0;
    if (have + 1 > (v.stock ?? 0)) return toast.error(`Only ${v.stock ?? 0} in stock at source`);
    if (i >= 0) setItems(items.map((x, j) => (j === i ? { ...x, qty: have + 1, stock: v.stock } : x)));
    else setItems([...items, { variantId: v._id, productName: v.productName, sku: v.sku, size: v.size, color: v.color, qty: 1, stock: v.stock }]);
    return null;
  };
  const submit = async (send) => {
    if (!from || !to) return toast.error('Select source and destination branch');
    if (from === to) return toast.error('Source and destination must differ');
    if (!items.length) return toast.error('Add items');
    const over = items.find((i) => Number(i.qty) > i.stock || !(Number(i.qty) > 0));
    if (over) return toast.error(`Invalid qty for ${over.sku} (available ${over.stock})`);
    setBusy(true);
    try {
      const body = { fromBranchId: from, toBranchId: to, notes, send, items: items.map((i) => ({ variantId: i.variantId, qty: Number(i.qty) })) };
      const t = transfer ? await put(`/transfers/${transfer._id}`, body) : await post('/transfers', body);
      toast.success(send ? `Transfer ${t.transferNo} sent` : `Draft ${t.transferNo} saved`);
      onDone(t);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    return null;
  };
  return (
    <Modal open onClose={onClose} title={transfer ? `Edit ${transfer.transferNo}` : 'New Stock Transfer'} size="xl"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => submit(false)}><Save className="h-4 w-4" /> Save draft</button><button type="button" className="btn-primary" disabled={busy} onClick={() => submit(true)}><Send className="h-4 w-4" /> Send now</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <BranchSelect label="Source branch" value={from} onChange={(v) => { setFrom(v); setItems([]); }} />
        <BranchSelect label="Destination branch" value={to} onChange={setTo} all exclude={from} />
        <label><span className="label">Notes</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      <div className="mt-4">{from ? <ScanInput onVariant={add} branchId={from} placeholder="Scan products to transfer (stock shown is at source branch)" /> : <div className="text-sm text-ink-500">Select the source branch first.</div>}</div>
      {items.length ? (
        <table className="tbl mt-3">
          <thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th className="num">Available</th><th className="num w-28">Transfer qty</th><th /></tr></thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.variantId}>
                <td className="font-medium">{i.productName}</td><td>{variantLabel(i)}</td><td className="font-mono text-xs">{i.sku}</td><td className="num">{i.stock}</td>
                <td className="num"><input type="number" min={1} max={i.stock} className={`input input-sm w-20 text-right ${Number(i.qty) > i.stock ? 'input-error' : ''}`} value={i.qty} onChange={(e) => setItems(items.map((x, j) => (j === n ? { ...x, qty: e.target.value } : x)))} /></td>
                <td><button type="button" className="text-ink-400 hover:text-rose-600" onClick={() => setItems(items.filter((_, j) => j !== n))}><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty title="No items" />}
      <div className="mt-2 text-right text-sm">Total qty: <b>{items.reduce((a, i) => a + (Number(i.qty) || 0), 0)}</b></div>
    </Modal>
  );
}

function TransferDetail({ id, onClose, onChanged }) {
  const company = useAuth((s) => s.company);
  const allowedBranch = useAuth((s) => s.branches);
  const user = useAuth((s) => s.user);
  const [t, setT] = useState(null);
  const [recv, setRecv] = useState({});
  const [edit, setEdit] = useState(false);
  const load = () => get(`/transfers/${id}`).then((d) => { setT(d); setRecv(Object.fromEntries(d.items.map((i) => [i._id, i.qty]))); }).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [id]);
  const mine = (bid) => user.role.allBranches || allowedBranch.some((b) => b._id === bid);
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); await load(); onChanged(); } catch (e) { toast.error(errMsg(e)); } };
  const cancel = async () => {
    const reason = await confirm({ title: `Cancel ${t.transferNo}?`, message: t.status === 'sent' ? 'Stock will be returned to the source branch.' : '', input: true, placeholder: 'Reason', danger: true, confirmText: 'Cancel transfer' });
    if (reason) act(() => post(`/transfers/${id}/cancel`, { reason }), 'Transfer cancelled');
  };
  const print = () => printHtml(simpleDocHtml({
    title: `Stock Transfer Note ${t.transferNo}`, company, subtitle: `${t.fromBranchId.name} → ${t.toBranchId.name}`,
    meta: [['Status', titleCase(t.status)], ['Created', fdatetime(t.createdAt)], ['Sent', fdatetime(t.sentAt)], ['Received', fdatetime(t.receivedAt)], ['Notes', t.notes || '-']],
    columns: [{ key: 'productName', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' }, { key: 'v', label: 'Variant' }, { key: 'qty', label: 'Sent', right: true }, { key: 'receivedQty', label: 'Received', right: true }],
    rows: t.items.map((i) => ({ ...i, v: variantLabel(i) })),
    totals: [['Total qty', t.totalQty], ['Value (cost)', inr(t.totalValue)]],
  }));
  return (
    <Modal open onClose={onClose} title={t ? `Transfer ${t.transferNo}` : 'Transfer'} size="xl"
      footer={t && <>
        <button type="button" className="btn-secondary mr-auto" onClick={print}><Printer className="h-4 w-4" /> Print note</button>
        {['draft', 'sent'].includes(t.status) && mine(t.fromBranchId._id) && <button type="button" className="btn-danger" onClick={cancel}><Ban className="h-4 w-4" /> Cancel</button>}
        {t.status === 'draft' && mine(t.fromBranchId._id) && <><button type="button" className="btn-secondary" onClick={() => setEdit(true)}>Edit</button><button type="button" className="btn-primary" onClick={() => act(() => post(`/transfers/${id}/send`), 'Transfer sent')}><Send className="h-4 w-4" /> Send</button></>}
        {t.status === 'sent' && mine(t.toBranchId._id) && <button type="button" className="btn-success" onClick={() => act(() => post(`/transfers/${id}/receive`, { items: t.items.map((i) => ({ itemId: i._id, receivedQty: Number(recv[i._id]) })) }), 'Stock received at destination')}><PackageCheck className="h-4 w-4" /> Receive</button>}
      </>}>
      {!t ? <Loading /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-lg bg-ink-100 px-3 py-1.5 font-semibold dark:bg-ink-800">{t.fromBranchId.name}</span><ArrowLeftRight className="h-4 w-4 text-ink-400" /><span className="rounded-lg bg-ink-100 px-3 py-1.5 font-semibold dark:bg-ink-800">{t.toBranchId.name}</span>
            <StatusBadge status={t.status} /><span className="text-ink-500">{t.totalQty} pcs · {inr(t.totalValue)}</span>
          </div>
          <table className="tbl">
            <thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th className="num">Sent</th><th className="num">{t.status === 'sent' ? 'Receive qty' : 'Received'}</th></tr></thead>
            <tbody>{t.items.map((i) => (
              <tr key={i._id}><td className="font-medium">{i.productName}</td><td>{variantLabel(i)}</td><td className="font-mono text-xs">{i.sku}</td><td className="num">{i.qty}</td>
                <td className="num">{t.status === 'sent' && mine(t.toBranchId._id) ? <input type="number" min={0} max={i.qty} className="input input-sm w-20 text-right" value={recv[i._id]} onChange={(e) => setRecv({ ...recv, [i._id]: Math.max(0, Math.min(i.qty, Number(e.target.value) || 0)) })} /> : i.receivedQty}</td></tr>
            ))}</tbody>
          </table>
          <div>
            <div className="label">History</div>
            <ol className="space-y-1 text-xs">{t.history.map((h, k) => <li key={k} className="flex gap-2"><StatusBadge status={h.status} /><span>{fdatetime(h.at)} · {h.userName}</span>{h.note && <span className="text-ink-500">— {h.note}</span>}</li>)}</ol>
          </div>
          {edit && <TransferForm transfer={t} onClose={() => setEdit(false)} onDone={() => { setEdit(false); load(); onChanged(); }} />}
        </div>
      )}
    </Modal>
  );
}

export default function StockTransfer() {
  const [tab, setTab] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const branchId = useAuth((s) => s.branchId);
  useAppEvent('transfer', () => setReloadKey((k) => k + 1));
  return (
    <div>
      <PageHeader icon={ArrowLeftRight} title="Stock Transfer" subtitle="Branch-to-branch transfers: Draft → Sent → Received (or Cancelled)"
        actions={<button type="button" className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New transfer</button>} />
      {branchId !== 'all' && <div className="mb-3"><Tabs value={tab} onChange={setTab} tabs={[{ value: '', label: 'All' }, { value: 'out', label: 'Outgoing' }, { value: 'in', label: 'Incoming' }]} /></div>}
      <DataTable url="/transfers" params={{ direction: tab, status }} reloadKey={reloadKey} onRowClick={(r) => setOpen(r._id)}
        toolbar={<select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All status</option>{['draft', 'sent', 'received', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>}
        columns={[
          { key: 'transferNo', label: 'Transfer No', render: (r) => <span className="font-mono text-xs font-semibold">{r.transferNo}</span> },
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'from', label: 'From', render: (r) => r.fromBranchId?.name },
          { key: 'to', label: 'To', render: (r) => r.toBranchId?.name },
          { key: 'totalItems', label: 'Items', num: true },
          { key: 'totalQty', label: 'Qty', num: true },
          { key: 'totalValue', label: 'Value', num: true, render: (r) => inr(r.totalValue) },
          { key: 'createdBy', label: 'By', render: (r) => r.createdBy?.name },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      {creating && <TransferForm onClose={() => setCreating(false)} onDone={(t) => { setCreating(false); setReloadKey((k) => k + 1); setOpen(t._id); }} />}
      {open && <TransferDetail id={open} onClose={() => setOpen(null)} onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}
