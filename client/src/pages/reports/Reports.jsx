import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { BarChart3, FileSpreadsheet, FileText, Printer, RefreshCw } from 'lucide-react';
import { get, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useDebounce } from '../../hooks';
import { PageHeader, SearchBox, DateRange, defaultRange } from '../../components/common';
import { Loading, Empty, Pagination } from '../../components/ui';
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
                    <tr key={i} className={clsx(r.bold && 'bg-ink-50 font-bold dark:bg-ink-800/60', r.memo && 'text-ink-500')}>
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
        </div>
      </div>
    </div>
  );
}
