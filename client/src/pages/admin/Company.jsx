import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, Save, Upload } from 'lucide-react';
import api, { get, put, errMsg } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PageHeader } from '../../components/common';
import { Input, Loading } from '../../components/ui';

export default function Company() {
  const [f, setF] = useState(null);
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => { get('/companies/current').then((c) => setF({ ...c, address: c.address || {} })).catch((e) => toast.error(errMsg(e))); }, []);
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setA = (k) => (e) => setF({ ...f, address: { ...f.address, [k]: e.target.value } });
  const save = async () => {
    try {
      const { name, legalName, gstin, pan, email, phone, website, address, logoUrl } = f;
      await put('/companies/current', { name, legalName, gstin, pan, email, phone, website, address, logoUrl });
      toast.success('Company details saved');
      bootstrap();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const upload = async (file) => {
    const fd = new FormData();
    fd.append('logo', file);
    try { const r = await api.post('/companies/current/logo', fd); setF({ ...f, logoUrl: r.data.data.logoUrl }); toast.success('Logo uploaded'); bootstrap(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div>
      <PageHeader icon={Building2} title="Company" subtitle="Legal details printed on invoices" actions={<button type="button" className="btn-primary" onClick={save}><Save className="h-4 w-4" /> Save</button>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="card card-pad grid grid-cols-2 gap-3 md:grid-cols-3">
          <Input label="Company name" value={f.name} onChange={set('name')} required />
          <Input label="Legal name" value={f.legalName || ''} onChange={set('legalName')} />
          <Input label="Company code" value={f.code} disabled />
          <Input label="GSTIN" value={f.gstin || ''} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
          <Input label="PAN" value={f.pan || ''} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} />
          <Input label="Phone" value={f.phone || ''} onChange={set('phone')} />
          <Input label="Email" value={f.email || ''} onChange={set('email')} />
          <Input label="Website" value={f.website || ''} onChange={set('website')} />
          <div />
          <Input className="col-span-2" label="Address line 1" value={f.address.line1 || ''} onChange={setA('line1')} />
          <Input label="Address line 2" value={f.address.line2 || ''} onChange={setA('line2')} />
          <Input label="City" value={f.address.city || ''} onChange={setA('city')} />
          <Input label="State" value={f.address.state || ''} onChange={setA('state')} />
          <Input label="Pincode" value={f.address.pincode || ''} onChange={setA('pincode')} />
        </div>
        <div className="card card-pad text-center">
          <div className="section-title mb-3 text-left">Store logo</div>
          <div className="mx-auto grid h-32 w-full place-items-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-800">
            {f.logoUrl ? <img src={f.logoUrl} alt="logo" className="max-h-28 max-w-full object-contain" /> : <span className="text-xs text-ink-400">No logo</span>}
          </div>
          <label className="btn-secondary mt-3 w-full cursor-pointer"><Upload className="h-4 w-4" /> Upload logo<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>
          <p className="mt-2 text-xs text-ink-500">Shown on thermal receipts and A4 invoices when enabled in Invoice Settings.</p>
        </div>
      </div>
    </div>
  );
}
