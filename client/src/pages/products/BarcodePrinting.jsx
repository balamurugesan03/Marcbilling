import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Printer, Trash2, Tag } from 'lucide-react';
import { post, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader, ScanInput } from '../../components/common';
import { Toggle, Empty } from '../../components/ui';
import { LABEL_SIZES, labelsHtml, printHtml, isAccessory } from '../../lib/print';
import { inr, variantLabel } from '../../lib/format';

export default function BarcodePrinting() {
  const { settings, company } = useAuth();
  const location = useLocation();
  const b = settings?.barcode || {};
  const [queue, setQueue] = useState([]);
  // last size used on this computer (new key: every PC starts on the 38 x 25 MARC label once)
  const [size, setSizeState] = useState(() => (LABEL_SIZES[localStorage.getItem('labelSizeV2')] ? localStorage.getItem('labelSizeV2') : 'MARC-1up'));
  const setSize = (v) => { localStorage.setItem('labelSizeV2', v); setSizeState(v); };
  const [columns, setColumns] = useState(b.labelColumns || 1);
  const [format, setFormat] = useState('');
  const [fields, setFields] = useState({
    showStoreName: b.showStoreName ?? true, showProductName: b.showProductName ?? true, showSku: b.showSku ?? true,
    showSizeColor: b.showSizeColor ?? true, showMrp: b.showMrp ?? true, showSellingPrice: b.showSellingPrice ?? true,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (location.state?.variants) setQueue(location.state.variants.map((v) => ({ ...v, qty: v.qty || 1 }))); }, [location.state]);
  const add = (v) => {
    const i = queue.findIndex((q) => q._id === v._id);
    if (i >= 0) setQueue(queue.map((q, j) => (j === i ? { ...q, qty: q.qty + 1 } : q)));
    else setQueue([...queue, { ...v, qty: 1 }]);
  };
  const [batch, setBatch] = useState('');
  const total = queue.reduce((a, q) => a + (Number(q.qty) || 0), 0);
  // accessories always print on their own 75 x 24 mm label, whatever size is chosen for the rest
  const ACC = 'ACC-75x24';
  const hasAcc = size === ACC || queue.some(isAccessory);
  const opts = (sz) => ({ size: sz, columns, storeName: company?.name, fields, format: format || undefined, batch: batch.trim() });
  const preview = useMemo(() => (queue[0] ? labelsHtml([{ ...queue[0], qty: 1 }], { ...opts(isAccessory(queue[0]) ? ACC : size), columns: 1 }) : ''), [queue[0], size, fields, format, company, batch]);

  const print = async () => {
    if (!queue.length) return toast.error('Add products to print');
    setBusy(true);
    try {
      const labels = await post('/barcodes/labels', { items: queue.map((q) => ({ variantId: q._id, qty: Number(q.qty) || 1 })) });
      const acc = size === ACC ? labels : labels.filter(isAccessory);
      const rest = size === ACC ? [] : labels.filter((l) => !isAccessory(l));
      if (acc.length && rest.length) toast('Printing accessories labels (75 x 24 roll) first, then the others', { duration: 6000 });
      if (acc.length) await printHtml(labelsHtml(acc, opts(ACC)), { title: 'Accessories labels' });
      if (rest.length) await printHtml(labelsHtml(rest, opts(size)), { title: 'Barcode labels' });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    return null;
  };

  return (
    <div>
      <PageHeader icon={Tag} title="Barcode Printing" subtitle="Bulk label printing for thermal label printers (roll) or A4 sticker sheets"
        actions={<button type="button" className="btn-primary" onClick={print} disabled={busy || !queue.length}><Printer className="h-4 w-4" /> Print {total} label(s)</button>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="card card-pad space-y-3">
          <ScanInput onVariant={add} placeholder="Scan / type SKU to add labels (each scan adds one more)" />
          {!queue.length ? <Empty title="No labels queued" hint="Scan products, or open from Purchase / Product / Variants screens to print labels for received stock." /> : (
            <table className="tbl">
              <thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th>Barcode</th><th className="num">MRP</th><th className="num">Price</th><th className="num w-28">Labels</th><th /></tr></thead>
              <tbody>
                {queue.map((q, i) => (
                  <tr key={q._id}>
                    <td className="font-medium">{q.productName}</td><td>{variantLabel(q)}</td><td className="font-mono text-xs">{q.sku}</td><td className="font-mono text-xs">{q.barcode}</td>
                    <td className="num">{inr(q.mrp)}</td><td className="num">{inr(q.sellingPrice)}</td>
                    <td className="num"><input type="number" min={1} max={500} className="input input-sm w-20 text-right" value={q.qty} onChange={(e) => setQueue(queue.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.min(500, Number(e.target.value) || 1)) } : x)))} /></td>
                    <td><button type="button" className="text-ink-400 hover:text-rose-600" onClick={() => setQueue(queue.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card card-pad h-fit space-y-4">
          <div className="section-title">Label settings</div>
          <label className="block"><span className="label">Label size</span><select className="input" value={size} onChange={(e) => setSize(e.target.value)}>{Object.entries(LABEL_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          {!LABEL_SIZES[size]?.sheet && !LABEL_SIZES[size]?.design && <label className="block"><span className="label">Labels across (roll columns)</span><select className="input" value={columns} onChange={(e) => setColumns(Number(e.target.value))}>{[1, 2, 3].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>}
          <label className="block"><span className="label">Barcode format</span><select className="input" value={format} onChange={(e) => setFormat(e.target.value)}><option value="">As stored (per variant)</option><option value="CODE128">Code128 (force)</option></select></label>
          {hasAcc && (
            <div className="space-y-2 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
              <div className="text-xs text-ink-500">Accessories print on the <b>75 x 24 mm</b> label: barcode = item code (SKU). Driver paper 75 x 24 mm, media type <b>Continuous</b> (no gap).</div>
              <label className="block"><span className="label">Batch number (optional)</span><input className="input" value={batch} maxLength={20} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. B2611" /></label>
            </div>
          )}
          <div className="space-y-2">
            {[['showStoreName', 'Store name'], ['showProductName', 'Product name'], ['showSku', 'SKU'], ['showSizeColor', 'Size / Colour'], ['showMrp', 'MRP'], ['showSellingPrice', 'Selling price']].map(([k, l]) => (
              <Toggle key={k} checked={fields[k]} onChange={(c) => setFields({ ...fields, [k]: c })} label={l} />
            ))}
          </div>
          <div className="text-xs text-ink-500">Printer: {settings?.printer?.labelPrinterName || 'choose your label printer in the print dialog'}. In the print dialog set Margins: None, Scale: 100% (not "Fit to page") and turn off Headers and footers. In the printer driver set the paper / stock size to the label size{size === 'MARC-1up' ? ' (38 x 25 mm)' : size === 'MARC-2up' ? ' (80 x 25 mm)' : size === ACC ? ' (75 x 24 mm, Continuous)' : LABEL_SIZES[size]?.sheet ? "" : ` (${LABEL_SIZES[size]?.w * columns + (columns - 1) * 2} x ${LABEL_SIZES[size]?.h} mm)`} with media type Gap / Label, and calibrate the gap sensor once.</div>
          {preview && <div><div className="label">Preview</div><iframe title="preview" srcDoc={preview} className="h-40 w-full rounded-lg border border-ink-200 bg-white dark:border-ink-700" /></div>}
        </div>
      </div>
    </div>
  );
}
