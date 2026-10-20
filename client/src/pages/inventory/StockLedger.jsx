import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useDebounce } from '../../hooks';
import { PageHeader, DataTable, SearchBox, DateRange } from '../../components/common';
import { fdatetime, variantLabel, titleCase } from '../../lib/format';

const TYPES = ['opening', 'purchase', 'purchase_return', 'sale', 'sale_return', 'sale_cancel', 'transfer_in', 'transfer_out', 'adjustment'];

export default function StockLedger() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const ds = useDebounce(search, 400);
  return (
    <div>
      <PageHeader icon={ScrollText} title="Stock Ledger" subtitle="Every stock movement, with running balance — fully auditable" />
      <DataTable url="/stock/ledger" params={{ search: ds, type, ...range }} dense
        toolbar={<>
          <SearchBox value={search} onChange={setSearch} placeholder="Barcode, SKU or product" className="w-72" />
          <select className="input w-44" value={type} onChange={(e) => setType(e.target.value)}><option value="">All movements</option>{TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select>
          <DateRange {...range} onChange={setRange} />
        </>}
        columns={[
          { key: 'createdAt', label: 'Date', render: (r) => fdatetime(r.createdAt) },
          { key: 'branch', label: 'Branch', render: (r) => r.branchId?.name },
          { key: 'product', label: 'Product', render: (r) => <><div className="font-medium">{r.variantId?.productName}</div><div className="font-mono text-[10px] text-ink-500">{r.variantId?.sku}</div></> },
          { key: 'variant', label: 'Variant', render: (r) => variantLabel(r.variantId) },
          { key: 'type', label: 'Type', render: (r) => <span className={r.qty > 0 ? 'badge-green' : 'badge-red'}>{titleCase(r.type)}</span> },
          { key: 'refNo', label: 'Reference', render: (r) => <span className="font-mono text-xs">{r.refNo}</span> },
          { key: 'qty', label: 'Qty', num: true, render: (r) => <b className={r.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}>{r.qty > 0 ? `+${r.qty}` : r.qty}</b> },
          { key: 'balanceAfter', label: 'Balance', num: true, render: (r) => <b>{r.balanceAfter}</b> },
          { key: 'user', label: 'By', render: (r) => r.userId?.name },
          { key: 'note', label: 'Note', render: (r) => <span className="text-xs text-ink-500">{r.note}</span> },
        ]} />
    </div>
  );
}
