import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { IndianRupee, Receipt, ShoppingBag, TrendingUp, Truck, Boxes, AlertTriangle, Clock, LayoutDashboard, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { useFetch, useAppEvent } from '../hooks';
import { useAuth } from '../store/auth';
import { useUI } from '../store/ui';
import { PageHeader, StatCard } from '../components/common';
import { Loading, StatusBadge } from '../components/ui';
import { inr, inrShort, fdatetime } from '../lib/format';

const COLORS = ['#db2777', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#14b8a6'];

function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`card card-pad ${className}`}>
      <div className="section-title mb-3">{title}</div>
      <div className="h-64">{children}</div>
    </div>
  );
}

export default function Dashboard() {
  const { data, loading, reload } = useFetch('/dashboard');
  const branchId = useAuth((s) => s.branchId);
  const currentBranch = useAuth((s) => s.currentBranch());
  const theme = useUI((s) => s.theme);
  const navigate = useNavigate();
  useAppEvent('sale', reload);
  useAppEvent('company-sale', () => branchId === 'all' && reload());
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const c = data.cards;
  const grid = theme === 'dark' ? '#1e293b' : '#e2e8f0';
  const axis = { fontSize: 11, fill: theme === 'dark' ? '#94a3b8' : '#64748b' };
  const tip = { contentStyle: { background: theme === 'dark' ? '#0f172a' : '#fff', border: `1px solid ${grid}`, borderRadius: 10, fontSize: 12 }, formatter: (v) => inr(v) };
  return (
    <div>
      <PageHeader icon={LayoutDashboard} title="Dashboard" subtitle={branchId === 'all' ? 'All branches · consolidated' : `${currentBranch?.name || ''} branch`}
        actions={<button type="button" className="btn-secondary" onClick={reload}><RefreshCw className="h-4 w-4" /> Refresh</button>} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's Sales" value={inr(c.todaySales)} icon={IndianRupee} tone="brand" hint={c.todayReturns ? `Gross ${inr(c.grossSales)} · Returns ${inr(c.todayReturns)}` : 'Net of returns'} onClick={() => navigate('/sales')} />
        <StatCard label="Today's Bills" value={c.todayBills} icon={Receipt} tone="violet" />
        <StatCard label="Items Sold Today" value={c.todayItems} icon={ShoppingBag} tone="blue" />
        <StatCard label="Today's Profit" value={inr(c.todayProfit)} icon={TrendingUp} tone="green" hint="Taxable value − cost" />
        <StatCard label="Today's Purchase" value={inr(c.todayPurchase)} icon={Truck} tone="amber" onClick={() => navigate('/purchase')} />
        <StatCard label="Stock Value (cost)" value={inrShort(c.stockValue)} icon={Boxes} tone="blue" hint={`${c.stockQty.toLocaleString('en-IN')} pcs · MRP ${inrShort(c.stockMrpValue)}`} onClick={() => navigate('/inventory')} />
        <StatCard label="Low / Out of Stock" value={`${c.lowStock} / ${c.outOfStock}`} icon={AlertTriangle} tone="red" onClick={() => navigate('/reports/Inventory?r=stock_low')} />
        <StatCard label="Pending Payments" value={inrShort(c.pendingPayments)} icon={Clock} tone="amber" hint={`Receivable ${inrShort(c.receivables)} · Payable ${inrShort(c.payables)}`} onClick={() => navigate('/reports/Customers?r=customer_outstanding')} />
      </div>
      {c.pendingTransfers > 0 && (
        <button type="button" onClick={() => navigate('/inventory/transfers')} className="mt-4 flex w-full items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <ArrowLeftRight className="h-4 w-4" /> {c.pendingTransfers} stock transfer(s) in transit {branchId !== 'all' ? 'to this branch — click to receive' : ''}
        </button>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard title="Daily Sales (last 30 days)" className="xl:col-span-2">
          <ResponsiveContainer>
            <AreaChart data={data.charts.daily} margin={{ left: 4, right: 8, top: 4 }}>
              <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#db2777" stopOpacity={0.35} /><stop offset="100%" stopColor="#db2777" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={(d) => d.slice(5)} interval={4} />
              <YAxis tick={axis} tickFormatter={inrShort} width={64} />
              <Tooltip {...tip} />
              <Area type="monotone" dataKey="amount" name="Sales" stroke="#db2777" strokeWidth={2} fill="url(#g1)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Payment Modes (30 days)">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.charts.payment} dataKey="amount" nameKey="mode" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {data.charts.payment.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Monthly Sales">
          <ResponsiveContainer>
            <BarChart data={data.charts.monthly}><CartesianGrid stroke={grid} vertical={false} /><XAxis dataKey="month" tick={axis} /><YAxis tick={axis} tickFormatter={inrShort} width={64} /><Tooltip {...tip} /><Bar dataKey="amount" name="Sales" fill="#7c3aed" radius={[6, 6, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Branch Sales (30 days)">
          <ResponsiveContainer>
            <BarChart data={data.charts.branch} layout="vertical" margin={{ left: 10 }}><CartesianGrid stroke={grid} horizontal={false} /><XAxis type="number" tick={axis} tickFormatter={inrShort} /><YAxis type="category" dataKey="branch" tick={axis} width={80} /><Tooltip {...tip} /><Bar dataKey="amount" name="Sales" fill="#0ea5e9" radius={[0, 6, 6, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Category Sales (30 days)">
          <ResponsiveContainer>
            <PieChart><Pie data={data.charts.category} dataKey="amount" nameKey="category" outerRadius={85}>{data.charts.category.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top Products (qty, 30 days)" className="xl:col-span-2">
          <ResponsiveContainer>
            <BarChart data={data.charts.topProducts} layout="vertical" margin={{ left: 10 }}><CartesianGrid stroke={grid} horizontal={false} /><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="name" tick={axis} width={180} /><Tooltip contentStyle={tip.contentStyle} /><Bar dataKey="qty" name="Qty sold" fill="#10b981" radius={[0, 6, 6, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <div className="card overflow-hidden">
          <div className="section-title p-4 pb-2">Recent Bills</div>
          <table className="tbl">
            <tbody>
              {data.recentSales.map((s) => (
                <tr key={s._id} className="cursor-pointer" onClick={() => navigate(`/sales?search=${s.invoiceNumber}`)}>
                  <td><div className="font-mono text-xs font-semibold">{s.invoiceNumber}</div><div className="text-[11px] text-ink-500">{fdatetime(s.createdAt)} · {s.branchId?.name}</div></td>
                  <td className="num"><div className="font-semibold">{inr(s.totals.grandTotal)}</div>{s.status !== 'completed' && <StatusBadge status={s.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
