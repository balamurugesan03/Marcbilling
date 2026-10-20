import { useEffect, useState } from 'react';
import { Warehouse, Download } from 'lucide-react';
import { get } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox } from '../../components/common';
import { Modal, StatusBadge, Loading } from '../../components/ui';
import { inr, variantLabel } from '../../lib/format';
import { exportExcel } from '../../lib/export';

function BranchStock({ row, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { get(`/stock/variant/${row.variantId}`).then(setData); }, [row]);
  return (
    <Modal open onClose={onClose} title={`${row.productName} · ${variantLabel(row)}`} size="sm">
      {!data ? <Loading /> : (
        <table className="tbl"><thead><tr><th>Branch</th><th className="num">Stock</th><th className="num">Avg cost</th></tr></thead>
          <tbody>{data.map((b) => <tr key={b.branchId}><td>{b.branchName}</td><td className="num font-semibold">{b.current}</td><td className="num">{inr(b.avgCost)}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}

export default function CurrentStock() {
  const branchId = useAuth((s) => s.branchId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cats, setCats] = useState([]);
  const [summary, setSummary] = useState(null);
  const [row, setRow] = useState(null);
  const ds = useDebounce(search, 300);
  useEffect(() => { get('/categories', { all: 'true', parentId: 'root' }).then((d) => setCats(d.items)); }, []);
  const doExport = async () => {
    const d = await get('/stock', { search: ds, status, categoryId, limit: 500 });
    const columns = [{ key: 'productName', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' }, { key: 'size', label: 'Size' }, { key: 'color', label: 'Color' }, { key: 'opening', label: 'Opening', type: 'number' }, { key: 'purchased', label: 'Purchased', type: 'number' }, { key: 'transferIn', label: 'Transfer In', type: 'number' }, { key: 'salesReturned', label: 'Sales Return', type: 'number' }, { key: 'sold', label: 'Sold', type: 'number' }, { key: 'purchaseReturned', label: 'Purchase Return', type: 'number' }, { key: 'transferOut', label: 'Transfer Out', type: 'number' }, { key: 'adjustment', label: 'Adjustment', type: 'number' }, { key: 'current', label: 'Current', type: 'number' }, { key: 'value', label: 'Value', type: 'money' }];
    exportExcel({ title: 'Current Stock', columns, rows: d.items });
  };
  return (
    <div>
      <PageHeader icon={Warehouse} title="Current Stock" subtitle={summary ? `${summary.qty.toLocaleString('en-IN')} pcs · value ${inr(summary.value)} ${branchId === 'all' ? '(all branches)' : ''}` : 'Branch-wise, variant-wise stock'}
        actions={<button type="button" className="btn-secondary" onClick={doExport}><Download className="h-4 w-4" /> Excel</button>} />
      <DataTable url="/stock" params={{ search: ds, status, categoryId }} dense onData={(d) => setSummary(d.summary)} rowKey="variantId" onRowClick={setRow}
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} placeholder="Product, SKU, barcode, colour" className="w-72" />
          <select className="input w-40" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
          <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>
        </>}
        columns={[
          { key: 'productName', label: 'Product', render: (r) => <><div className="font-medium">{r.productName}</div><div className="font-mono text-[10px] text-ink-500">{r.sku} · {r.barcode}</div></> },
          { key: 'size', label: 'Size' }, { key: 'color', label: 'Colour' },
          { key: 'opening', label: 'Open', num: true }, { key: 'purchased', label: 'Pur', num: true }, { key: 'transferIn', label: 'Trf In', num: true },
          { key: 'salesReturned', label: 'S.Ret', num: true }, { key: 'sold', label: 'Sold', num: true }, { key: 'purchaseReturned', label: 'P.Ret', num: true },
          { key: 'transferOut', label: 'Trf Out', num: true }, { key: 'adjustment', label: 'Adj', num: true },
          { key: 'current', label: 'Current', num: true, render: (r) => <b className={r.current <= 0 ? 'text-rose-600' : ''}>{r.current}</b> },
          { key: 'value', label: 'Value', num: true, render: (r) => inr(r.value) },
          { key: 'status', label: '', render: (r) => <StatusBadge status={r.status} label={r.status === 'in' ? 'In stock' : r.status === 'low' ? 'Low' : 'Out'} /> },
        ]} />
      <p className="mt-2 text-xs text-ink-500">Current = Opening + Purchase + Transfer In + Sales Return − Sales − Purchase Return − Transfer Out ± Adjustment. Click a row to see stock in every branch.</p>
      {row && <BranchStock row={row} onClose={() => setRow(null)} />}
    </div>
  );
}
