import JsBarcode from 'jsbarcode';
import { amountInWords, fdatetime, PAYMENT_LABELS } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const absUrl = (u) => (u && u.startsWith('/') ? `${window.location.origin}${u}` : u);
const PRINT_LOGO = '/loginimage.jpeg';
const STORE_ADDRESS = 'Vellayani Jn, Trivandrum';
const STORE_PHONE = '7907858891';
const STORE_TAGLINE = 'the family fashion';

/** Prints an HTML document through a hidden iframe (the OS print dialog selects the printer). */
export function printHtml(html, { title = 'Print' } = {}) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    iframe.setAttribute('title', title);
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    const go = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => { iframe.remove(); resolve(); }, 1000);
    };
    const imgs = [...doc.images];
    if (!imgs.length) setTimeout(go, 150);
    else Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))).then(() => setTimeout(go, 100));
  });
}

/**
 * fit: drop the fixed pixel size and stretch the bars to fill the box the SVG is placed in
 * (used for labels, where the space is fixed in mm). Use with displayValue false.
 */
export function barcodeSvg(value, { format = 'CODE128', height = 40, width = 1.6, fontSize = 12, displayValue = true, margin = 0, fit = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, value, { format: format === 'EAN13' ? 'EAN13' : 'CODE128', height, width, fontSize, displayValue, margin, textMargin: 1, font: 'monospace' });
  } catch {
    JsBarcode(svg, value, { format: 'CODE128', height, width, fontSize, displayValue, margin });
  }
  if (fit) {
    const w = parseFloat(svg.getAttribute('width')) || 100;
    const h = parseFloat(svg.getAttribute('height')) || height;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.removeAttribute('style');
  }
  return svg.outerHTML;
}

/* ---------------- Thermal receipt (58 / 80 mm) ---------------- */
// bill heading follows how the customer paid: CASH BILL, GPAY BILL, CASH + GPAY BILL…
const BILL_MODE_NAMES = { cash: 'CASH', upi: 'GPAY', card: 'CARD', bank: 'BANK', credit: 'CREDIT', store_credit: 'STORE CREDIT', loyalty: 'LOYALTY', exchange: 'EXCHANGE', adjust_outstanding: 'ADJUSTED' };
export function billModeTitle(payments = []) {
  const byMode = {};
  payments.filter((p) => Number(p.amount)).forEach((p) => { byMode[p.mode] = (byMode[p.mode] || 0) + Math.abs(Number(p.amount)); }); // refunds (minus) count too
  const modes = Object.keys(byMode).sort((a, b) => byMode[b] - byMode[a]);
  return `${modes.length ? modes.map((x) => BILL_MODE_NAMES[x] || String(x).toUpperCase()).join(' + ') : 'CASH'} BILL`;
}
const ddmmyyyy = (d) => {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
};

export function receiptHtml(inv, { width = '80', duplicate = false } = {}) {
  const { sale, items, branch, company, settings, savings } = inv;
  const w = width === '58' ? 58 : 80;
  const font = w === 58 ? 10.5 : 12;
  const t = sale.totals;
  const gstin = branch?.gstin || company?.gstin;
  const mrpTotal = items.reduce((a, i) => a + (Number(i.mrp) || Number(i.rate) || 0) * i.qty, 0);
  const returned = items.filter((i) => i.qty < 0).reduce((a, i) => a + (Number(i.amount) || 0), 0); // minus value
  const received = sale.payments.reduce((a, p) => a + (Number(p.amount) || 0), 0) + (Number(sale.changeReturned) || 0);
  // GST split by rate: 0 / 5 / 12 % always listed, any other rate on the bill is added
  const rates = [...new Set([0, 5, 12, ...items.map((i) => Number(i.gstRate) || 0)])].sort((a, b) => a - b);
  const gst = rates.map((r) => {
    const rows = items.filter((i) => (Number(i.gstRate) || 0) === r);
    const sum = (k) => rows.reduce((a, i) => a + (Number(i[k]) || 0), 0);
    return { r, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst') };
  });
  const policy = [
    settings?.returnPolicy?.enabled ? settings.returnPolicy.text : 'No Refund',
    settings?.exchangePolicy?.enabled && settings.exchangePolicy.text,
  ].filter(Boolean);
  const row = (k, v, cls = '') => `<tr class="${cls}"><td>${k}</td><td class="r">${v}</td></tr>`;
  // thermal printers fade thin strokes: heavy font, bold everywhere, pure black, solid rules
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoiceNumber)}</title><style>
    @page { size: ${w}mm auto; margin: 0; }
    * { box-sizing: border-box; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { width: ${w}mm; margin: 0; padding: 3mm ${w === 58 ? 2 : 3}mm; font: 700 ${font}px/1.3 Arial, Helvetica, sans-serif; }
    b, strong, th, td, div, span { font-weight: 700; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: 900; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 1px 2px; vertical-align: top; }
    .head { display: flex; align-items: center; gap: 2mm; }
    .head img { width: ${w === 58 ? 15 : 19}mm; height: ${w === 58 ? 15 : 19}mm; object-fit: contain; flex-shrink: 0; filter: grayscale(1) contrast(1.4); }
    .head .info { flex: 1; text-align: center; line-height: 1.25; }
    .store { font-size: ${font + 7}px; font-weight: 900; letter-spacing: 1px; }
    .tag { font-size: ${font - 1}px; font-style: italic; }
    .title { margin: 3px 0 2px; font-size: ${font + 3}px; font-weight: 900; letter-spacing: 1px; text-align: center; }
    .dup { border: 1.5px solid #000; padding: 0 4px; display: inline-block; font-size: ${font - 1}px; }
    .box { border: 1.5px solid #000; }
    .items th { border-bottom: 1.5px solid #000; font-size: ${font - 0.5}px; text-align: right; white-space: nowrap; }
    .items th:first-child, .items td:first-child { text-align: left; }
    .items td { text-align: right; white-space: nowrap; }
    .items td:first-child { white-space: normal; word-break: break-word; }
    .items tbody tr + tr td { border-top: 1px dotted #000; }
    .sum { margin-top: 2px; } .sum td { padding: 0 2px; }
    .total td { font-size: ${font + 4}px; font-weight: 900; border-top: 1.5px solid #000; padding-top: 2px; }
    .gst { margin-top: 3px; } .gst td { padding: 0 3px; font-size: ${font - 0.5}px; }
    .gst .h td { border-bottom: 1.5px solid #000; text-align: center; font-weight: 900; }
    .foot { margin-top: 3px; } .foot td { padding: 0 2px; }
    .thanks { margin-top: 4px; text-align: center; font-size: ${font + 1}px; font-weight: 900; }
  </style></head><body>
    <div class="head">
      <img src="${esc(absUrl(PRINT_LOGO))}" alt="" onerror="this.style.display='none'">
      <div class="info">
        <div class="store">${esc(company?.name || 'MARC')}</div>
        <div class="tag">${esc(STORE_TAGLINE)}</div>
        <div>${esc(STORE_ADDRESS.toUpperCase())}</div>
        <div>Phone: ${esc(STORE_PHONE)}</div>
        ${gstin ? `<div>GSTIN: ${esc(gstin)}</div>` : ''}
      </div>
    </div>
    <div class="title">${esc(billModeTitle(sale.payments))}</div>
    ${duplicate ? '<div class="c"><span class="dup">DUPLICATE COPY</span></div>' : ''}
    <table>
      <tr><td>SlNo: <b>${esc(sale.invoiceNumber)}</b></td><td class="r">Date: ${esc(ddmmyyyy(sale.createdAt))}</td></tr>
      <tr><td colspan="2">To: ${esc((sale.customer?.name || 'Walk-in Customer').toUpperCase())}${sale.customer?.mobile ? ` (${esc(sale.customer.mobile)})` : ''}</td></tr>
      ${sale.customer?.gstNumber ? `<tr><td colspan="2">GSTIN: ${esc(sale.customer.gstNumber)}</td></tr>` : ''}
    </table>
    <table class="box items" style="margin-top:3px">
      <thead><tr><th>Code Product</th><th>MRP</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${items.map((i) => `<tr><td>${esc([i.sku, i.productName, i.size].filter(Boolean).join(' '))}${i.qty < 0 ? ` <b>(RETURN${i.returnOf?.invoiceNumber ? ` of Bill ${esc(i.returnOf.invoiceNumber)}` : ''})</b>` : ''}</td><td>${m(i.mrp || i.rate)}</td><td>${(Number(i.qty) || 0).toFixed(2)}</td><td>${m(i.rate)}</td><td>${m(i.amount)}</td></tr>`).join('')}</tbody>
    </table>
    <table class="sum">
      ${row('Sub Total', m(t.subtotal))}
      ${row('Discount', m(t.discount))}
      ${row('MRP Total', m(mrpTotal))}
      ${returned ? row('Return Items', m(returned)) : ''}
      ${t.roundOff ? row('Round Off', m(t.roundOff)) : ''}
      ${t.grandTotal < 0 ? row('Refund', `₹${m(-t.grandTotal)}`, 'total') : row('Total', `₹${m(t.grandTotal)}`, 'total')}
    </table>
    <table class="box gst">
      <tr class="h"><td colspan="2">GST Details</td></tr>
      ${gst.map((g) => `${row(`Amt (${g.r}%)`, m(g.taxable))}${g.r ? (sale.interState || g.igst
        ? row(`IGST (${g.r}%)`, m(g.igst))
        : `${row(`CGST (${g.r / 2}%)`, m(g.cgst))}${row(`SGST (${g.r / 2}%)`, m(g.sgst))}`) : ''}`).join('')}
    </table>
    <table class="foot">
      ${policy.map((p) => `<tr><td colspan="2" class="b">${esc(p)}</td></tr>`).join('')}
      ${sale.payments.filter((p) => Number(p.amount)).map((p) => row(`${p.amount < 0 ? 'Refund by' : 'Paid by'} ${esc(BILL_MODE_NAMES[p.mode] || p.mode)}${p.reference ? ` (${esc(p.reference)})` : ''}`, m(Math.abs(p.amount)))).join('')}
      ${t.grandTotal < 0 ? '' : `${row('Amt.Paid', m(received))}${row('Balance', m(sale.changeReturned))}`}
      ${row('Your Savings', m(savings))}
    </table>
    ${sale.loyaltyEarned ? `<div class="c">Loyalty points earned: ${sale.loyaltyEarned}</div>` : ''}
    <div class="thanks">${esc(settings?.invoice?.footerNote || 'Thank You! Visit Again!')}</div>
    <div class="c" style="margin-top:4px">${barcodeSvg(sale.invoiceNumber, { height: 26, width: w === 58 ? 1.1 : 1.3, fontSize: 9 })}</div>
  </body></html>`;
}

/* ---------------- A4 invoice ---------------- */
export function a4InvoiceHtml(inv, { duplicate = false } = {}) {
  const { sale, items, branch, company, settings, hsnSummary } = inv;
  const t = sale.totals;
  const logo = settings?.invoice?.showLogo;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoiceNumber)}</title><style>
    @page { size: A4; margin: 12mm; }
    body { font: 600 12px/1.45 Arial, Helvetica, sans-serif; color: #000; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h1 { font-size: 20px; margin: 0; } .muted { color: #222; } .r { text-align: right; } .c { text-align: center; } .b { font-weight: 700; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .logo { display: block; height: 80px; width: auto; margin-bottom: 6px; }
    .box { border: 1px solid #ccc; padding: 8px; border-radius: 4px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #777; padding: 5px 6px; } th { background: #f3f3f3; font-size: 11px; text-transform: uppercase; }
    .tot td { border: none; padding: 3px 6px; } .grand td { font-size: 15px; font-weight: 700; border-top: 2px solid #111; }
    .title { font-size: 16px; font-weight: 700; letter-spacing: 2px; }
    .footer { margin-top: 18px; display: flex; justify-content: space-between; gap: 20px; }
    .dup { display: inline-block; border: 2px solid #c00; color: #c00; padding: 2px 8px; font-weight: 700; margin-top: 4px; }
  </style></head><body>
    <div class="head">
      <div>
        ${logo ? `<img class="logo" src="${esc(absUrl(PRINT_LOGO))}" alt="${esc(company?.name)}">` : `<h1>${esc(company?.name)}</h1>`}
        <div class="muted">${esc(STORE_ADDRESS)}</div>
        <div class="muted">Phone: ${esc(STORE_PHONE)} ${company?.email ? `· ${esc(company.email)}` : ''}</div>
        <div><b>GSTIN:</b> ${esc(branch?.gstin || company?.gstin || '-')}</div>
      </div>
      <div class="r">
        <div class="title">${esc(settings?.invoice?.title || 'TAX INVOICE')}</div>
        ${duplicate ? '<div class="dup">DUPLICATE</div>' : '<div class="muted">Original for Recipient</div>'}
        <div style="margin-top:6px"><b>Invoice No:</b> ${esc(sale.invoiceNumber)}</div>
        <div><b>Date:</b> ${esc(fdatetime(sale.createdAt))}</div>
        <div><b>Cashier:</b> ${esc(sale.cashierName)}</div>
      </div>
    </div>
    <div class="grid">
      <div class="box"><div class="b">Bill To</div>
        ${sale.customer?.name ? `<div>${esc(sale.customer.name)}</div><div>${esc(sale.customer.mobile || '')}</div><div>${esc(sale.customer.address || '')}</div>${sale.customer.gstNumber ? `<div>GSTIN: ${esc(sale.customer.gstNumber)}</div>` : ''}` : '<div>Walk-in Customer</div>'}
      </div>
      <div class="box"><div class="b">Supply</div><div>Place of supply: ${esc(branch?.address?.state || '')} (${esc(branch?.stateCode || '')})</div><div>Tax type: ${sale.interState ? 'IGST (Inter-state)' : 'CGST + SGST (Intra-state)'}</div><div>Prices ${sale.taxInclusive ? 'inclusive' : 'exclusive'} of GST</div></div>
    </div>
    <table><thead><tr><th>#</th><th>Product</th><th>SKU</th>${settings?.invoice?.showHsn ? '<th>HSN</th>' : ''}<th>Size</th><th>Color</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc</th><th class="r">GST%</th><th class="r">Taxable</th><th class="r">Amount</th></tr></thead><tbody>
      ${items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.productName)}</td><td>${esc(i.sku)}</td>${settings?.invoice?.showHsn ? `<td>${esc(i.hsnCode || '')}</td>` : ''}<td>${esc(i.size || '')}</td><td>${esc(i.color || '')}</td><td class="r">${i.qty}</td><td class="r">${m(i.rate)}</td><td class="r">${m(i.discount)}</td><td class="r">${i.gstRate}</td><td class="r">${m(i.taxable)}</td><td class="r">${m(i.amount)}</td></tr>`).join('')}
    </tbody></table>
    <div class="grid" style="grid-template-columns: 1.3fr 1fr">
      <div>
        <table style="margin-top:6px"><thead><tr><th>HSN</th><th class="r">GST%</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">IGST</th></tr></thead><tbody>
        ${(hsnSummary || []).map((h) => `<tr><td>${esc(h.hsnCode)}</td><td class="r">${h.gstRate}</td><td class="r">${m(h.taxable)}</td><td class="r">${m(h.cgst)}</td><td class="r">${m(h.sgst)}</td><td class="r">${m(h.igst)}</td></tr>`).join('')}
        </tbody></table>
        <div style="margin-top:8px"><b>Amount in words:</b> ${esc(amountInWords(t.grandTotal))}</div>
        <div style="margin-top:6px"><b>Payment:</b> ${sale.payments.map((p) => `${esc(PAYMENT_LABELS[p.mode] || p.mode)} ₹${m(p.amount)}`).join(', ')}</div>
      </div>
      <table class="tot">
        <tr><td>Subtotal</td><td class="r">${m(t.subtotal)}</td></tr>
        <tr><td>Discount</td><td class="r">-${m(t.discount)}</td></tr>
        <tr><td>Taxable Value</td><td class="r">${m(t.taxable)}</td></tr>
        <tr><td>CGST</td><td class="r">${m(t.cgst)}</td></tr>
        <tr><td>SGST</td><td class="r">${m(t.sgst)}</td></tr>
        <tr><td>IGST</td><td class="r">${m(t.igst)}</td></tr>
        <tr><td>Round Off</td><td class="r">${m(t.roundOff)}</td></tr>
        <tr class="grand"><td>Grand Total</td><td class="r">₹${m(t.grandTotal)}</td></tr>
      </table>
    </div>
    <div class="footer">
      <div style="flex:1">
        <div class="b">${esc(settings?.invoice?.footerNote || 'Thank you!')}</div>
        ${settings?.returnPolicy?.enabled ? `<div class="muted"><b>Return Policy:</b> ${esc(settings.returnPolicy.text)}</div>` : ''}
        ${settings?.exchangePolicy?.enabled ? `<div class="muted"><b>Exchange Policy:</b> ${esc(settings.exchangePolicy.text)}</div>` : ''}
        ${settings?.invoice?.terms ? `<div class="muted">${esc(settings.invoice.terms)}</div>` : ''}
      </div>
      <div class="c" style="width:200px"><div style="height:50px"></div><div style="border-top:1px solid #111">Authorised Signatory</div><div class="muted">For ${esc(company?.name)}</div></div>
    </div>
  </body></html>`;
}

/* ---------------- Barcode labels ---------------- */
export const LABEL_SIZES = {
  '50x25': { w: 50, h: 25, label: '50 x 25 mm (roll)' },
  '38x25': { w: 38, h: 25, label: '38 x 25 mm (roll)' },
  '40x30': { w: 40, h: 30, label: '40 x 30 mm (roll)' },
  '75x38': { w: 75, h: 38, label: '75 x 38 mm (hang tag)' },
  'A4-65': { w: 38.1, h: 21.2, label: 'A4 sheet - 65 labels (38.1 x 21.2)', sheet: { cols: 5, gapX: 2.5, gapY: 0, marginTop: 10.7, marginLeft: 4.7 } },
  'A4-24': { w: 64, h: 33.9, label: 'A4 sheet - 24 labels (64 x 33.9)', sheet: { cols: 3, gapX: 2.5, gapY: 0, marginTop: 13, marginLeft: 6 } },
};

export function labelsHtml(labels, { size = '50x25', columns = 1, storeName = '', fields = {}, format } = {}) {
  const s = LABEL_SIZES[size] || LABEL_SIZES['50x25'];
  const small = s.h < 24;
  const f = { showStoreName: true, showProductName: true, showSku: true, showSizeColor: true, showMrp: true, showSellingPrice: true, ...fields };
  const flat = labels.flatMap((l) => Array.from({ length: l.qty }, () => l));
  const cols = s.sheet ? s.sheet.cols : Math.max(1, columns);
  const gapX = s.sheet ? s.sheet.gapX : 2;
  const pageW = s.sheet ? 210 : s.w * cols + (cols - 1) * gapX;
  const narrow = s.w < 45; // 38 / 40 mm labels: tighter text so the barcode keeps its height
  const fs = (big, mid, tiny) => (small ? tiny : narrow ? mid : big);
  const meta = (l) => [f.showSizeColor && [l.color, l.size].filter(Boolean).join(' / '), f.showSku && l.sku].filter(Boolean);
  const label = (l) => `<div class="lbl">
      ${f.showStoreName && storeName && !small ? `<div class="store">${esc(storeName)}</div>` : ''}
      ${f.showProductName ? `<div class="name">${esc(l.productName)}</div>` : ''}
      ${meta(l).length ? `<div class="meta">${meta(l).map(esc).join(' · ')}</div>` : ''}
      <div class="bc">${barcodeSvg(l.barcode, { format: format || l.format, height: 40, width: 2, displayValue: false, fit: true })}</div>
      <div class="code">${esc(l.barcode)}</div>
      ${f.showMrp || f.showSellingPrice ? `<div class="price">${f.showMrp ? `<span class="${f.showSellingPrice && l.sellingPrice < l.mrp ? 'mrp strike' : 'mrp'}">MRP ₹${Number(l.mrp).toFixed(0)}</span>` : ''}${f.showSellingPrice && (!f.showMrp || l.sellingPrice < l.mrp) ? ` <b>₹${Number(l.sellingPrice).toFixed(0)}</b>` : ''}</div>` : ''}
    </div>`;
  // roll printers: one physical label row per printed page, so the printer's gap sensor
  // lines every label up and rounding never adds up across the roll
  const rows = [];
  for (let i = 0; i < flat.length; i += cols) rows.push(flat.slice(i, i + cols));
  const body = s.sheet
    ? `<div class="sheet">${flat.map(label).join('')}</div>`
    : rows.map((r) => `<div class="row">${r.map(label).join('')}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    @page { size: ${s.sheet ? 'A4' : `${pageW}mm ${s.h}mm`}; margin: 0; }
    * { box-sizing: border-box; margin: 0; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { display: grid; grid-template-columns: repeat(${cols}, ${s.w}mm); column-gap: ${gapX}mm; row-gap: ${s.sheet ? s.sheet.gapY : 0}mm; grid-auto-rows: ${s.h}mm;
      ${s.sheet ? `padding: ${s.sheet.marginTop}mm 0 0 ${s.sheet.marginLeft}mm;` : ''} }
    .row { display: grid; grid-template-columns: repeat(${cols}, ${s.w}mm); column-gap: ${gapX}mm; width: ${pageW}mm; height: ${s.h}mm; overflow: hidden; break-after: page; page-break-after: always; }
    .row:last-child { break-after: auto; page-break-after: auto; }
    .lbl { width: ${s.w}mm; height: ${s.h}mm; padding: 1mm 1.5mm 0.8mm; overflow: hidden; display: flex; flex-direction: column; text-align: center; line-height: 1.15; break-inside: avoid; page-break-inside: avoid; }
    .lbl > div { flex: 0 0 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .store { font-size: ${fs(6.5, 5.5, 5)}pt; font-weight: 700; letter-spacing: .3px; text-transform: uppercase; }
    .name { font-size: ${fs(7.5, 6.5, 6)}pt; font-weight: 700; }
    .meta { font-size: ${fs(6.5, 5.5, 5)}pt; color: #222; }
    .lbl > .bc { flex: 1 1 0; min-height: 3mm; position: relative; margin: 0.5mm 0.5mm 0; }
    .bc svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
    .code { font: ${fs(7, 6, 5.5)}pt/1.1 'Courier New', monospace; letter-spacing: .5px; }
    .price { font-size: ${fs(8.5, 7.5, 6.5)}pt; } .strike { text-decoration: line-through; color: #444; }
  </style></head><body>${body}</body></html>`;
}

/* ---------------- Generic document (transfer note, purchase, return receipt) ---------------- */
export function simpleDocHtml({ title, company, subtitle, meta = [], columns, rows, totals = [], footer = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4; margin: 12mm; } body { font: 12px/1.4 Arial, sans-serif; color: #111; }
    h1 { font-size: 18px; margin: 0 0 2px; } .muted { color: #222; } table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #777; padding: 5px 6px; } th { background: #f3f3f3; font-size: 11px; text-transform: uppercase; text-align: left; } .r { text-align: right; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 16px; margin-top: 10px; }
  </style></head><body>
    <h1>${esc(company?.name || '')}</h1><div class="muted">${esc(subtitle || '')}</div>
    <h2 style="font-size:15px;margin:12px 0 0">${esc(title)}</h2>
    <div class="meta">${meta.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</div>
    <table><thead><tr>${columns.map((c) => `<th class="${c.right ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.right ? 'r' : ''}">${esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <table style="width:auto;margin-left:auto">${totals.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td class="r">${esc(v)}</td></tr>`).join('')}</table>
    <div style="margin-top:30px" class="muted">${esc(footer)}</div>
    <div style="display:flex;justify-content:space-between;margin-top:50px"><div>Prepared by</div><div>Checked by</div><div>Received by</div></div>
  </body></html>`;
}

export const printReceipt = (inv, opts = {}) => {
  const fmt = opts.format || inv.settings?.printer?.defaultInvoiceFormat || 'thermal';
  const html = fmt === 'a4' ? a4InvoiceHtml(inv, opts) : receiptHtml(inv, { width: inv.settings?.printer?.receiptWidth, ...opts });
  return printHtml(html, { title: inv.sale.invoiceNumber });
};
