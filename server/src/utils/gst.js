const { round2 } = require('./common');

const VALID_GST = [0, 5, 12, 18, 28];

/**
 * Computes line + bill totals for sales / purchases / exchanges.
 * items: [{ qty, rate, discount (amount), discountPercent, gstRate }]
 * opts: { taxInclusive, interState, billDiscount }
 * Bill discount is distributed proportionally over line nets before tax, so GST is computed on the real taxable value.
 */
function computeTotals(items, { taxInclusive = true, interState = false, billDiscount = 0 } = {}) {
  const lines = items.map((it) => {
    const qty = Number(it.qty);
    const rate = Number(it.rate);
    const gross = round2(qty * rate);
    let lineDiscount = it.discountPercent ? round2((gross * Number(it.discountPercent)) / 100) : round2(it.discount || 0);
    if (lineDiscount > gross) lineDiscount = gross;
    return { ...it, qty, rate, gross, lineDiscount, net: round2(gross - lineDiscount) };
  });

  const totalNet = lines.reduce((a, l) => a + l.net, 0);
  let billDisc = Math.min(round2(billDiscount || 0), round2(totalNet));
  let remaining = billDisc;

  lines.forEach((l, i) => {
    let share = 0;
    if (billDisc > 0 && totalNet > 0) {
      share = i === lines.length - 1 ? remaining : round2((billDisc * l.net) / totalNet);
      share = Math.min(share, l.net, remaining);
      remaining = round2(remaining - share);
    }
    const net = round2(l.net - share);
    const gstRate = Number(l.gstRate || 0);
    let taxable;
    let tax;
    if (taxInclusive) {
      taxable = round2(net / (1 + gstRate / 100));
      tax = round2(net - taxable);
    } else {
      taxable = net;
      tax = round2((net * gstRate) / 100);
    }
    l.billDiscountShare = share;
    l.discountTotal = round2(l.lineDiscount + share);
    l.taxable = taxable;
    l.taxAmount = tax;
    l.cgst = interState ? 0 : round2(tax / 2);
    l.sgst = interState ? 0 : round2(tax - round2(tax / 2));
    l.igst = interState ? tax : 0;
    l.amount = taxInclusive ? net : round2(net + tax);
  });

  const s = (k) => round2(lines.reduce((a, l) => a + (l[k] || 0), 0));
  const rawTotal = s('amount');
  const grandTotal = Math.round(rawTotal);
  return {
    lines,
    totals: {
      totalQty: lines.reduce((a, l) => a + l.qty, 0),
      subtotal: s('gross'),
      itemDiscount: s('lineDiscount'),
      billDiscount: billDisc,
      discount: s('discountTotal'),
      taxable: s('taxable'),
      cgst: s('cgst'),
      sgst: s('sgst'),
      igst: s('igst'),
      totalTax: s('taxAmount'),
      roundOff: round2(grandTotal - rawTotal),
      grandTotal,
    },
  };
}

/** Intra-state (CGST+SGST) vs inter-state (IGST) based on tax settings and customer GSTIN/state. */
function isInterState(taxSettings, branch, customer) {
  const mode = taxSettings?.mode || 'intra';
  if (mode === 'intra') return false;
  if (mode === 'inter') return true;
  const branchState = branch?.stateCode || (branch?.gstin || '').slice(0, 2);
  const custState = customer?.stateCode || (customer?.gstNumber || '').slice(0, 2);
  return Boolean(branchState && custState && branchState !== custState);
}

module.exports = { computeTotals, isInterState, VALID_GST };
