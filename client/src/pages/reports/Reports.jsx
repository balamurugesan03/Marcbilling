import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { BarChart3, FileSpreadsheet, FileText, Printer, RefreshCw } from 'lucide-react';
import { get, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useDebounce } from '../../hooks';
import { PageHeader, SearchBox, DateRange, defaultRange } from '../../components/common';
import { Loading, Empty, Pagination, Modal } from '../../components/ui';
import { inr, num, fdate, PAYMENT_LABELS } from '../../lib/format';
import { exportExcel, exportPdf } from '../../lib/export';
import { printHtml } from '../../lib/print';

const fmt = (c, v) => {
  if (v == null || v === '') return '';
  if (c.type === 'money') return inr(v);
  if (c.type === 'number') return num(v);
  if (c.type === 'percent') return `${num(v)}%`;
  if (c.type === 'date') return fdate(v);
  return String(v);
};
/** Sales summary drill-down: everything about one product in the report's period and branch. */
function ProductDetail({ variantId, params, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!variantId) return;
    setD(null);
    get(`/reports/product-detail/${variantId}`, { from: params.from, to: params.to, branchId: params.branchId }).then(setD).catch((e) => { toast.error(errMsg(e)); onClose(); });
  }, [variantId]);
  const v = d?.variant;
  const Stat = ({ label, value, tone }) => (
    <div className="rounded-lg border border-ink-200 px-3 py-2 dark:border-ink-700">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={clsx('text-lg font-bold tabular-nums', tone)}>{value}</div>
    </div>
  );
  return (
    <Modal open={Boolean(variantId)} onClose={onClose} size="full" title={v ? `${v.productName}${v.size ? ` · ${v.size}` : ''}${v.color ? ` · ${v.color}` : ''}` : 'Product details'}>
      {!d ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="text-ink-500">SKU:</span> <b className="font-mono">{v.sku}</b></div>
            <div><span className="text-ink-500">Barcode:</span> <b className="font-mono">{v.barcode}</b></div>
            <div><span className="text-ink-500">Product code:</span> {v.productCode || '-'}</div>
            <div><span className="text-ink-500">Category / Brand:</span> {[v.categoryName, v.brandName].filter(Boolean).join(' / ') || '-'}</div>
            <div><span className="text-ink-500">MRP:</span> {inr(v.mrp)}</div>
            <div><span className="text-ink-500">Selling price:</span> {inr(v.sellingPrice)}</div>
            <div><span className="text-ink-500">Purchase price:</span> {inr(v.purchasePrice)}</div>
            <div><span className="text-ink-500">GST:</span> {v.gstRate}%{v.hsnCode ? ` · HSN ${v.hsnCode}` : ''}{v.status !== 'active' ? ' · INACTIVE' : ''}</div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Stock left" value={num(d.totalStock)} tone={d.totalStock <= 0 ? 'text-rose-600' : 'text-emerald-600'} />
            <Stat label="Bills" value={num(d.summary.bills)} />
            <Stat label="Qty sold" value={num(d.summary.qty)} />
            <Stat label="Returned" value={num(d.summary.returned)} />
            <Stat label="Net qty" value={num(d.summary.netQty)} />
            <Stat label="Sales" value={inr(d.summary.sales)} />
            <Stat label="Discount" value={inr(d.summary.discount)} />
            <Stat label="Profit" value={inr(d.summary.profit)} tone={d.summary.profit < 0 ? 'text-rose-600' : ''} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="section-title mb-1">Payment mode</div>
              {!d.summary.byMode.length ? <div className="text-sm text-ink-500">No sales in this period</div> : (
                <div className="flex flex-wrap gap-2">{d.summary.byMode.map((m) => <span key={m.mode} className="badge-brand text-sm">{m.mode}: {inr(m.amount)}</span>)}</div>
              )}
            </div>
            <div>
              <div className="section-title mb-1">Stock by branch</div>
              <div className="flex flex-wrap gap-2">{d.stock.length ? d.stock.map((s) => <span key={s.branch} className={clsx('text-sm', s.current > 0 ? 'badge-green' : 'badge-red')}>{s.branch}: {s.current}</span>) : <span className="text-sm text-ink-500">No stock record</span>}</div>
            </div>
          </div>

          <div>
            <div className="section-title mb-1">Sales ({d.sales.length})</div>
            <div className="table-wrap max-h-80">
              {!d.sales.length ? <Empty title="Not sold in this period" /> : (
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Bill No</th><th>Branch</th><th>Customer</th><th>Cashier</th><th className="num">Qty</th><th className="num">Returned</th><th className="num">Rate</th><th className="num">Discount</th><th className="num">Amount</th><th className="num">Profit</th><th>Bill paid by</th></tr></thead>
                  <tbody>
                    {d.sales.map((s, i) => (
                      <tr key={i} className={clsx(s.qty < 0 && 'text-rose-600')}>
                        <td className="whitespace-nowrap">{fdate(s.date)}</td>
                        <td className="font-mono text-xs">{s.invoiceNumber}{s.returnOf && <div className="text-[10px]">return of {s.returnOf}</div>}</td>
                        <td>{s.branch}</td>
                        <td>{s.customer}{s.mobile && <div className="text-[11px] text-ink-500">{s.mobile}</div>}</td>
                        <td>{s.cashier}</td>
                        <td className="num">{s.qty}</td>
                        <td className="num">{s.returned || '-'}</td>
                        <td className="num">{inr(s.rate)}</td>
                        <td className="num">{s.discount ? inr(s.discount) : '-'}</td>
                        <td className="num font-semibold">{inr(s.amount)}</td>
                        <td className={clsx('num', s.profit < 0 && 'text-rose-600')}>{inr(s.profit)}</td>
                        <td className="whitespace-nowrap text-xs">{s.payment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div>
            <div className="section-title mb-1">Purchases (latest {d.purchases.length})</div>
            <div className="table-wrap max-h-60">
              {!d.purchases.length ? <Empty title="No purchases recorded" /> : (
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Purchase No</th><th>Supplier bill</th><th>Supplier</th><th>Branch</th><th className="num">Qty</th><th className="num">Returned</th><th className="num">Rate</th><th className="num">MRP</th></tr></thead>
                  <tbody>
                    {d.purchases.map((p, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap">{fdate(p.date)}</td><td className="font-mono text-xs">{p.purchaseNo}</td><td>{p.billNo}</td><td>{p.supplier}</td><td>{p.branch}</td>
                        <td className="num">{p.qty}</td><td className="num">{p.returned || '-'}</td><td className="num">{inr(p.rate)}</td><td className="num">{inr(p.mrp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// 'YYYY-MM' -> first and last day of that month
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};
const NO_DATE = ['stock_current', 'stock_low', 'stock_out', 'stock_valuation', 'stock_dead', 'customer_outstanding', 'customer_loyalty'];

export default function Reports() {
  const { group } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { branches, branchId, user, company } = useAuth();
  const [catalogue, setCatalogue] = useState([]);
  const [range, setRange] = useState(defaultRange());
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [extra, setExtra] = useState({});
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null); // sales summary: product clicked for its full details
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const ds = useDebounce(search, 400);
  const reports = useMemo(() => catalogue.filter((r) => r.group === group), [catalogue, group]);
  const key = sp.get('r') || reports[0]?.key;

  useEffect(() => { get('/reports').then(setCatalogue).catch((e) => toast.error(errMsg(e))); }, []);
  useEffect(() => { setPage(1); setExtra({}); }, [key]);
  const params = { ...range, search: ds, branchId: branch || undefined, ...extra };
  const load = async () => {
    if (!key) return;
    setLoading(true);
    try { setData(await get(`/reports/${key}`, { ...params, page, limit: 50 })); } catch (e) { toast.error(errMsg(e)); setData(null); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [key, JSON.stringify(params), page, branchId]);

  const fetchAll = () => get(`/reports/${key}`, { ...params, all: 'true' });
  const subtitle = () => {
    const b = branch ? branches.find((x) => x._id === branch)?.name : branchId === 'all' ? 'All branches' : branches.find((x) => x._id === branchId)?.name;
    return `${key === 'sales_statement' && company?.name ? `${company.name} · ` : ''}${b} · ${NO_DATE.includes(key) ? 'As on today' : `${fdate(range.from)} to ${fdate(range.to)}`}`;
  };
  const doExport = async (kind) => {
    try {
      const all = await fetchAll();
      const args = { title: all.title, subtitle: subtitle(), columns: all.columns, rows: all.rows, totals: all.totals };
      if (kind === 'xlsx') await exportExcel(args);
      else if (kind === 'pdf') await exportPdf(args);
      else {
        const head = all.columns.map((c) => `<th style="text-align:${['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left'}">${c.label}</th>`).join('');
        const body = all.rows.map((r) => `<tr style="${r.bold ? 'font-weight:700' : ''}">${all.columns.map((c) => `<td style="text-align:${['money', 'number', 'percent'].includes(c.type) ? 'right' : 'left'}">${r.isPercent && c.type === 'money' ? `${r[c.key]}%` : fmt(c, r[c.key])}</td>`).join('')}</tr>`).join('');
        const foot = Object.keys(all.totals || {}).length ? `<tr style="font-weight:700;background:#f3f3f3">${all.columns.map((c, i) => `<td style="text-align:right">${i === 0 ? 'TOTAL' : all.totals[c.key] != null ? fmt(c, all.totals[c.key]) : ''}</td>`).join('')}</tr>` : '';
        printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${all.title}</title><style>@page{size:A4 landscape;margin:10mm}body{font:11px Arial}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 5px}th{background:#f3f3f3}</style></head><body><h2 style="margin:0">${all.title}</h2><div style="color:#555;margin-bottom:8px">${subtitle()}</div><table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table></body></html>`);
      }
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <PageHeader icon={BarChart3} title={`${group === 'Inventory' ? 'Stock' : group} Reports`} subtitle={data ? `${data.title} · ${subtitle()}` : ''}
        actions={data && <>
          <button type="button" className="btn-secondary" onClick={() => doExport('xlsx')}><FileSpreadsheet className="h-4 w-4" /> Excel</button>
          <button type="button" className="btn-secondary" onClick={() => doExport('pdf')}><FileText className="h-4 w-4" /> PDF</button>
          <button type="button" className="btn-secondary" onClick={() => doExport('print')}><Printer className="h-4 w-4" /> Print</button>
        </>} />
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <div className="card h-fit p-2">
          {reports.map((r) => (
            <button key={r.key} type="button" onClick={() => navigate(`/reports/${group}?r=${r.key}`)} className={clsx('block w-full rounded-lg px-3 py-2 text-left text-sm', r.key === key ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'hover:bg-ink-50 dark:hover:bg-ink-800')}>{r.title}</button>
          ))}
          {!reports.length && <div className="p-3 text-xs text-ink-500">No reports available for your role.</div>}
        </div>
        <div className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3 dark:border-ink-800">
            {key === 'sales_statement' && <input type="month" className="input w-40" title="Pick a month" value={range.from?.slice(0, 7) || ''} onChange={(e) => e.target.value && setRange(monthRange(e.target.value))} />}
            {!NO_DATE.includes(key) && <DateRange {...range} onChange={setRange} />}
            <SearchBox value={search} onChange={setSearch} className="w-56" placeholder="Search / filter" />
            {user?.role?.allBranches && branchId === 'all' && (
              <select className="input w-40" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">All branches</option>{branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</select>
            )}
            {key === 'cash_book' && <select className="input w-32" value={extra.mode || 'cash'} onChange={(e) => setExtra({ ...extra, mode: e.target.value })}>{['cash', 'bank', 'upi', 'card'].map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]} book</option>)}</select>}
            {key === 'sales_datewise' && <select className="input w-36" value={extra.status || ''} onChange={(e) => setExtra({ ...extra, status: e.target.value || undefined })}><option value="">All status</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>}
            {key === 'gst_billing' && (
              <select className="input w-40" value={extra.mode || ''} onChange={(e) => setExtra({ ...extra, mode: e.target.value || undefined })}>
                <option value="">GPay + Card bills</option><option value="upi">GPay / UPI only</option><option value="card">Card only</option>
              </select>
            )}
            {key === 'gst_taxwise' && <>
              <select className="input w-36" value={extra.view || ''} onChange={(e) => setExtra({ ...extra, view: e.target.value || undefined })}>
                <option value="">Rate summary</option><option value="bills">Bill-wise per rate</option>
              </select>
              <select className="input w-40" value={extra.mode || ''} onChange={(e) => setExtra({ ...extra, mode: e.target.value || undefined })}>
                <option value="">All bills</option><option value="digital">GPay + Card bills</option><option value="upi">GPay / UPI bills</option><option value="card">Card bills</option><option value="cash">Cash bills</option>
              </select>
            </>}
            {key === 'sales_summary_product' && (
              <select className="input w-40" value={extra.mode || ''} onChange={(e) => setExtra({ ...extra, mode: e.target.value || undefined })}>
                <option value="">All payment modes</option><option value="cash">Cash bills</option><option value="upi">GPay / UPI bills</option><option value="card">Card bills</option><option value="digital">GPay + Card bills</option><option value="credit">Credit bills</option>
              </select>
            )}
            {key === 'stock_dead' && <label className="flex items-center gap-1 text-xs">Idle days <input type="number" className="input input-sm w-20" value={extra.days || ''} placeholder="90" onChange={(e) => setExtra({ ...extra, days: e.target.value || undefined })} /></label>}
            {key === 'stock_low' && <label className="flex items-center gap-1 text-xs">Threshold <input type="number" className="input input-sm w-20" value={extra.threshold || ''} placeholder="5" onChange={(e) => setExtra({ ...extra, threshold: e.target.value || undefined })} /></label>}
            <div className="flex-1" />
            <button type="button" className="btn-ghost btn-sm" onClick={load}><RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} /></button>
          </div>
          <div className="table-wrap max-h-[calc(100vh-280px)]">
            {loading && !data ? <Loading /> : !data?.rows?.length ? <Empty title="No data for the selected filters" /> : (
              <table className="tbl">
                <thead><tr>{data.columns.map((c) => <th key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                <tbody className={loading ? 'opacity-50' : ''}>
                  {data.rows.map((r, i) => (
                    <tr key={i} onClick={r.variantId ? () => setDetail(r.variantId) : undefined} title={r.variantId ? "Click for full details" : undefined} className={clsx(r.bold && "bg-ink-50 font-bold dark:bg-ink-800/60", r.memo && "text-ink-500", r.variantId && "cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-500/10")}>
                      {data.columns.map((c) => <td key={c.key} className={clsx(['money', 'number', 'percent'].includes(c.type) && 'num', c.type === 'money' && Number(r[c.key]) < 0 && 'text-rose-600')}>{r.isPercent && c.type === 'money' ? `${r[c.key]}%` : fmt(c, r[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
                {Object.keys(data.totals || {}).length > 0 && (
                  <tfoot><tr className="bg-ink-50 font-bold dark:bg-ink-800">{data.columns.map((c, i) => <td key={c.key} className={clsx('border-t border-ink-200 px-3 py-2.5 dark:border-ink-700', i ? 'text-right tabular-nums' : '')}>{i === 0 ? 'TOTAL' : data.totals[c.key] != null ? fmt(c, data.totals[c.key]) : ''}</td>)}</tr></tfoot>
                )}
              </table>
            )}
          </div>
          {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
          {data?.rows?.some((r) => r.variantId) && <div className="px-1 pt-1 text-xs text-ink-500">Click a product for its full details: every bill, payment mode, stock left, purchases.</div>}
          <ProductDetail variantId={detail} params={params} onClose={() => setDetail(null)} />
        </div>
      </div>
    </div>
  );
}
