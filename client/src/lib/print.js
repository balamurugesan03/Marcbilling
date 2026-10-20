import JsBarcode from 'jsbarcode';
import { amountInWords, fdatetime, PAYMENT_LABELS } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const absUrl = (u) => (u && u.startsWith('/') ? `${window.location.origin}${u}` : u);
const PRINT_LOGO = '/loginimage.jpeg';
const STORE_ADDRESS = 'Vellayani Jn, Trivandrum';
const STORE_PHONE = '7907858891';

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

export function barcodeSvg(value, { format = 'CODE128', height = 40, width = 1.6, fontSize = 12, displayValue = true, margin = 0 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, value, { format: format === 'EAN13' ? 'EAN13' : 'CODE128', height, width, fontSize, displayValue, margin, textMargin: 1, font: 'monospace' });
  } catch {
    JsBarcode(svg, value, { format: 'CODE128', height, width, fontSize, displayValue, margin });
  }
  return svg.outerHTML;
}

/* ---------------- Thermal receipt (58 / 80 mm) ---------------- */
export function receiptHtml(inv, { width = '80', duplicate = false } = {}) {
  const { sale, items, branch, company, settings, savings } = inv;
  const w = width === '58' ? 58 : 80;
  const font = w === 58 ? 10 : 11.5;
  const t = sale.totals;
  const logo = settings?.invoice?.showLogo;
  const policy = [settings?.returnPolicy?.enabled && settings.returnPolicy.text, settings?.exchangePolicy?.enabled && settings.exchangePolicy.text].filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoiceNumber)}</title><style>
    @page { size: ${w}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { width: ${w}mm; margin: 0; padding: 3mm ${w === 58 ? 2 : 3.5}mm; font: ${font}px/1.35 'Courier New', monospace; color: #000; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
    .big { font-size: ${font + 5}px; } .hr { border-top: 1px dashed #000; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 1px 0; vertical-align: top; } th { text-align: left; border-bottom: 1px dashed #000; }
    .logo { height: ${w === 58 ? 22 : 26}mm; width: auto; margin-bottom: 2px; }
    .dup { border: 1px solid #000; padding: 1px 4px; display: inline-block; margin: 2px 0; }
  </style></head><body>
    ${logo ? `<div class="c"><img class="logo" src="${esc(absUrl(PRINT_LOGO))}" alt="${esc(company?.name)}"></div>` : `<div class="c b big">${esc(company?.name)}</div>`}
    <div class="c">${esc(STORE_ADDRESS)}</div>
    <div class="c">Ph: ${esc(STORE_PHONE)}</div>
    ${branch?.gstin || company?.gstin ? `<div class="c">GSTIN: ${esc(branch?.gstin || company?.gstin)}</div>` : ''}
    <div class="hr"></div>
    <div class="c b">${esc(settings?.invoice?.title || 'TAX INVOICE')}</div>
    ${duplicate ? '<div class="c"><span class="dup b">DUPLICATE COPY</span></div>' : ''}
    <table><tr><td>Bill: <b>${esc(sale.invoiceNumber)}</b></td></tr><tr><td>Date: ${esc(fdatetime(sale.createdAt))}</td></tr><tr><td>Cashier: ${esc(sale.cashierName)}</td></tr>
    ${sale.customer?.name ? `<tr><td>Customer: ${esc(sale.customer.name)} ${sale.customer.mobile ? `(${esc(sale.customer.mobile)})` : ''}</td></tr>` : ''}
    ${sale.customer?.gstNumber ? `<tr><td>Cust GSTIN: ${esc(sale.customer.gstNumber)}</td></tr>` : ''}</table>
    <div class="hr"></div>
    <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amt</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td colspan="4">${esc(i.productName)}${i.size || i.color ? ` <span>(${esc([i.color, i.size].filter(Boolean).join('/'))})</span>` : ''}</td></tr>
      <tr><td style="font-size:${font - 1.5}px">${esc(i.sku)}${i.discount ? ` Disc ${m(i.discount)}` : ''} GST ${i.gstRate}%</td><td class="r">${i.qty}</td><td class="r">${m(i.rate)}</td><td class="r">${m(i.amount)}</td></tr>`).join('')}
    </tbody></table>
    <div class="hr"></div>
    <table>
      <tr><td>Items / Qty</td><td class="r">${items.length} / ${t.totalQty}</td></tr>
      <tr><td>Subtotal</td><td class="r">${m(t.subtotal)}</td></tr>
      ${t.discount ? `<tr><td>Discount</td><td class="r">-${m(t.discount)}</td></tr>` : ''}
      <tr><td>Taxable</td><td class="r">${m(t.taxable)}</td></tr>
      ${t.cgst ? `<tr><td>CGST</td><td class="r">${m(t.cgst)}</td></tr><tr><td>SGST</td><td class="r">${m(t.sgst)}</td></tr>` : ''}
      ${t.igst ? `<tr><td>IGST</td><td class="r">${m(t.igst)}</td></tr>` : ''}
      ${t.roundOff ? `<tr><td>Round Off</td><td class="r">${m(t.roundOff)}</td></tr>` : ''}
      <tr class="b big"><td>TOTAL</td><td class="r">₹${m(t.grandTotal)}</td></tr>
    </table>
    <div class="hr"></div>
    <table>${sale.payments.map((p) => `<tr><td>${esc(PAYMENT_LABELS[p.mode] || p.mode)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="r">${m(p.amount)}</td></tr>`).join('')}
      ${sale.changeReturned ? `<tr><td>Cash tendered</td><td class="r">${m(sale.tenderedAmount - sale.payments.filter((p) => p.mode !== 'cash').reduce((a, p) => a + p.amount, 0))}</td></tr><tr><td>Change</td><td class="r">${m(sale.changeReturned)}</td></tr>` : ''}
    </table>
    ${settings?.invoice?.showSavings && savings > 0 ? `<div class="hr"></div><div class="c b">You saved ₹${m(savings)} on MRP!</div>` : ''}
    ${sale.loyaltyEarned ? `<div class="c">Loyalty points earned: ${sale.loyaltyEarned}</div>` : ''}
    <div class="hr"></div>
    <div class="c b">${esc(settings?.invoice?.footerNote || 'Thank You! Visit Again')}</div>
    ${policy.map((p) => `<div class="c" style="font-size:${font - 2}px;margin-top:2px">${esc(p)}</div>`).join('')}
    <div class="c" style="margin-top:6px">${barcodeSvg(sale.invoiceNumber, { height: 28, width: 1.1, fontSize: 9 })}</div>
  </body></html>`;
}

/* ---------------- A4 invoice ---------------- */
export function a4InvoiceHtml(inv, { duplicate = false } = {}) {
  const { sale, items, branch, company, settings, hsnSummary } = inv;
  const t = sale.totals;
  const logo = settings?.invoice?.showLogo;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.invoiceNumber)}</title><style>
    @page { size: A4; margin: 12mm; }
    body { font: 12px/1.45 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 20px; margin: 0; } .muted { color: #555; } .r { text-align: right; } .c { text-align: center; } .b { font-weight: 700; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .logo { display: block; height: 80px; width: auto; margin-bottom: 6px; }
    .box { border: 1px solid #ccc; padding: 8px; border-radius: 4px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 5px 6px; } th { background: #f3f3f3; font-size: 11px; text-transform: uppercase; }
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
  const pageW = s.sheet ? 210 : s.w * cols + (cols - 1) * 2;
  const bcH = Math.max(14, Math.round(s.h * (small ? 1.2 : 1.45)));
  const label = (l) => `<div class="lbl">
      ${f.showStoreName && storeName && !small ? `<div class="store">${esc(storeName)}</div>` : ''}
      ${f.showProductName ? `<div class="name">${esc(l.productName)}</div>` : ''}
      <div class="meta">${f.showSizeColor ? esc([l.color, l.size].filter(Boolean).join(' / ')) : ''}${f.showSku ? ` <span class="sku">${esc(l.sku)}</span>` : ''}</div>
      <div class="bc">${barcodeSvg(l.barcode, { format: format || l.format, height: bcH, width: s.w < 45 ? 1.1 : 1.4, fontSize: small ? 9 : 11 })}</div>
      <div class="price">${f.showMrp ? `<span class="${f.showSellingPrice && l.sellingPrice < l.mrp ? 'mrp strike' : 'mrp'}">MRP ₹${Number(l.mrp).toFixed(0)}</span>` : ''}${f.showSellingPrice && (!f.showMrp || l.sellingPrice < l.mrp) ? ` <b>₹${Number(l.sellingPrice).toFixed(0)}</b>` : ''}</div>
    </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    @page { size: ${s.sheet ? 'A4' : `${pageW}mm ${s.h}mm`}; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
    .sheet { display: grid; grid-template-columns: repeat(${cols}, ${s.w}mm); column-gap: ${s.sheet ? s.sheet.gapX : 2}mm; row-gap: ${s.sheet ? s.sheet.gapY : 0}mm;
      ${s.sheet ? `padding: ${s.sheet.marginTop}mm 0 0 ${s.sheet.marginLeft}mm;` : ''} }
    .lbl { width: ${s.w}mm; height: ${s.h}mm; padding: 0.8mm 1.5mm; overflow: hidden; display: flex; flex-direction: column; align-items: stretch; text-align: center; page-break-inside: avoid; line-height: 1.1; }
    .store { font-size: ${small ? 5.5 : 6.5}pt; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
    .name { font-size: ${small ? 6 : 7.5}pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: ${small ? 5.5 : 6.5}pt; white-space: nowrap; overflow: hidden; } .sku { color: #333; }
    .bc { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 0.3mm 0; }
    .bc svg { height: 100%; width: auto; max-width: 100%; display: block; }
    .price { font-size: ${small ? 6.5 : 8.5}pt; white-space: nowrap; } .strike { text-decoration: line-through; color: #444; }
  </style></head><body><div class="sheet">${flat.map(label).join('')}</div></body></html>`;
}

/* ---------------- Generic document (transfer note, purchase, return receipt) ---------------- */
export function simpleDocHtml({ title, company, subtitle, meta = [], columns, rows, totals = [], footer = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4; margin: 12mm; } body { font: 12px/1.4 Arial, sans-serif; color: #111; }
    h1 { font-size: 18px; margin: 0 0 2px; } .muted { color: #555; } table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ccc; padding: 5px 6px; } th { background: #f3f3f3; font-size: 11px; text-transform: uppercase; text-align: left; } .r { text-align: right; }
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
