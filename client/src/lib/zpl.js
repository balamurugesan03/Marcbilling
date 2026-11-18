/*
 * Zebra (ZPL) barcode labels, built from the store's own ZebraDesigner PRN:
 * ZD220, 203 dpi, 2 labels across (631 x 200 dots = 80 x 25 mm), right label 328 dots after the left one.
 * Sent straight to the printer through Zebra Browser Print (no browser print dialog, no driver page size).
 */

const LABEL_W = 310; // dots of one label (the second label starts at +328)
const OFFSET_X = 328;
const BC_LEFT = 10; // barcode area: from here to the vertical code at the right edge
const BC_RIGHT = 272;

// job settings from the PRN: gap media, thermal transfer, speed 4, darkness 15, UTF-8
const HEADER = 'CT~~CD,~CC^~CT~\n^XA\n~TA000\n~JSN\n^LT0\n^MNW\n^MTT\n^PON\n^PMN\n^LH0,0\n^JMA\n^PR4,4\n~SD15\n^LRN\n^CI27\n^PA0,1,1,0\n^XZ\n';

// text for a ^FH\ field: ^ ~ \ would be read as commands, so send them as hex
const txt = (s) => String(s ?? '').replace(/[\\^~]/g, (c) => `\\${c.charCodeAt(0).toString(16).toUpperCase()}`);
const cut = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n) : String(s ?? ''));
const money = (n) => (Number(n) || 0).toFixed(2);

/**
 * Code128 data with explicit subsets (>; start C, >: start B, >5 to C, >6 to B), so the width is known
 * and the barcode can be centred: digit runs go in subset C (2 digits a bar pattern), the rest in B.
 */
export function code128Zpl(value) {
  const s = String(value ?? '');
  let out = '';
  let sym = 0;
  let set = null;
  let i = 0;
  while (i < s.length) {
    const run = /^\d*/.exec(s.slice(i))[0].length;
    if (run >= 4 || (run >= 2 && run % 2 === 0 && run === s.length - i && set !== 'B')) {
      const k = run - (run % 2);
      if (set === null) out += '>;';
      else if (set === 'B') { out += '>5'; sym += 1; }
      set = 'C';
      out += s.substr(i, k);
      sym += k / 2;
      i += k;
    } else {
      if (set === null) out += '>:';
      else if (set === 'C') { out += '>6'; sym += 1; }
      set = 'B';
      out += s[i] === '>' ? '><' : txt(s[i]);
      sym += 1;
      i += 1;
    }
  }
  return { data: out, modules: sym * 11 + 35 }; // + start, check digit, stop
}

function labelZpl(l, x0, { storeName, fields: f }) {
  const x = (n) => n + x0;
  const parts = [];
  if (f.showStoreName && storeName) parts.push(`^FT${x(0)},53^FB${LABEL_W},1,0,C^A0N,43,41^FH\\^CI28^FD${txt(cut(storeName, 12))}^FS^CI27`);
  const bc = code128Zpl(l.barcode);
  const bw = bc.modules * 2 <= BC_RIGHT - BC_LEFT ? 2 : 1; // narrow bars only when a long code would not fit
  const bx = BC_LEFT + Math.max(0, Math.floor((BC_RIGHT - BC_LEFT - bc.modules * bw) / 2));
  parts.push(`^BY${bw},3,55^FT${x(bx)},115^BCN,,Y,N`, `^FH\\^FD${bc.data}^FS`);
  if (f.showSku && l.sku) {
    const sku = cut(l.sku, 14);
    const h = Math.max(12, Math.min(20, Math.floor(110 / (sku.length * 0.55)))); // shrink a long code to fit the side
    parts.push(`^FT${x(295)},114^A0B,${h},${h}^FH\\^CI28^FD${txt(sku)}^FS^CI27`);
  }
  if (f.showMrp) parts.push(`^FPH,1^FT${x(11)},163^A0N,27,23^FH\\^CI28^FDMRP : ${money(l.mrp)}^FS^CI27`);
  if (f.showProductName) {
    const name = [l.productName, f.showSizeColor && l.size].filter(Boolean).join(' ');
    parts.push(`^FT${x(174)},161^A0N,17,15^FH\\^CI28^FD${txt(cut(name, 18))}^FS^CI27`);
  }
  if (f.showSellingPrice) parts.push(`^FT${x(10)},191^A0N,28,28^FH\\^CI28^FDOur Price : ${money(l.sellingPrice)}^FS^CI27`);
  return parts.join('\n');
}

/** labels: [{ productName, sku, size, mrp, sellingPrice, barcode, qty }] -> one ZPL job, 2 labels a row */
export function labelsZpl(labels, { storeName = '', fields = {} } = {}) {
  const f = { showStoreName: true, showProductName: true, showSku: true, showSizeColor: true, showMrp: true, showSellingPrice: true, ...fields };
  const flat = labels.flatMap((l) => Array.from({ length: Number(l.qty) || 1 }, () => l));
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) {
    const [a, b] = [flat[i], flat[i + 1]];
    rows.push(`^XA\n^MMT\n^PW631\n^LL200\n^LS0\n${labelZpl(a, 0, { storeName, fields: f })}${b ? `\n${labelZpl(b, OFFSET_X, { storeName, fields: f })}` : ''}\n^PQ1,0,1,Y\n^XZ\n`);
  }
  return HEADER + rows.join('');
}

/* ---------------- Zebra Browser Print (local agent on the PC the printer is plugged into) ---------------- */
const agent = () => (window.location.protocol === 'https:' ? 'https://127.0.0.1:9101' : 'http://127.0.0.1:9100');

async function zebraPrinter() {
  const pick = (d) => d && d.name && d.uid;
  try {
    const r = await fetch(`${agent()}/default?type=printer`);
    const t = await r.text();
    const d = t ? JSON.parse(t) : null;
    if (pick(d)) return d;
  } catch { /* fall through to the list */ }
  const r = await fetch(`${agent()}/available`);
  const list = (await r.json())?.printer || [];
  const d = list.find((p) => /zd220/i.test(p.name)) || list[0];
  if (!d) throw new Error('No Zebra printer found by Zebra Browser Print. Check the printer is on and connected.');
  return d;
}

/** Sends raw ZPL to the Zebra printer. Throws a readable error when Browser Print is not running. */
export async function zebraPrint(zpl) {
  let device;
  try {
    device = await zebraPrinter();
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Zebra Browser Print is not running on this computer (install it from zebra.com and start it).');
    throw e;
  }
  const r = await fetch(`${agent()}/write`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ device, data: zpl }) });
  if (!r.ok) throw new Error(`Zebra printer refused the job (${r.status}) ${await r.text().catch(() => '')}`.trim());
  return device.name;
}

/** Saves the ZPL as a .prn file (for copy /b labels.prn \\localhost\ZD220 or Zebra Setup Utilities). */
export function downloadPrn(zpl, name = 'labels.prn') {
  const url = URL.createObjectURL(new Blob([zpl], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
