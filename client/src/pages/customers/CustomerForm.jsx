import { useState } from 'react';
import toast from 'react-hot-toast';
import { post, put, errMsg } from '../../lib/api';
import { Modal, Input } from '../../components/ui';
import { isoDate } from '../../lib/format';

export default function CustomerForm({ doc, onClose, onSaved }) {
  const [f, setF] = useState({
    name: doc?.name || '', mobile: doc?.mobile || '', email: doc?.email || '', address: doc?.address || '', city: doc?.city || '', state: doc?.state || '',
    stateCode: doc?.stateCode || '', dob: doc?.dob ? isoDate(doc.dob) : '', anniversary: doc?.anniversary ? isoDate(doc.anniversary) : '', gstNumber: doc?.gstNumber || '', notes: doc?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const c = doc ? await put(`/customers/${doc._id}`, f) : await post('/customers', f);
      toast.success('Customer saved');
      onSaved(c);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={doc ? `Edit ${doc.name}` : 'New Customer'} size="lg">
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Input label="Name" required value={f.name} onChange={set('name')} />
        <Input label="Mobile" required value={f.mobile} onChange={set('mobile')} inputMode="numeric" />
        <Input label="Email" type="email" value={f.email} onChange={set('email')} />
        <Input className="col-span-2" label="Address" value={f.address} onChange={set('address')} />
        <Input label="City" value={f.city} onChange={set('city')} />
        <Input label="State" value={f.state} onChange={set('state')} />
        <Input label="State code" value={f.stateCode} onChange={set('stateCode')} hint="Used for IGST decision" />
        <Input label="GST number" value={f.gstNumber} onChange={(e) => setF({ ...f, gstNumber: e.target.value.toUpperCase() })} />
        <Input label="Date of birth" type="date" value={f.dob} onChange={set('dob')} />
        <Input label="Anniversary" type="date" value={f.anniversary} onChange={set('anniversary')} />
        <Input className="col-span-2 sm:col-span-3" label="Notes" value={f.notes} onChange={set('notes')} />
        <div className="col-span-2 flex justify-end gap-2 sm:col-span-3"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
