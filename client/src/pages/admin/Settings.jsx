import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Settings as Cog, Save } from 'lucide-react';
import { get, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader } from '../../components/common';
import { Loading, Toggle } from '../../components/ui';
import { LABEL_SIZES } from '../../lib/print';
import { PAYMENT_LABELS } from '../../lib/format';

const T = (key, label, hint) => ({ key, label, hint, type: 'toggle' });
const N = (key, label, hint) => ({ key, label, hint, type: 'number' });
const S = (key, label, options, hint) => ({ key, label, hint, type: 'select', options });
const X = (key, label, hint, area) => ({ key, label, hint, type: area ? 'textarea' : 'text' });

const SECTIONS = [
  { key: 'invoice', label: 'Invoice', fields: [X('title', 'Invoice title'), T('showLogo', 'Show store logo'), T('showHsn', 'Show HSN on A4 invoice'), T('showSavings', 'Show “You saved” on receipt'), X('footerNote', 'Footer note (Thank you message)'), X('terms', 'Terms & conditions', '', true)] },
  { key: 'tax', label: 'Tax (GST)', fields: [
    S('mode', 'GST type', [{ value: 'auto', label: 'Auto — IGST when customer state ≠ branch state' }, { value: 'intra', label: 'Always CGST + SGST (intra-state)' }, { value: 'inter', label: 'Always IGST (inter-state)' }]),
    T('taxInclusive', 'Selling prices include GST (MRP pricing)', 'Recommended for retail. GST is extracted from the selling price.'),
    T('purchaseTaxInclusive', 'Purchase rates include GST'),
  ] },
  { key: 'barcode', label: 'Barcode', fields: [
    S('defaultFormat', 'Default barcode format', [{ value: 'EAN13', label: 'EAN-13 (13 digits with check digit)' }, { value: 'CODE128', label: 'Code128 (alphanumeric)' }]),
    X('ean13Prefix', 'EAN-13 prefix (digits)', 'e.g. 890123 — remaining digits are a running sequence'), X('code128Prefix', 'Code128 prefix'),
    X('accessoryEan13Prefix', 'Accessories: EAN-13 prefix', 'Separate series for categories marked Accessory, e.g. 890124 — must differ from the dress prefix'), X('accessoryCode128Prefix', 'Accessories: Code128 prefix', 'e.g. AC'),
    S('labelSize', 'Default label size', Object.entries(LABEL_SIZES).map(([value, v]) => ({ value, label: v.label }))), N('labelColumns', 'Labels across (roll)'),
    T('showStoreName', 'Label: store name'), T('showProductName', 'Label: product name'), T('showSku', 'Label: SKU'), T('showSizeColor', 'Label: size / colour'), T('showMrp', 'Label: MRP'), T('showSellingPrice', 'Label: selling price'),
  ] },
  { key: 'printer', label: 'Printer', fields: [
    S('receiptWidth', 'Thermal receipt width', [{ value: '80', label: '80 mm' }, { value: '58', label: '58 mm' }]),
    S('defaultInvoiceFormat', 'Default bill format', [{ value: 'thermal', label: 'Thermal receipt' }, { value: 'a4', label: 'A4 invoice' }]),
    T('autoPrintAfterSale', 'Print bill automatically after payment'), X('receiptPrinterName', 'Receipt printer name (for reference)', 'Select this printer in the browser print dialog; enable kiosk printing for silent printing'),
    X('labelPrinterName', 'Label printer name (for reference)'),
  ] },
  { key: 'payment', label: 'Payment', fields: [{ key: 'enabledModes', label: 'Enabled payment modes', type: 'modes' }, S('defaultMode', 'Default mode', ['cash', 'card', 'upi', 'bank'].map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))), X('upiId', 'Store UPI ID')] },
  { key: 'discount', label: 'Discount', fields: [T('allowLineDiscount', 'Allow item discount'), T('allowBillDiscount', 'Allow bill discount'), N('maxBillDiscountPercent', 'Maximum bill discount %', 'Each role also has its own max discount % (Roles)')] },
  { key: 'stock', label: 'Stock', fields: [T('allowNegativeStock', 'Allow negative stock (sell without stock)', 'Not recommended. Keep OFF for accurate inventory.'), N('lowStockThreshold', 'Low stock threshold (qty)'), N('deadStockDays', 'Dead stock after (days without sale)')] },
  { key: 'loyalty', label: 'Loyalty', fields: [T('enabled', 'Enable loyalty points'), N('amountPerPoint', '₹ spent per 1 point'), N('pointValue', '₹ value of 1 point when redeeming'), N('minRedeemPoints', 'Minimum points to redeem')] },
  { key: 'returnPolicy', label: 'Return Policy', fields: [T('enabled', 'Allow returns'), N('days', 'Return window (days)', 'Users with Cancel Sale permission can override'), X('text', 'Policy text (printed on bill)', '', true)] },
  { key: 'exchangePolicy', label: 'Exchange Policy', fields: [T('enabled', 'Allow exchanges'), N('days', 'Exchange window (days)'), X('text', 'Policy text (printed on bill)', '', true)] },
  { key: 'cash', label: 'Cash', fields: [T('requireSessionForBilling', 'Require an open cash session before billing')] },
  { key: 'numberSeries', label: 'Number Series', fields: [{ key: 'series', type: 'series' }] },
];
const SERIES_LABELS = { invoice: 'Sales invoice', saleReturn: 'Sales return', exchange: 'Exchange', purchase: 'Purchase', purchaseReturn: 'Purchase return', transfer: 'Stock transfer', adjustment: 'Stock adjustment', expense: 'Expense', payment: 'Payment', hold: 'Hold bill', cashSession: 'Cash session', customer: 'Customer code', product: 'Product code' };

function preview(p) {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return p.replace('{YYYY}', now.getFullYear()).replace('{YY}', String(now.getFullYear()).slice(2)).replace('{MM}', String(now.getMonth() + 1).padStart(2, '0'))
    .replace('{FY}', `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`).replace('{BRANCH}', 'NGL').replace(/\{SEQ:(\d+)\}/, (m, n) => '1'.padStart(Number(n), '0')).replace('{SEQ}', '1');
}

export default function Settings() {
  const loadSettings = useAuth((s) => s.loadSettings);
  const [all, setAll] = useState(null);
  const [tab, setTab] = useState('invoice');
  const [draft, setDraft] = useState({});
  useEffect(() => { get('/settings').then(setAll).catch((e) => toast.error(errMsg(e))); }, []);
  useEffect(() => { if (all) setDraft(JSON.parse(JSON.stringify(all[tab] || {}))); }, [tab, all]);
  if (!all) return <Loading />;
  const sec = SECTIONS.find((s) => s.key === tab);
  const save = async () => {
    try {
      const body = { ...draft };
      sec.fields.filter((f) => f.type === 'number').forEach((f) => { body[f.key] = Number(body[f.key]); });
      const d = await put(`/settings/${tab}`, body);
      setAll(d);
      loadSettings();
      toast.success(`${sec.label} settings saved`);
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div>
      <PageHeader icon={Cog} title="Settings" subtitle="Company-wide configuration" actions={<button type="button" className="btn-primary" onClick={save}><Save className="h-4 w-4" /> Save {sec.label}</button>} />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="card h-fit p-2">
          {SECTIONS.map((s) => <button key={s.key} type="button" onClick={() => setTab(s.key)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${tab === s.key ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' : 'hover:bg-ink-50 dark:hover:bg-ink-800'}`}>{s.label}</button>)}
        </div>
        <div className="card card-pad space-y-4">
          {sec.fields.map((f) => {
            if (f.type === 'toggle') return <Toggle key={f.key} checked={Boolean(draft[f.key])} onChange={(v) => setDraft({ ...draft, [f.key]: v })} label={f.label} hint={f.hint} />;
            if (f.type === 'select') return <label key={f.key} className="block max-w-lg"><span className="label">{f.label}</span><select className="input" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{f.hint && <span className="mt-1 block text-[11px] text-ink-400">{f.hint}</span>}</label>;
            if (f.type === 'textarea') return <label key={f.key} className="block"><span className="label">{f.label}</span><textarea className="input" rows={3} value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} /></label>;
            if (f.type === 'modes') {
              const modes = draft.enabledModes || [];
              return (
                <div key={f.key}><div className="label">{f.label}</div><div className="flex flex-wrap gap-2">
                  {['cash', 'card', 'upi', 'bank', 'credit', 'store_credit', 'loyalty'].map((m) => (
                    <label key={m} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${modes.includes(m) ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10' : 'border-ink-200 dark:border-ink-700'}`}>
                      <input type="checkbox" checked={modes.includes(m)} onChange={() => setDraft({ ...draft, enabledModes: modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m] })} /> {PAYMENT_LABELS[m]}
                    </label>
                  ))}
                </div></div>
              );
            }
            if (f.type === 'series') {
              return (
                <div key="series">
                  <p className="mb-3 text-sm text-ink-500">Tokens: <code>{'{YYYY}'}</code> <code>{'{YY}'}</code> <code>{'{MM}'}</code> <code>{'{FY}'}</code> <code>{'{BRANCH}'}</code> <code>{'{SEQ:6}'}</code>. With scope “branch”, each branch has its own counter — include {'{BRANCH}'} to keep numbers unique.</p>
                  <table className="tbl"><thead><tr><th>Document</th><th>Pattern</th><th>Scope</th><th>Reset</th><th>Preview</th></tr></thead>
                    <tbody>{Object.keys(SERIES_LABELS).map((k) => {
                      const s = draft[k] || {};
                      const upd = (patch) => setDraft({ ...draft, [k]: { ...s, ...patch } });
                      return (
                        <tr key={k}><td className="font-medium">{SERIES_LABELS[k]}</td>
                          <td><input className="input input-sm w-56 font-mono" value={s.pattern || ''} onChange={(e) => upd({ pattern: e.target.value })} /></td>
                          <td><select className="input input-sm" value={s.scope || 'company'} onChange={(e) => upd({ scope: e.target.value })}><option value="company">Company</option><option value="branch">Branch</option></select></td>
                          <td><select className="input input-sm" value={s.reset || 'yearly'} onChange={(e) => upd({ reset: e.target.value })}><option value="never">Never</option><option value="yearly">Every year</option><option value="financial_year">Every financial year</option></select></td>
                          <td className="font-mono text-xs">{preview(s.pattern || '')}</td></tr>
                      );
                    })}</tbody></table>
                </div>
              );
            }
            return <label key={f.key} className="block max-w-lg"><span className="label">{f.label}</span><input type={f.type === 'number' ? 'number' : 'text'} className="input" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />{f.hint && <span className="mt-1 block text-[11px] text-ink-400">{f.hint}</span>}</label>;
          })}
        </div>
      </div>
    </div>
  );
}
