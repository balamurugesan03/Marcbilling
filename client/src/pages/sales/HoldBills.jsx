import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { PauseCircle, Trash2, Undo2 } from 'lucide-react';
import { get, del, errMsg } from '../../lib/api';
import { useFetch, useAppEvent } from '../../hooks';
import { usePOS } from '../../store/pos';
import { confirm } from '../../store/ui';
import { PageHeader } from '../../components/common';
import { Loading, Empty } from '../../components/ui';
import { inr, fdatetime } from '../../lib/format';

export default function HoldBills() {
  const { data, loading, reload } = useFetch('/sales/hold');
  const pos = usePOS();
  const navigate = useNavigate();
  useAppEvent('hold', reload);

  const recall = async (h) => {
    if (pos.items.length && !(await confirm({ title: 'Replace current POS bill?', message: 'The bill currently open in POS will be replaced.', confirmText: 'Replace' }))) return;
    try {
      const full = await get(`/sales/hold/${h._id}`);
      const cust = full.customerId ? (await get(`/customers/${full.customerId}`)).customer : null;
      pos.load({ items: full.items, customer: cust, billDiscount: full.billDiscount, heldBillId: full._id });
      navigate('/pos');
    } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async (h) => {
    if (!(await confirm({ title: 'Delete held bill?', message: `${h.holdNo} · ${inr(h.amount)}`, danger: true, confirmText: 'Delete' }))) return;
    try { await del(`/sales/hold/${h._id}`); toast.success('Deleted'); reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <PageHeader icon={PauseCircle} title="Hold Bills" subtitle="Bills parked at the counter. Recall to continue billing." />
      <div className="card overflow-hidden">
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No held bills" hint="Press F5 in POS to hold a bill." /> : (
          <table className="tbl">
            <thead><tr><th>Bill No</th><th>Customer</th><th className="num">Items</th><th className="num">Amount</th><th>Cashier</th><th>Time</th><th>Note</th><th /></tr></thead>
            <tbody>
              {data.map((h) => (
                <tr key={h._id}>
                  <td className="font-mono text-xs font-semibold">{h.holdNo}</td>
                  <td>{h.customerName || 'Walk-in'}<div className="text-xs text-ink-500">{h.customerMobile}</div></td>
                  <td className="num">{h.itemCount}</td>
                  <td className="num font-semibold">{inr(h.amount)}</td>
                  <td>{h.cashierName}</td>
                  <td>{fdatetime(h.createdAt)}</td>
                  <td className="text-xs text-ink-500">{h.note || '-'}</td>
                  <td className="text-right">
                    <button type="button" className="btn-primary btn-sm" onClick={() => recall(h)}><Undo2 className="h-3.5 w-3.5" /> Recall</button>
                    <button type="button" className="btn-ghost btn-sm ml-1 text-rose-600" onClick={() => remove(h)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
