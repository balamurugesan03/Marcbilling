import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Package, Plus, Pencil, Trash2, Tags } from 'lucide-react';
import { get, del, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { confirm } from '../../store/ui';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox } from '../../components/common';
import { StatusBadge } from '../../components/ui';
import { inr } from '../../lib/format';

export default function Products() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [status, setStatus] = useState('');
  const [cats, setCats] = useState([]);
  const [brands, setBrands] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const ds = useDebounce(search, 300);
  useEffect(() => {
    get('/categories', { all: 'true', parentId: 'root' }).then((d) => setCats(d.items)).catch(() => {});
    get('/brands', { all: 'true' }).then((d) => setBrands(d.items)).catch(() => {});
  }, []);
  const remove = async (p) => {
    if (!(await confirm({ title: `Delete ${p.name}?`, message: 'The product and its variants will be deactivated. Products with stock cannot be deleted.', danger: true, confirmText: 'Delete' }))) return;
    try { await del(`/products/${p._id}`); toast.success('Product deleted'); setReloadKey((k) => k + 1); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div>
      <PageHeader icon={Package} title="Products" subtitle="Fashion catalogue with size / colour variants"
        actions={can('product.create') && <button type="button" className="btn-primary" onClick={() => navigate('/products/new')}><Plus className="h-4 w-4" /> New product</button>} />
      <DataTable url="/products" params={{ search: ds, categoryId, brandId, status }} reloadKey={reloadKey}
        onRowClick={can('product.edit') ? (r) => navigate(`/products/${r._id}/edit`) : undefined}
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} placeholder="Name, product code, SKU or barcode" className="w-72" />
          <select className="input w-44" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
          <select className="input w-40" value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">All brands</option>{brands.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</select>
          <select className="input w-32" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </>}
        columns={[
          { key: 'productCode', label: 'Code', render: (r) => <span className="font-mono text-xs font-semibold">{r.productCode}</span> },
          { key: 'name', label: 'Product', render: (r) => <div className="flex items-center gap-2">{r.images?.[0] ? <img src={r.images[0]} alt="" className="h-8 w-8 rounded object-cover" /> : <div className="grid h-8 w-8 place-items-center rounded bg-ink-100 dark:bg-ink-800"><Tags className="h-4 w-4 text-ink-400" /></div>}<div><div className="font-medium">{r.name}</div><div className="text-[11px] text-ink-500">{r.gender} · {r.season}</div></div></div> },
          { key: 'categoryName', label: 'Category' },
          { key: 'brandName', label: 'Brand' },
          { key: 'variantCount', label: 'Variants', num: true },
          { key: 'gstRate', label: 'GST', num: true, render: (r) => `${r.gstRate}%` },
          { key: 'mrp', label: 'MRP', num: true, render: (r) => inr(r.mrp) },
          { key: 'sellingPrice', label: 'Price', num: true, render: (r) => <b>{inr(r.sellingPrice)}</b> },
          { key: 'stock', label: 'Stock', num: true, render: (r) => <b className={r.stock <= 0 ? 'text-rose-600' : ''}>{r.stock}</b> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'a', label: '', render: (r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {can('product.edit') && <button type="button" className="btn-ghost btn-sm" onClick={() => navigate(`/products/${r._id}/edit`)}><Pencil className="h-3.5 w-3.5" /></button>}
              {can('product.delete') && <button type="button" className="btn-ghost btn-sm text-rose-600" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          ) },
        ]} />
    </div>
  );
}
