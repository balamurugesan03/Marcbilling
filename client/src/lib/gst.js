// Client-side mirror of server/src/utils/gst.js for live cart display. The server re-computes and is authoritative.
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function computeTotals(items, { taxInclusive = true, interState = false, billDiscount = 0 } = {}) {
  const lines = items.map((it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(it.rate) || 0;
    const gross = r2(qty * rate);
    // a return line (negative qty) gives back the same discount its piece had: the discount is minus too
    const sign = qty < 0 ? -1 : 1;
    let lineDiscount = it.discountPercent ? r2((gross * Number(it.discountPercent)) / 100) : r2(sign * (it.discount || 0));
    if (Math.abs(lineDiscount) > Math.abs(gross)) lineDiscount = gross;
    return { ...it, gross, lineDiscount, net: r2(gross - lineDiscount) };
  });
  // bill discount is spread over the sold lines, but never more than the net bill (sold − returned)
  const totalNet = lines.reduce((a, l) => a + (l.net > 0 ? l.net : 0), 0);
  const netBill = Math.max(0, lines.reduce((a, l) => a + l.net, 0));
  const lastSold = lines.reduce((k, l, i) => (l.net > 0 ? i : k), -1);
  const billDisc = Math.min(r2(billDiscount || 0), r2(netBill));
  let remaining = billDisc;
  lines.forEach((l, i) => {
    let share = 0;
    if (billDisc > 0 && totalNet > 0 && l.net > 0) {
      share = i === lastSold ? remaining : r2((billDisc * l.net) / totalNet);
      share = Math.min(share, l.net, remaining);
      remaining = r2(remaining - share);
    }
    const net = r2(l.net - share);
    const g = Number(l.gstRate || 0);
    const taxable = taxInclusive ? r2(net / (1 + g / 100)) : net;
    const tax = taxInclusive ? r2(net - taxable) : r2((net * g) / 100);
    l.discountTotal = r2(l.lineDiscount + share);
    l.taxable = taxable;
    l.taxAmount = tax;
    l.cgst = interState ? 0 : r2(tax / 2);
    l.sgst = interState ? 0 : r2(tax - r2(tax / 2));
    l.igst = interState ? tax : 0;
    l.amount = taxInclusive ? net : r2(net + tax);
  });
  const s = (k) => r2(lines.reduce((a, l) => a + (l[k] || 0), 0));
  const raw = s('amount');
  const grandTotal = Math.round(raw);
  return {
    lines,
    totals: {
      totalQty: lines.reduce((a, l) => a + (Number(l.qty) || 0), 0),
      subtotal: s('gross'), itemDiscount: s('lineDiscount'), billDiscount: billDisc, discount: s('discountTotal'),
      taxable: s('taxable'), cgst: s('cgst'), sgst: s('sgst'), igst: s('igst'), totalTax: s('taxAmount'),
      roundOff: r2(grandTotal - raw), grandTotal,
    },
  };
}

export function isInterState(taxSettings, branch, customer) {
  const mode = taxSettings?.mode || 'intra';
  if (mode === 'intra') return false;
  if (mode === 'inter') return true;
  const b = branch?.stateCode || (branch?.gstin || '').slice(0, 2);
  const c = customer?.stateCode || (customer?.gstNumber || '').slice(0, 2);
  return Boolean(b && c && b !== c);
}
