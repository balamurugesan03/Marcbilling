import dayjs from 'dayjs';

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const inr = (n) => inrFmt.format(Number(n) || 0);
export const inrShort = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return inr0.format(v);
};
export const num = (n) => numFmt.format(Number(n) || 0);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const fdate = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '-');
export const fdatetime = (d) => (d ? dayjs(d).format('DD MMM YYYY, hh:mm A') : '-');
export const ftime = (d) => (d ? dayjs(d).format('hh:mm A') : '-');
export const isoDate = (d = new Date()) => dayjs(d).format('YYYY-MM-DD');
export const monthStart = () => dayjs().startOf('month').format('YYYY-MM-DD');
export const variantLabel = (v) => [v?.color, v?.size].filter(Boolean).join(' / ');
export const titleCase = (s = '') => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const PAYMENT_LABELS = { cash: 'Cash', card: 'Card', upi: 'UPI', bank: 'Bank', credit: 'Credit', store_credit: 'Store Credit', loyalty: 'Loyalty Points', exchange: 'Exchange Credit', adjust_outstanding: 'Adjust Outstanding' };

/** Amount in words (Indian numbering) for invoices. */
export function amountInWords(amount) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? a[n] : `${b[Math.floor(n / 10)]}${n % 10 ? ` ${a[n % 10]}` : ''}`);
  const three = (n) => (n >= 100 ? `${a[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ''}` : two(n));
  let n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return 'Zero Rupees Only';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `${parts.join(' ')} Rupees Only`;
}
