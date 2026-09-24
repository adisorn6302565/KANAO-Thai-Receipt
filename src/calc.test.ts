import { computeTotals } from './calc.ts';

let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`}`);
}
const items = [{ desc: 'a', qty: 2, price: 500 }, { desc: 'b', qty: 1, price: 70 }];
eq('no vat', computeTotals(items, 0, 'none', 0), { subtotal: 1070, discount: 0, base: 1070, vat: 0, total: 1070, wht: 0, net: 1070 });
eq('vat exclusive', computeTotals(items, 70, 'exclusive', 0), { subtotal: 1070, discount: 70, base: 1000, vat: 70, total: 1070, wht: 0, net: 1070 });
eq('vat inclusive', computeTotals(items, 0, 'inclusive', 0), { subtotal: 1070, discount: 0, base: 1000, vat: 70, total: 1070, wht: 0, net: 1070 });
eq('wht 3% on base', computeTotals(items, 70, 'exclusive', 3), { subtotal: 1070, discount: 70, base: 1000, vat: 70, total: 1070, wht: 30, net: 1040 });
eq('discount capped', computeTotals(items, 5000, 'none', 0).total, 0);
process.exit(fail ? 1 : 0);
