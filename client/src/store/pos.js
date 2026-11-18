import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Keeps each minus line in step with the billed line it returns: same rate, the same discount
 * share per piece, and never more pieces than were billed.
 */
function syncReturns(items) {
  const byKey = new Map(items.map((l) => [l.key, l]));
  return items.flatMap((l) => {
    if (l.returnRef) { // item from an earlier bill: at most what is still returnable, discount per piece of that bill
      const n = Math.max(1, Math.min(-l.qty, l.returnRef.maxQty));
      return [{ ...l, qty: -n, discountPercent: 0, discount: r2(l.returnRef.unitDiscount * n) }];
    }
    if (!l.returnOf) return [l];
    const p = byKey.get(l.returnOf);
    if (!p || p.qty <= 0) return []; // billed line gone
    const n = Math.min(-l.qty, p.qty);
    return [{ ...l, qty: -n, rate: p.rate, discountPercent: p.discountPercent || 0, discount: p.discountPercent ? 0 : r2(((p.discount || 0) * n) / p.qty) }];
  });
}

/** POS cart, persisted so a page reload / "create product" detour never loses the bill. */
export const usePOS = create(persist((set, get) => ({
  items: [],
  customer: null,
  billDiscount: 0,
  withGst: true, // POS switch: bill with / without GST (stays as set until switched back)
  selected: 0,
  heldBillId: null,
  lastSaleId: null,

  addVariant(v, qty = 1) {
    const items = [...get().items];
    const idx = items.findIndex((i) => i.variantId === v._id && i.qty > 0 && i.rate === v.sellingPrice && !i.discount && !i.discountPercent);
    if (idx >= 0) {
      items[idx] = { ...items[idx], qty: items[idx].qty + qty, stock: v.stock ?? items[idx].stock };
      // move the updated line to the top? keep position, but select it
      set({ items, selected: idx });
      return items[idx];
    }
    const line = {
      key: `${v._id}-${Date.now()}`, variantId: v._id, productName: v.productName, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color,
      qty, rate: v.sellingPrice, originalRate: v.sellingPrice, mrp: v.mrp, gstRate: v.gstRate, discount: 0, discountPercent: 0, stock: v.stock,
    };
    items.push(line);
    set({ items, selected: items.length - 1 });
    return line;
  },
  updateLine(index, patch) {
    const items = get().items.map((l, i) => (i === index ? { ...l, ...patch } : l));
    set({ items: syncReturns(items) });
  },
  /**
   * Customer does not want one piece of a billed line: add (or grow) a minus line right below it,
   * at the same rate and discount, so the total drops by exactly what that piece cost.
   * On a minus line it undoes one piece. Returns { line } or { error }.
   */
  returnOne(index) {
    const items = [...get().items];
    const line = items[index];
    if (!line) return { error: 'Select an item first' };
    if (line.qty < 0) {
      if (line.qty === -1) items.splice(index, 1); else items[index] = { ...line, qty: line.qty + 1 };
      set({ items: syncReturns(items), selected: Math.max(0, Math.min(index, items.length - 1)) });
      return { undone: true, line };
    }
    const ri = items.findIndex((i) => i.returnOf === line.key);
    const returned = ri >= 0 ? -items[ri].qty : 0;
    if (returned >= line.qty) return { error: `All ${line.qty} of ${line.productName} already returned` };
    const ret = { ...line, key: `${line.key}-ret`, returnOf: line.key, qty: -(returned + 1) };
    if (ri >= 0) items[ri] = ret; else items.splice(index + 1, 0, ret);
    set({ items: syncReturns(items), selected: ri >= 0 ? ri : index + 1 });
    return { line: ret };
  },
  /**
   * Items of an earlier bill (invoice scanned in the return popup) come in as minus lines priced
   * from that bill. it = the old bill's sale item, n = pieces, maxQty = still returnable.
   */
  addOldBillReturn(it, n, { saleId, invoiceNumber, maxQty }) {
    const items = [...get().items];
    const i = items.findIndex((l) => l.returnRef?.saleItemId === it._id);
    const returnRef = { saleId, saleItemId: it._id, invoiceNumber, maxQty, unitDiscount: r2((it.discount || 0) / it.qty) };
    if (i >= 0) items[i] = { ...items[i], qty: items[i].qty - n, returnRef };
    else {
      items.push({
        key: `ret-${it._id}`, variantId: it.variantId, productName: it.productName, sku: it.sku, barcode: it.barcode, size: it.size, color: it.color,
        qty: -n, rate: it.rate, originalRate: it.rate, mrp: it.mrp, gstRate: it.gstRate, discount: 0, discountPercent: 0, returnRef,
      });
    }
    set({ items: syncReturns(items), selected: i >= 0 ? i : items.length - 1 });
  },
  /** Item brought back from an earlier purchase: the scanned line itself flips to a minus quantity. */
  toggleReturn(index) {
    const line = get().items[index];
    if (!line || line.returnOf || line.returnRef || get().items.some((i) => i.returnOf === line.key)) return null;
    const items = get().items.map((l, i) => (i === index ? { ...l, qty: -l.qty, discount: 0, discountPercent: 0 } : l));
    set({ items });
    return items[index];
  },
  removeLine(index) {
    const gone = get().items[index];
    // removing a billed line also removes its minus (return) line
    const items = get().items.filter((l, i) => i !== index && !(gone && l.returnOf === gone.key));
    set({ items: syncReturns(items), selected: Math.max(0, Math.min(index, items.length - 1)) });
  },
  select: (i) => set({ selected: Math.max(0, Math.min(i, get().items.length - 1)) }),
  setCustomer: (customer) => set({ customer }),
  setBillDiscount: (billDiscount) => set({ billDiscount: Number(billDiscount) || 0 }),
  load: ({ items, customer, billDiscount, heldBillId }) => set({ items, customer, billDiscount: billDiscount || 0, heldBillId, selected: 0 }),
  setWithGst: (withGst) => set({ withGst: Boolean(withGst) }),
  clear: () => set({ items: [], customer: null, billDiscount: 0, selected: 0, heldBillId: null }),
  setLastSale: (id) => set({ lastSaleId: id }),
}), { name: 'fpos-cart' }));
