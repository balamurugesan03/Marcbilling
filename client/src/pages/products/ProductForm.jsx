import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Package, Save, Wand2, Trash2, Upload, X, Printer, CheckCircle2, AlertCircle } from 'lucide-react';
import api, { get, post, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader, BranchSelect } from '../../components/common';
import { Input, Select, Loading, Field } from '../../components/ui';
import { inr } from '../../lib/format';

const GENDERS = ['Men', 'Women', 'Boys', 'Girls', 'Kids', 'Unisex'];
const SEASONS = ['All Season', 'Summer', 'Winter', 'Monsoon', 'Festive', 'Wedding'];
// full ranges, smallest to largest: pick a preset, then delete the sizes a product does not come in
const SIZE_PRESETS = {
  'Men / Unisex (XS - 6XL)': 'XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL',
  'Ladies (XS - 6XL)': 'XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL',
  'Ladies numeric (28 - 50)': '28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50',
  'Kids (0-6M - 15-16Y)': '0-6M, 6-12M, 12-18M, 18-24M, 2-3Y, 3-4Y, 4-5Y, 5-6Y, 6-7Y, 7-8Y, 8-9Y, 9-10Y, 10-11Y, 11-12Y, 12-13Y, 13-14Y, 14-15Y, 15-16Y',
  'Pants waist (26 - 44)': '26, 28, 30, 32, 34, 36, 38, 40, 42, 44',
  'Shirts (36 - 48)': '36, 38, 40, 42, 44, 46, 48',
  'Footwear (UK 4 - 12)': '4, 5, 6, 7, 8, 9, 10, 11, 12',
  Free: 'Free',
};
const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const empty = {
  productCode: '', name: '', categoryId: '', subCategoryId: '', brandId: '', gender: 'Unisex', season: 'All Season', hsnCode: '', gstRate: 5,
  unit: 'PCS', purchasePrice: '', sellingPrice: '', mrp: '', discountPercent: 0, supplierId: '', description: '', images: [], fabric: '', pattern: '', style: '', status: 'active',
};

function BarcodeCell({ value, format, variantId, onChange }) {
  const [state, setState] = useState(null);
  const check = async () => {
    if (!value) return setState(null);
    try {
      const r = await post('/barcodes/validate', { code: value, format: format || undefined, variantId });
      setState(r);
    } catch (e) { setState({ valid: false, message: errMsg(e) }); }
    return null;
  };
  return (
    <div className="relative">
      <input className={`input input-sm w-36 font-mono ${state && !state.valid ? 'input-error' : ''}`} placeholder="Auto" value={value || ''} onChange={(e) => { onChange(e.target.value); setState(null); }} onBlur={check} title={state?.message} />
      {state && (state.valid ? <CheckCircle2 className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-emerald-500" /> : <AlertCircle className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-rose-500" title={state.message} />)}
      {state && !state.valid && <div className="mt-0.5 max-w-[9rem] text-[10px] leading-tight text-rose-600">{state.message}</div>}
    </div>
  );
}

export default function ProductForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { branchId, can, settings } = useAuth();
  const [f, setF] = useState(empty);
  const [variants, setVariants] = useState([]);
  const [sizes, setSizes] = useState('S, M, L, XL');
  const [colors, setColors] = useState('');
  const [cats, setCats] = useState([]);
  const [subs, setSubs] = useState([]);
  const [brands, setBrands] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [openingBranch, setOpeningBranch] = useState(branchId !== 'all' ? branchId : '');
  const [applyPrices, setApplyPrices] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    get('/categories', { all: 'true', parentId: 'root', active: 'true' }).then((d) => setCats(d.items)).catch(() => {});
    get('/brands', { all: 'true', active: 'true' }).then((d) => setBrands(d.items)).catch(() => {});
    get('/suppliers', { all: 'true', active: 'true' }).then((d) => setSuppliers(d.items)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!id) {
      const bc = sp.get('barcode');
      if (bc) setVariants([{ size: '', color: '', barcode: bc, openingStock: 0 }]);
      return;
    }
    get(`/products/${id}`).then((p) => {
      setF({ ...empty, ...p, categoryId: p.categoryId || '', subCategoryId: p.subCategoryId || '', brandId: p.brandId || '', supplierId: p.supplierId || '' });
      setVariants(p.variants.map((v) => ({ ...v })));
      setLoading(false);
    }).catch((e) => { toast.error(errMsg(e)); navigate('/products'); });
  }, [id]);
  useEffect(() => {
    if (!f.categoryId) { setSubs([]); return; }
    get('/categories', { all: 'true', parentId: f.categoryId }).then((d) => setSubs(d.items)).catch(() => {});
  }, [f.categoryId]);

  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  // Accessories: no sizes (the size box and column are hidden, Generate makes one variant per colour)
  const isAcc = /accessor/i.test(cats.find((c) => c._id === f.categoryId)?.name || '');
  const onCategory = (e) => {
    const cat = cats.find((c) => c._id === e.target.value);
    setF({ ...f, categoryId: e.target.value, subCategoryId: '', gstRate: cat?.defaultGstRate ?? f.gstRate, hsnCode: f.hsnCode || cat?.defaultHsnCode || '' });
  };
  const generate = () => {
    const S = isAcc ? [] : split(sizes); // accessories have no sizes
    const C = split(colors);
    if (!S.length && !C.length && !isAcc) return toast.error('Enter sizes and/or colours'); // accessory with no colour: one variant
    const combos = (C.length ? C : ['']).flatMap((color) => (S.length ? S : ['']).map((size) => ({ color, size })));
    const key = (v) => `${(v.color || '').toLowerCase()}|${(v.size || '').toLowerCase()}`;
    const existing = new Set(variants.map(key));
    const added = combos.filter((c) => !existing.has(key(c))).map((c) => ({ ...c, barcode: '', openingStock: 0 }));
    setVariants([...variants.filter((v) => isAcc || v._id || v.barcode || v.color || v.size), ...added]);
    toast.success(`${added.length} variant(s) added`);
    return null;
  };
  const upd = (i, k, v) => setVariants(variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const uploadImages = async (files) => {
    const fd = new FormData();
    [...files].forEach((file) => fd.append('images', file));
    try {
      const r = await api.post('/products/images', fd);
      setF((p) => ({ ...p, images: [...(p.images || []), ...r.data.data].slice(0, 8) }));
    } catch (e) { toast.error(errMsg(e)); }
  };

  const validate = () => {
    const e = {};
    if (!f.name.trim()) e.name = 'Product name is required';
    if (!f.productCode.trim()) e.productCode = 'Product code is required';
    if (!f.categoryId) e.categoryId = 'Category is required';
    if (f.sellingPrice === '' || Number(f.sellingPrice) < 0) e.sellingPrice = 'Selling price is required';
    if (f.mrp === '' || Number(f.mrp) < 0) e.mrp = 'MRP is required';
    if (Number(f.sellingPrice) > Number(f.mrp)) e.sellingPrice = 'Selling price cannot exceed MRP';
    if (![0, 5, 12, 18, 28].includes(Number(f.gstRate))) e.gstRate = 'Invalid GST %';
    if (!variants.length) e.variants = 'Add at least one variant';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const opening = useMemo(() => variants.reduce((a, v) => a + (Number(v.openingStock) || 0), 0), [variants]);
  const save = async () => {
    if (!validate()) return toast.error(Object.values(errors)[0] || 'Please fix the highlighted fields');
    if (!id && opening > 0 && !openingBranch) return toast.error('Select the branch for opening stock');
    const num = (v) => (v === '' || v == null ? undefined : Number(v));
    const body = {
      ...f, gstRate: Number(f.gstRate), purchasePrice: Number(f.purchasePrice) || 0, sellingPrice: Number(f.sellingPrice), mrp: Number(f.mrp),
      discountPercent: Number(f.discountPercent) || 0,
      variants: variants.map((v) => ({
        _id: v._id, size: v.size, color: v.color, fabric: v.fabric, pattern: v.pattern, style: v.style, sku: v.sku || undefined, barcode: v.barcode || undefined,
        barcodeFormat: v.barcode ? undefined : v.barcodeFormat, purchasePrice: num(v.purchasePrice), sellingPrice: num(v.sellingPrice), mrp: num(v.mrp),
        reorderLevel: num(v.reorderLevel), status: v.status, openingStock: id ? undefined : num(v.openingStock),
      })),
    };
    ['_id', 'companyId', 'createdAt', 'updatedAt', '__v', 'variantCount', 'categoryName', 'brandName', 'supplierName', 'deletedAt', 'createdBy'].forEach((k) => delete body[k]);
    if (!id) body.openingStockBranchId = openingBranch || undefined;
    else body.applyPricesToVariants = applyPrices;
    setSaving(true);
    try {
      const p = id ? await put(`/products/${id}`, body) : await post('/products', body);
      toast.success(id ? 'Product updated' : `Product ${p.productCode} created with ${p.variants.length} variant(s)`);
      if (sp.get('return')) navigate(sp.get('return'));
      else setSaved(p);
    } catch (e) { toast.error(errMsg(e), { duration: 6000 }); } finally { setSaving(false); }
    return null;
  };

  if (loading) return <Loading />;
  if (saved) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <h2 className="mt-3 text-xl font-bold">{saved.name} saved</h2>
        <p className="text-sm text-ink-500">{saved.productCode} · {saved.variants.length} variants with barcodes</p>
        <div className="mt-6 flex justify-center gap-2">
          {can('barcode.print') && <button type="button" className="btn-secondary" onClick={() => navigate('/products/labels', { state: { variants: saved.variants.map((v) => ({ ...v, qty: Math.max(1, v.stock || 1) })) } })}><Printer className="h-4 w-4" /> Print barcode labels</button>}
          <button type="button" className="btn-secondary" onClick={() => { setSaved(null); setF(empty); setVariants([]); navigate('/products/new'); }}>Add another</button>
          <button type="button" className="btn-primary" onClick={() => navigate('/products')}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20">
      <PageHeader icon={Package} title={id ? `Edit ${f.name}` : 'New Product'} subtitle={id ? f.productCode : 'Each size / colour combination gets its own SKU and barcode'}
        actions={<><button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button><button type="button" className="btn-primary" onClick={save} disabled={saving}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save product'}</button></>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card card-pad grid grid-cols-2 gap-3 xl:col-span-2 md:grid-cols-4">
          <Input className="col-span-2" label="Product name" required value={f.name} onChange={set('name')} error={errors.name} placeholder="e.g. Round Neck Cotton T-Shirt" />
          <Input label="Product code" required value={f.productCode} onChange={set('productCode')} error={errors.productCode} placeholder="e.g. TS101" />
          <Select label="Status" value={f.status} onChange={set('status')} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          <Select label="Category" required value={f.categoryId} onChange={onCategory} placeholder="Select" options={cats.map((c) => ({ value: c._id, label: c.name }))} error={errors.categoryId} />
          <Select label="Sub category" value={f.subCategoryId} onChange={set('subCategoryId')} placeholder="None" options={subs.map((c) => ({ value: c._id, label: c.name }))} />
          <Select label="Brand" value={f.brandId} onChange={set('brandId')} placeholder="None" options={brands.map((b) => ({ value: b._id, label: b.name }))} />
          <Select label="Supplier" value={f.supplierId} onChange={set('supplierId')} placeholder="None" options={suppliers.map((s) => ({ value: s._id, label: s.name }))} />
          <Select label="Gender" value={f.gender} onChange={set('gender')} options={GENDERS} />
          <Select label="Season" value={f.season} onChange={set('season')} options={SEASONS} />
          <Input label="HSN code" value={f.hsnCode} onChange={set('hsnCode')} />
          <Select label="GST %" required value={f.gstRate} onChange={set('gstRate')} options={[0, 5, 12, 18, 28].map((g) => ({ value: g, label: `${g}%` }))} error={errors.gstRate} />
          <Input label="Purchase price" type="number" value={f.purchasePrice} onChange={set('purchasePrice')} />
          <Input label="MRP" required type="number" value={f.mrp} onChange={set('mrp')} error={errors.mrp} />
          <Input label="Selling price" required type="number" value={f.sellingPrice} onChange={set('sellingPrice')} error={errors.sellingPrice} hint={settings?.tax?.taxInclusive ? 'Inclusive of GST' : 'Exclusive of GST'} />
          <Input label="Unit" value={f.unit} onChange={set('unit')} />
          <Input label="Fabric" value={f.fabric || ''} onChange={set('fabric')} />
          <Input label="Pattern" value={f.pattern || ''} onChange={set('pattern')} />
          <Input label="Style" value={f.style || ''} onChange={set('style')} />
          <Input label="Default discount %" type="number" value={f.discountPercent} onChange={set('discountPercent')} />
          <Field label="Description" className="col-span-2 md:col-span-4"><textarea className="input" rows={2} value={f.description || ''} onChange={set('description')} /></Field>
          {id && <label className="col-span-2 flex items-center gap-2 text-sm md:col-span-4"><input type="checkbox" checked={applyPrices} onChange={(e) => setApplyPrices(e.target.checked)} /> Apply product prices (MRP / selling / purchase) to all variants</label>}
        </div>
        <div className="card card-pad">
          <div className="section-title mb-3">Product images</div>
          <div className="grid grid-cols-3 gap-2">
            {(f.images || []).map((src, i) => (
              <div key={src} className="group relative aspect-square overflow-hidden rounded-lg border border-ink-200 dark:border-ink-700">
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button type="button" className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-1 text-white group-hover:block" onClick={() => setF({ ...f, images: f.images.filter((_, j) => j !== i) })}><X className="h-3 w-3" /></button>
              </div>
            ))}
            <label className="grid aspect-square cursor-pointer place-items-center rounded-lg border-2 border-dashed border-ink-300 text-ink-400 hover:border-brand-400 hover:text-brand-500 dark:border-ink-700">
              <div className="text-center text-xs"><Upload className="mx-auto mb-1 h-5 w-5" />Upload</div>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadImages(e.target.files)} />
            </label>
          </div>
          {!id && opening > 0 && <div className="mt-5"><BranchSelect label="Opening stock goes to" value={openingBranch} onChange={setOpeningBranch} /></div>}
          <div className="mt-5 rounded-lg bg-ink-50 p-3 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">
            Barcodes left blank are generated automatically ({settings?.barcode?.defaultFormat || 'EAN13'}). Enter a manufacturer barcode to use it instead — duplicates are rejected.
          </div>
        </div>
      </div>

      <div className="card card-pad mt-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="section-title mr-auto">Variants ({variants.length}) {errors.variants && <span className="ml-2 text-xs font-normal text-rose-600">{errors.variants}</span>}</div>
          {!isAcc && <label className="w-96"><span className="label">Sizes (comma separated)</span><input className="input" value={sizes} onChange={(e) => setSizes(e.target.value)} /></label>}
          {!isAcc && <select className="input w-56" value="" onChange={(e) => e.target.value && setSizes(SIZE_PRESETS[e.target.value])}><option value="">Presets…</option>{Object.keys(SIZE_PRESETS).map((k) => <option key={k}>{k}</option>)}</select>}
          {isAcc && <div className="max-w-xs text-xs text-ink-500">Accessories have no sizes. Enter colours (optional) and click Generate: one variant per colour, or one variant if blank.</div>}
          <label className="w-64"><span className="label">Colours {isAcc ? "(optional)" : "(comma separated)"}</span><input className="input" value={colors} onChange={(e) => setColors(e.target.value)} placeholder="Black, White, Navy" /></label>
          <button type="button" className="btn-secondary" onClick={generate}><Wand2 className="h-4 w-4" /> Generate</button>
          <button type="button" className="btn-ghost" onClick={() => setVariants([...variants, { size: '', color: '', barcode: '', openingStock: 0 }])}>+ Row</button>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Colour</th>{!isAcc && <th>Size</th>}<th>SKU</th><th>Barcode</th><th className="num">Purchase</th><th className="num">MRP</th><th className="num">Selling</th>{id ? <th className="num">Stock</th> : <th className="num">Opening stock</th>}<th>Reorder</th><th>Status</th><th /></tr></thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v._id || i}>
                  <td><input className="input input-sm w-28" value={v.color || ''} onChange={(e) => upd(i, 'color', e.target.value)} /></td>
                  {!isAcc && <td><input className="input input-sm w-20" value={v.size || ''} onChange={(e) => upd(i, 'size', e.target.value)} /></td>}
                  <td><input className="input input-sm w-36 font-mono" placeholder="Auto" value={v.sku || ''} onChange={(e) => upd(i, 'sku', e.target.value.toUpperCase())} /></td>
                  <td><BarcodeCell value={v.barcode} format={v.barcodeFormat} variantId={v._id} onChange={(val) => upd(i, 'barcode', val)} /></td>
                  <td className="num"><input type="number" className="input input-sm w-20 text-right" placeholder={f.purchasePrice} value={v.purchasePrice ?? ''} onChange={(e) => upd(i, 'purchasePrice', e.target.value)} /></td>
                  <td className="num"><input type="number" className="input input-sm w-20 text-right" placeholder={f.mrp} value={v.mrp ?? ''} onChange={(e) => upd(i, 'mrp', e.target.value)} /></td>
                  <td className="num"><input type="number" className="input input-sm w-20 text-right" placeholder={f.sellingPrice} value={v.sellingPrice ?? ''} onChange={(e) => upd(i, 'sellingPrice', e.target.value)} /></td>
                  {id ? <td className="num font-semibold">{v.stock ?? 0}</td> : <td className="num"><input type="number" min={0} className="input input-sm w-20 text-right" value={v.openingStock || ''} placeholder="0" onChange={(e) => upd(i, 'openingStock', e.target.value)} /></td>}
                  <td><input type="number" min={0} className="input input-sm w-16" value={v.reorderLevel ?? ''} onChange={(e) => upd(i, 'reorderLevel', e.target.value)} /></td>
                  <td><select className="input input-sm w-24" value={v.status || 'active'} onChange={(e) => upd(i, 'status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></td>
                  <td><button type="button" className="text-ink-400 hover:text-rose-600" title={v._id ? 'Remove variant (only if no stock)' : 'Remove'} onClick={() => setVariants(variants.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!variants.length && <div className="py-8 text-center text-sm text-ink-500">Enter sizes and colours above and click Generate.</div>}
        </div>
        {variants.length > 0 && <div className="mt-2 text-xs text-ink-500">Blank prices inherit from the product (MRP {inr(f.mrp || 0)}, selling {inr(f.sellingPrice || 0)}).</div>}
      </div>
    </div>
  );
}
