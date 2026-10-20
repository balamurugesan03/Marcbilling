import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Printer } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox } from '../../components/common';
import { StatusBadge } from '../../components/ui';
import { inr, variantLabel } from '../../lib/format';

export default function Variants() {
  const can = useAuth((s) => s.can);
  const branchId = useAuth((s) => s.branchId);
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [picked, setPicked] = useState({});
  const ds = useDebounce(search, 300);
  const dsz = useDebounce(size, 300);
  const dc = useDebounce(color, 300);
  const list = Object.values(picked);
  const toggle = (v) => setPicked((p) => { const n = { ...p }; if (n[v._id]) delete n[v._id]; else n[v._id] = v; return n; });
  return (
    <div>
      <PageHeader icon={Layers} title="Variants" subtitle="Every size / colour SKU with its own barcode and stock"
        actions={can('barcode.print') && list.length > 0 && <button type="button" className="btn-primary" onClick={() => navigate('/products/labels', { state: { variants: list.map((v) => ({ ...v, qty: 1 })) } })}><Printer className="h-4 w-4" /> Print labels ({list.length})</button>} />
      <DataTable url="/products/variants" params={{ search: ds, size: dsz, color: dc }} dense
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} placeholder="Product, SKU or barcode" className="w-72" />
          <input className="input w-28" placeholder="Size" value={size} onChange={(e) => setSize(e.target.value)} />
          <input className="input w-32" placeholder="Colour" value={color} onChange={(e) => setColor(e.target.value)} />
        </>}
        columns={[
          { key: 'sel', label: '', render: (r) => <input type="checkbox" checked={Boolean(picked[r._id])} onChange={() => toggle(r)} /> },
          { key: 'productName', label: 'Product', render: (r) => <><div className="font-medium">{r.productName}</div><div className="text-[11px] text-ink-500">{r.brandName} · {r.categoryName}</div></> },
          { key: 'variant', label: 'Variant', render: (r) => variantLabel(r) || '-' },
          { key: 'sku', label: 'SKU', render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
          { key: 'barcode', label: 'Barcode', render: (r) => <span className="font-mono text-xs">{r.barcode} <span className="badge-gray ml-1">{r.barcodeFormat}</span></span> },
          { key: 'mrp', label: 'MRP', num: true, render: (r) => inr(r.mrp) },
          { key: 'sellingPrice', label: 'Price', num: true, render: (r) => <b>{inr(r.sellingPrice)}</b> },
          { key: 'gstRate', label: 'GST', num: true, render: (r) => `${r.gstRate}%` },
          ...(branchId !== 'all' ? [{ key: 'stock', label: 'Stock', num: true, render: (r) => <b className={r.stock <= 0 ? 'text-rose-600' : ''}>{r.stock}</b> }] : []),
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
    </div>
  );
}
