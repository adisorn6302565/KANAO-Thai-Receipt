export type VatMode = 'none' | 'exclusive' | 'inclusive';

export interface Item {
  desc: string;
  qty: number;
  price: number;
}

export interface Totals {
  subtotal: number;   // sum of lines
  discount: number;
  base: number;       // before VAT
  vat: number;
  total: number;      // including VAT
  wht: number;        // withholding (on base)
  net: number;        // amount to pay
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeTotals(items: Item[], discount: number, vatMode: VatMode, whtRate: number): Totals {
  const subtotal = round2(items.reduce((s, it) => s + round2((it.qty || 0) * (it.price || 0)), 0));
  const disc = Math.min(Math.max(round2(discount || 0), 0), subtotal);
  const afterDiscount = round2(subtotal - disc);

  let base: number, vat: number, total: number;
  if (vatMode === 'exclusive') {
    base = afterDiscount;
    vat = round2(base * 0.07);
    total = round2(base + vat);
  } else if (vatMode === 'inclusive') {
    total = afterDiscount;
    base = round2((total * 100) / 107);
    vat = round2(total - base);
  } else {
    base = total = afterDiscount;
    vat = 0;
  }
  const wht = round2((base * (whtRate || 0)) / 100);
  return { subtotal, discount: disc, base, vat, total, wht, net: round2(total - wht) };
}
