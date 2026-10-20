import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Truck, Trash2, Save, PackageCheck } from 'lucide-react';
import { get, post, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader, ScanInput, AsyncSelect, fetchSuppliers, BranchSelect } from '../../components/common';
import { Loading, Empty, Toggle } from '../../components/ui';
import { computeTotals, isInterState } from '../../lib/gst';
import { inr, isoDate, variantLabel, PAYMENT_LABELS } from '../../lib/format';

export default function PurchaseEntry() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { branchId, settings, branches } = useAuth();
  const [supplier, setSupplier] = useState(null);
  const [f, setF] = useState({ branchId: branchId !== 'all' ? branchId : '', invoiceNumber: '', invoiceDate: isoDate(), notes: '', billDiscount: 0 });
  const [items, setItems] = useState([]);
  const [updatePrices, setUpdatePrices] = useState(true);
  const [pay, setPay] = useState({ amount: '', mode: 'bank', reference: '' });
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    get(`/purchases/${id}`).then((p) => {
      if (p.status !== 'draft') { toast.error('Only draft purchases can be edited'); navigate('/purchase'); return; }
      setSupplier({ value: p.supplierId, label: p.supplierName });
      setF({ branchId: p.branchId, invoiceNumber: p.invoiceNumber, invoiceDate: isoDate(p.invoiceDate), notes: p.notes || '', billDiscount: p.totals.billDiscount || 0 });
      setItems(p.items.map((i) => ({ variantId: i.variantId, productName: i.productName, sku: i.sku, barcode: i.barcode, size: i.size, color: i.color, qty: i.qty, rate: i.rate, discount: i.discount, gstRate: i.gstRate, mrp: i.mrp, sellingPrice: i.sellingPrice })));
      setLoading(false);
    }).catch((e) => { toast.error(errMsg(e)); navigate('/purchase'); });
  }, [id]);

  const add = (v) => {
    const i = items.findIndex((x) => x.variantId === v._id);
    if (i >= 0) { setItems(items.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x))); return; }
    setItems([{ variantId: v._id, productName: v.productName, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color, qty: 1, rate: v.purchasePrice || 0, discount: 0, gstRate: v.gstRate, mrp: v.mrp, sellingPrice: v.sellingPrice }, ...items]);
  };
  const upd = (i, k, v) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const branch = branches.find((b) => b._id === f.branchId);
  const interState = isInterState({ mode: settings?.tax?.mode }, branch, { stateCode: supplier?.raw?.stateCode, gstNumber: supplier?.raw?.gstin });
  const { lines, totals } = useMemo(() => computeTotals(items.map((i) => ({ ...i, qty: Number(i.qty) || 0, rate: Number(i.rate) || 0, discount: Number(i.discount) || 0, gstRate: Number(i.gstRate) })), { taxInclusive: settings?.tax?.purchaseTaxInclusive ?? false, interState, billDiscount: Number(f.billDiscount) || 0 }), [items, settings, interState, f.billDiscount]);

  const save = async (status) => {
    if (!supplier) return toast.error('Select supplier');
    if (!f.branchId) return toast.error('Select branch');
    if (!f.invoiceNumber.trim()) return toast.error('Enter supplier invoice number');
    if (!items.length) return toast.error('Add at least one item');
    const bad = items.find((i) => !(Number(i.qty) > 0) || Number(i.rate) < 0);
    if (bad) return toast.error(`Check qty / rate for ${bad.sku}`);
    setBusy(true);
    const body = {
      ...f, supplierId: supplier.value, billDiscount: Number(f.billDiscount) || 0, status, updatePrices,
      items: items.map((i) => ({ variantId: i.variantId, qty: Number(i.qty), rate: Number(i.rate), discount: Number(i.discount) || 0, gstRate: Number(i.gstRate), mrp: Number(i.mrp) || undefined, sellingPrice: Number(i.sellingPrice) || undefined })),
      payment: status === 'received' && Number(pay.amount) > 0 ? { amount: Number(pay.amount), mode: pay.mode, reference: pay.reference || undefined } : undefined,
    };
    try {
      const p = id ? await put(`/purchases/${id}`, body) : await post('/purchases', body);
      toast.success(status === 'received' ? `Purchase ${p.purchaseNo} received — stock updated` : `Draft ${p.purchaseNo} saved`);
      navigate('/purchase', { state: { open: p._id } });
    } catch (e) { toast.error(errMsg(e), { duration: 6000 }); } finally { setBusy(false); }
    return null;
  };

  if (loading) return <Loading />;
  return (
    <div className="pb-10">
      <PageHeader icon={Truck} title={id ? 'Edit Purchase (Draft)' : 'Purchase Entry'} subtitle="Receiving a purchase increases branch stock automatically"
        actions={<>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => save('draft')}><Save className="h-4 w-4" /> Save draft</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => save('received')}><PackageCheck className="h-4 w-4" /> Save & receive stock</button>
        </>} />
      <div className="card card-pad grid gap-3 md:grid-cols-5">
        <AsyncSelect className="md:col-span-2" label="Supplier *" value={supplier?.value} displayValue={supplier?.label} onChange={setSupplier} fetcher={fetchSuppliers} placeholder="Select supplier" />
        <BranchSelect value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} label="Receiving branch *" />
        <label><span className="label">Supplier invoice no *</span><input className="input" value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} /></label>
        <label><span className="label">Invoice date *</span><input type="date" className="input" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} /></label>
      </div>
      <div className="card card-pad mt-4 space-y-3">
        <ScanInput onVariant={add} branchId={f.branchId || undefined} placeholder="Scan barcode / SKU to add items (F3 to search)" />
        {!items.length ? <Empty title="No items" hint="Scan barcodes or search products. Create new products first in Products → New." /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Product</th><th>Variant</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Disc ₹</th><th className="num">GST %</th><th className="num">MRP</th><th className="num">Sell price</th><th className="num">Taxable</th><th className="num">GST</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.variantId}>
                    <td className="text-ink-400">{i + 1}</td>
                    <td className="font-medium">{l.productName}<div className="font-mono text-[11px] text-ink-500">{l.sku} · {l.barcode}</div></td>
                    <td>{variantLabel(l)}</td>
                    <td className="num"><input type="number" min={1} className="input input-sm w-16 text-right" value={items[i].qty} onChange={(e) => upd(i, 'qty', e.target.value)} /></td>
                    <td className="num"><input type="number" min={0} className="input input-sm w-20 text-right" value={items[i].rate} onChange={(e) => upd(i, 'rate', e.target.value)} /></td>
                    <td className="num"><input type="number" min={0} className="input input-sm w-16 text-right" value={items[i].discount} onChange={(e) => upd(i, 'discount', e.target.value)} /></td>
                    <td className="num"><select className="input input-sm w-16" value={items[i].gstRate} onChange={(e) => upd(i, 'gstRate', e.target.value)}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}</option>)}</select></td>
                    <td className="num"><input type="number" className="input input-sm w-20 text-right" value={items[i].mrp} onChange={(e) => upd(i, 'mrp', e.target.value)} /></td>
                    <td className="num"><input type="number" className="input input-sm w-20 text-right" value={items[i].sellingPrice} onChange={(e) => upd(i, 'sellingPrice', e.target.value)} /></td>
                    <td className="num">{inr(l.taxable)}</td><td className="num text-xs">{inr(l.taxAmount)}</td><td className="num font-semibold">{inr(l.amount)}</td>
                    <td><button type="button" className="text-ink-400 hover:text-rose-600" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="card card-pad space-y-3">
          <label className="block"><span className="label">Notes</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          <Toggle checked={updatePrices} onChange={setUpdatePrices} label="Update product cost, MRP and selling price from this purchase" hint="Cost is taken excluding GST (input tax credit)" />
          <div className="grid grid-cols-3 gap-2">
            <label><span className="label">Paid now (on receive)</span><input type="number" className="input" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="0" /></label>
            <label><span className="label">Mode</span><select className="input" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{['cash', 'bank', 'upi', 'card'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
            <label><span className="label">Reference</span><input className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
          </div>
        </div>
        <div className="card card-pad space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-ink-500">Items / Qty</span><span>{items.length} / {totals.totalQty}</span></div>
          <div className="flex justify-between"><span className="text-ink-500">Gross</span><span className="tabular-nums">{inr(totals.subtotal)}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-500">Bill discount</span><input type="number" className="input input-sm w-24 text-right" value={f.billDiscount} onChange={(e) => setF({ ...f, billDiscount: e.target.value })} /></div>
          <div className="flex justify-between"><span className="text-ink-500">Taxable</span><span className="tabular-nums">{inr(totals.taxable)}</span></div>
          {interState ? <div className="flex justify-between"><span className="text-ink-500">IGST</span><span>{inr(totals.igst)}</span></div> : <><div className="flex justify-between"><span className="text-ink-500">CGST</span><span>{inr(totals.cgst)}</span></div><div className="flex justify-between"><span className="text-ink-500">SGST</span><span>{inr(totals.sgst)}</span></div></>}
          <div className="flex justify-between"><span className="text-ink-500">Round off</span><span>{inr(totals.roundOff)}</span></div>
          <div className="flex justify-between border-t border-ink-200 pt-2 text-lg font-bold dark:border-ink-700"><span>Total</span><span className="tabular-nums">{inr(totals.grandTotal)}</span></div>
        </div>
      </div>
    </div>
  );
}
