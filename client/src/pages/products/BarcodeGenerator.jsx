import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Barcode, RefreshCcw, ShieldCheck, Trash2, Printer } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { PageHeader, ScanInput } from '../../components/common';
import { barcodeSvg } from '../../lib/print';
import { variantLabel } from '../../lib/format';

export default function BarcodeGenerator() {
  const settings = useAuth((s) => s.settings);
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [format, setFormat] = useState(settings?.barcode?.defaultFormat || 'EAN13');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState({ code: '', format: '', result: null });

  const add = (v) => { if (!list.some((x) => x._id === v._id)) setList([...list, v]); };
  const regenerate = async () => {
    if (!list.length) return toast.error('Add variants first');
    if (!(await confirm({ title: `Generate new ${format} barcodes for ${list.length} variant(s)?`, message: 'Old barcodes stay registered as alternates, so labels already printed still scan.', confirmText: 'Generate' }))) return null;
    setBusy(true);
    try {
      const r = await post('/barcodes/bulk-generate', { variantIds: list.map((v) => v._id), format });
      const map = new Map(r.map((x) => [String(x.variantId), x.barcode]));
      setList(list.map((v) => ({ ...v, barcode: map.get(String(v._id)) || v.barcode, barcodeFormat: format })));
      toast.success(`${r.length} barcode(s) generated`);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    return null;
  };
  const validate = async (e) => {
    e.preventDefault();
    try { setCheck({ ...check, result: await post('/barcodes/validate', { code: check.code, format: check.format || undefined }) }); } catch (err) { toast.error(errMsg(err)); }
  };

  return (
    <div>
      <PageHeader icon={Barcode} title="Barcode Generator" subtitle="Auto / bulk barcode generation (EAN-13 with check digit or Code128), validation and duplicate checks" />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="card card-pad space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[280px] flex-1"><span className="label">Add variants (scan / search)</span><ScanInput onVariant={add} /></div>
            <label><span className="label">Format</span><select className="input w-32" value={format} onChange={(e) => setFormat(e.target.value)}><option value="EAN13">EAN-13</option><option value="CODE128">Code128</option></select></label>
            <button type="button" className="btn-primary" onClick={regenerate} disabled={busy}><RefreshCcw className="h-4 w-4" /> Bulk generate</button>
            <button type="button" className="btn-secondary" disabled={!list.length} onClick={() => navigate('/products/labels', { state: { variants: list.map((v) => ({ ...v, qty: 1 })) } })}><Printer className="h-4 w-4" /> Print</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((v) => (
              <div key={v._id} className="relative rounded-xl border border-ink-200 p-3 text-center dark:border-ink-700">
                <button type="button" className="absolute right-2 top-2 text-ink-400 hover:text-rose-600" onClick={() => setList(list.filter((x) => x._id !== v._id))}><Trash2 className="h-3.5 w-3.5" /></button>
                <div className="truncate text-xs font-semibold">{v.productName}</div>
                <div className="text-[11px] text-ink-500">{variantLabel(v)} · {v.sku}</div>
                <div className="mx-auto mt-2 rounded bg-white p-1 [&_svg]:mx-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(v.barcode, { format: v.barcodeFormat, height: 44 }) }} />
              </div>
            ))}
          </div>
          {!list.length && <div className="py-10 text-center text-sm text-ink-500">Scan or search products to preview and (re)generate barcodes. New products get barcodes automatically.</div>}
        </div>
        <form onSubmit={validate} className="card card-pad h-fit space-y-3">
          <div className="section-title flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" /> Validate a barcode</div>
          <input className="input font-mono" placeholder="Enter barcode" value={check.code} onChange={(e) => setCheck({ ...check, code: e.target.value, result: null })} />
          <select className="input" value={check.format} onChange={(e) => setCheck({ ...check, format: e.target.value, result: null })}><option value="">Auto-detect</option><option value="EAN13">EAN-13</option><option value="CODE128">Code128</option></select>
          <button className="btn-secondary w-full" disabled={!check.code}>Check</button>
          {check.result && <div className={`rounded-lg p-3 text-sm ${check.result.valid ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10'}`}>{check.result.format}: {check.result.message}</div>}
          {check.result?.valid && <div className="rounded bg-white p-2 [&_svg]:mx-auto" dangerouslySetInnerHTML={{ __html: barcodeSvg(check.code, { format: check.result.format }) }} />}
          <div className="text-xs text-ink-500">Dress prefix: EAN-13 <b>{settings?.barcode?.ean13Prefix}</b> · Code128 <b>{settings?.barcode?.code128Prefix}</b><br />Accessories prefix: EAN-13 <b>{settings?.barcode?.accessoryEan13Prefix}</b> · Code128 <b>{settings?.barcode?.accessoryCode128Prefix}</b> (change in Settings → Barcode)</div>
        </form>
      </div>
    </div>
  );
}
