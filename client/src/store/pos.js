import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** POS cart, persisted so a page reload / "create product" detour never loses the bill. */
export const usePOS = create(persist((set, get) => ({
  items: [],
  customer: null,
  billDiscount: 0,
  selected: 0,
  heldBillId: null,
  lastSaleId: null,

  addVariant(v, qty = 1) {
    const items = [...get().items];
    const idx = items.findIndex((i) => i.variantId === v._id && i.rate === v.sellingPrice && !i.discount && !i.discountPercent);
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
    set({ items });
  },
  removeLine(index) {
    const items = get().items.filter((_, i) => i !== index);
    set({ items, selected: Math.max(0, Math.min(index, items.length - 1)) });
  },
  select: (i) => set({ selected: Math.max(0, Math.min(i, get().items.length - 1)) }),
  setCustomer: (customer) => set({ customer }),
  setBillDiscount: (billDiscount) => set({ billDiscount: Number(billDiscount) || 0 }),
  load: ({ items, customer, billDiscount, heldBillId }) => set({ items, customer, billDiscount: billDiscount || 0, heldBillId, selected: 0 }),
  clear: () => set({ items: [], customer: null, billDiscount: 0, selected: 0, heldBillId: null }),
  setLastSale: (id) => set({ lastSaleId: id }),
}), { name: 'fpos-cart' }));
