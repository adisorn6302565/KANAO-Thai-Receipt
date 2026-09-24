import QRCode from 'qrcode';
import { bahtText } from './bahttext.ts';
import { computeTotals, type Item, type VatMode } from './calc.ts';
import { buildPayload, detectTarget } from './promptpay.ts';
import './style.css';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as unknown as T;

const DOC_TITLES: Record<string, string> = {
  receipt: 'ใบเสร็จรับเงิน',
  taxinvoice: 'ใบกำกับภาษี / ใบเสร็จรับเงิน',
  invoice: 'ใบแจ้งหนี้',
  quotation: 'ใบเสนอราคา',
};
const DOC_PREFIX: Record<string, string> = { receipt: 'RE', taxinvoice: 'TI', invoice: 'IV', quotation: 'QT' };

const SELLER_FIELDS = ['sName', 'sAddr', 'sTax', 'sBranch', 'sPhone', 'sPromptPay'] as const;
const DOC_FIELDS = ['docType', 'docNo', 'docDate', 'copyMark', 'cName', 'cAddr', 'cTax', 'cBranch',
  'discount', 'vatMode', 'wht', 'payBy', 'note'] as const;

const KEY_SELLER = 'kanao-receipt-seller';
const KEY_HISTORY = 'kanao-receipt-history';
const KEY_COUNTER = 'kanao-receipt-counter';
const KEY_DRAFT = 'kanao-receipt-draft';

interface Doc {
  fields: Record<string, string>;
  seller: Record<string, string>;
  items: Item[];
  savedAt?: string;
}

let items: Item[] = [{ desc: '', qty: 1, price: 0 }];

// ---------- storage (every access guarded: private mode / blocked storage) ----------
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ---------- helpers ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => {
  const n = Number(String(s).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const val = (id: string) => ($(id) as HTMLInputElement).value;

function thaiDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTaxId(s: string): string {
  const d = s.replace(/\D/g, '');
  return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : s;
}

function nextDocNo(type: string): string {
  const counters = load<Record<string, number>>(KEY_COUNTER, {});
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const k = `${type}-${ym}`;
  return `${DOC_PREFIX[type] ?? 'DOC'}${ym}-${String((counters[k] ?? 0) + 1).padStart(4, '0')}`;
}
function bumpCounter(type: string, docNo: string) {
  const counters = load<Record<string, number>>(KEY_COUNTER, {});
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const k = `${type}-${ym}`;
  const m = docNo.match(/-(\d+)$/);
  if (m) counters[k] = Math.max(counters[k] ?? 0, Number(m[1]));
  store(KEY_COUNTER, counters);
}

// ---------- items editor ----------
function renderItems() {
  const box = $<HTMLDivElement>('items');
  box.innerHTML = items
    .map((it, i) => `
      <div class="item" data-i="${i}">
        <input class="desc" placeholder="รายการ" value="${esc(it.desc)}" />
        <input class="qty" inputmode="decimal" placeholder="จำนวน" value="${it.qty}" />
        <input class="price" inputmode="decimal" placeholder="ราคา/หน่วย" value="${it.price || ''}" />
        <button type="button" class="del" title="ลบ" aria-label="ลบรายการ">×</button>
      </div>`)
    .join('');
}

$<HTMLDivElement>('items').addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  const row = input.closest<HTMLElement>('.item');
  if (!row) return;
  const it = items[Number(row.dataset.i)];
  if (input.classList.contains('desc')) it.desc = input.value;
  if (input.classList.contains('qty')) it.qty = num(input.value);
  if (input.classList.contains('price')) it.price = num(input.value);
  update();
});
$<HTMLDivElement>('items').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.del');
  if (!btn) return;
  items.splice(Number(btn.closest<HTMLElement>('.item')!.dataset.i), 1);
  if (!items.length) items.push({ desc: '', qty: 1, price: 0 });
  renderItems();
  update();
});
$('addItem').addEventListener('click', () => {
  items.push({ desc: '', qty: 1, price: 0 });
  renderItems();
  update();
  const rows = document.querySelectorAll<HTMLInputElement>('#items .desc');
  rows[rows.length - 1]?.focus();
});

// ---------- document state ----------
function collect(): Doc {
  const fields: Record<string, string> = {};
  for (const f of DOC_FIELDS) fields[f] = val(f);
  const seller: Record<string, string> = {};
  for (const f of SELLER_FIELDS) seller[f] = val(f);
  return { fields, seller, items: items.map((i) => ({ ...i })) };
}

function apply(doc: Doc) {
  for (const [k, v] of Object.entries(doc.fields)) if ($(k)) ($(k) as HTMLInputElement).value = v;
  for (const [k, v] of Object.entries(doc.seller ?? {})) if ($(k)) ($(k) as HTMLInputElement).value = v;
  items = doc.items?.length ? doc.items.map((i) => ({ ...i })) : [{ desc: '', qty: 1, price: 0 }];
  renderItems();
  update();
}

function freshDoc() {
  for (const f of DOC_FIELDS) ($(f) as HTMLInputElement).value = '';
  $<HTMLSelectElement>('docType').value = 'receipt';
  $<HTMLSelectElement>('vatMode').value = 'none';
  $<HTMLSelectElement>('wht').value = '0';
  $('docDate').value = new Date().toISOString().slice(0, 10);
  $('docNo').value = nextDocNo('receipt');
  items = [{ desc: '', qty: 1, price: 0 }];
  renderItems();
  update();
}

// ---------- preview ----------
let qrSeq = 0;
async function update() {
  const d = collect();
  const f = d.fields;
  const s = d.seller;
  const t = computeTotals(d.items, num(f.discount), f.vatMode as VatMode, num(f.wht));
  const isTax = f.docType === 'taxinvoice';
  const lines = d.items.filter((i) => i.desc.trim() || i.price);

  const party = (name: string, addr: string, tax: string, branch: string, extra = '') => `
    <div class="pname">${esc(name) || '<span class="ph">—</span>'}</div>
    ${addr ? `<div class="paddr">${esc(addr).replace(/\n/g, '<br>')}</div>` : ''}
    ${tax ? `<div>เลขประจำตัวผู้เสียภาษี ${esc(formatTaxId(tax))}${branch ? ` · ${esc(branch)}` : ''}</div>` : ''}
    ${extra}`;

  const rows = lines.map((it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.desc)}</td>
        <td class="r">${it.qty.toLocaleString('th-TH')}</td>
        <td class="r">${money(it.price)}</td>
        <td class="r">${money(it.qty * it.price)}</td>
      </tr>`).join('');

  const sum: [string, number, string?][] = [['รวมเป็นเงิน', t.subtotal]];
  if (t.discount) sum.push(['ส่วนลด', -t.discount]);
  if (f.vatMode !== 'none') {
    sum.push(['มูลค่าก่อนภาษี', t.base], ['ภาษีมูลค่าเพิ่ม 7%', t.vat]);
  }
  sum.push(['จำนวนเงินรวมทั้งสิ้น', t.total, 'grand']);
  if (t.wht) sum.push([`หัก ณ ที่จ่าย ${f.wht}%`, -t.wht], ['ยอดชำระสุทธิ', t.net, 'grand']);

  const pp = s.sPromptPay.replace(/\D/g, '');
  const showQr = !!detectTarget(pp) && t.net > 0 && f.docType !== 'quotation';

  $<HTMLElement>('paper').innerHTML = `
    <div class="p-head">
      <div class="seller">${party(s.sName, s.sAddr, s.sTax, s.sBranch, s.sPhone ? `<div>โทร ${esc(s.sPhone)}</div>` : '')}</div>
      <div class="doc">
        <div class="title">${DOC_TITLES[f.docType] ?? ''}</div>
        ${f.copyMark ? `<div class="copy">${esc(f.copyMark)}</div>` : ''}
        <table class="meta">
          <tr><th>เลขที่</th><td>${esc(f.docNo)}</td></tr>
          <tr><th>วันที่</th><td>${thaiDate(f.docDate)}</td></tr>
        </table>
      </div>
    </div>
    <div class="customer">
      <div class="label">${f.docType === 'quotation' ? 'เสนอราคาถึง' : 'ลูกค้า'}</div>
      ${party(f.cName, f.cAddr, f.cTax, f.cBranch)}
    </div>
    <table class="lines">
      <thead><tr><th class="c">#</th><th>รายการ</th><th class="r">จำนวน</th><th class="r">ราคา/หน่วย</th><th class="r">จำนวนเงิน</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="ph c">ยังไม่มีรายการ</td></tr>'}</tbody>
    </table>
    <div class="p-foot">
      <div class="left">
        <div class="words">(${bahtText(t.total)})</div>
        ${f.payBy ? `<div>ชำระโดย: ${esc(f.payBy)}</div>` : ''}
        ${f.note ? `<div class="note">หมายเหตุ: ${esc(f.note).replace(/\n/g, '<br>')}</div>` : ''}
        ${showQr ? `<div class="qr"><canvas id="qrCanvas"></canvas><div>สแกนจ่ายพร้อมเพย์<br><b>${money(t.net)} บาท</b></div></div>` : ''}
      </div>
      <table class="sum">
        ${sum.map(([k, v, cls]) => `<tr class="${cls ?? ''}"><th>${k}</th><td>${money(v)}</td></tr>`).join('')}
      </table>
    </div>
    <div class="sign">
      <div><div class="line"></div>${f.docType === 'quotation' ? 'ผู้เสนอราคา' : 'ผู้รับเงิน'}</div>
      <div><div class="line"></div>${f.docType === 'quotation' ? 'ผู้อนุมัติ' : 'ผู้จ่ายเงิน'}</div>
    </div>
    ${isTax && !s.sTax ? '<div class="warn no-print">ใบกำกับภาษีต้องมีเลขผู้เสียภาษีของผู้ขาย</div>' : ''}
  `;

  if (showQr) {
    const seq = ++qrSeq;
    const canvas = document.getElementById('qrCanvas') as HTMLCanvasElement | null;
    if (canvas) {
      try {
        await QRCode.toCanvas(canvas, buildPayload(pp, t.net), { width: 110, margin: 1 });
      } catch { /* invalid target */ }
      if (seq !== qrSeq) return;
    }
  }

  const seller: Record<string, string> = {};
  for (const k of SELLER_FIELDS) seller[k] = s[k];
  store(KEY_SELLER, seller);
  store(KEY_DRAFT, d);
}

// ---------- history ----------
function history(): Doc[] {
  return load<Doc[]>(KEY_HISTORY, []);
}
function renderHistory() {
  const list = history();
  $<HTMLUListElement>('history').innerHTML = list.length
    ? list.map((d, i) => {
      const t = computeTotals(d.items, num(d.fields.discount), d.fields.vatMode as VatMode, num(d.fields.wht));
      return `<li data-i="${i}">
          <button type="button" class="open">${esc(d.fields.docNo)} · ${esc(d.fields.cName || '-')} · ${money(t.net)}</button>
          <button type="button" class="rm" title="ลบ" aria-label="ลบ">×</button>
        </li>`;
    }).join('')
    : '<li class="muted">ยังไม่มี</li>';
}
$<HTMLUListElement>('history').addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const li = el.closest<HTMLElement>('li[data-i]');
  if (!li) return;
  const i = Number(li.dataset.i);
  const list = history();
  if (el.classList.contains('rm')) {
    if (!confirm(`ลบ ${list[i].fields.docNo} ออกจากประวัติ?`)) return;
    list.splice(i, 1);
    store(KEY_HISTORY, list);
    renderHistory();
  } else if (el.classList.contains('open')) {
    apply(list[i]);
  }
});

function saveToHistory() {
  const d = collect();
  const list = history().filter((x) => x.fields.docNo !== d.fields.docNo);
  list.unshift({ ...d, savedAt: new Date().toISOString() });
  store(KEY_HISTORY, list.slice(0, 200));
  bumpCounter(d.fields.docType, d.fields.docNo);
  renderHistory();
}

$('saveDoc').addEventListener('click', (e) => {
  saveToHistory();
  const b = e.currentTarget as HTMLButtonElement;
  b.textContent = 'เก็บแล้ว';
  setTimeout(() => (b.textContent = 'เก็บเข้าประวัติ'), 1200);
});
$('print').addEventListener('click', () => {
  saveToHistory();
  const old = document.title;
  document.title = `${val('docNo')} ${val('cName')}`.trim(); // default PDF file name
  window.print();
  document.title = old;
});
$('clearItems').addEventListener('click', () => {
  if (items.some((i) => i.desc.trim() || i.price) && !confirm('ล้างรายการทั้งหมด?')) return;
  items = [{ desc: '', qty: 1, price: 0 }];
  renderItems();
  update();
  document.querySelector<HTMLInputElement>('#items .desc')?.focus();
});
$('clearSeller').addEventListener('click', () => {
  if (!confirm('ล้างข้อมูลร้านที่จำไว้?')) return;
  for (const f of SELLER_FIELDS) $(f).value = '';
  update();
});
// clicking a filled text field selects it, so typing replaces the old value
$<HTMLElement>('items').parentElement!.closest('aside')!.addEventListener('focusin', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.tagName === 'INPUT' && (el.type === 'text' || el.inputMode === 'decimal' || el.inputMode === 'numeric')) el.select();
});
$('newDoc').addEventListener('click', () => {
  if (confirm('เริ่มเอกสารใหม่? (ข้อมูลผู้ขายยังอยู่)')) freshDoc();
});

$('exportJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ seller: load(KEY_SELLER, {}), history: history() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kanao-receipt-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('importJson').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.history)) throw new Error();
    const merged = [...data.history, ...history()].filter(
      (d, i, arr) => arr.findIndex((x) => x.fields.docNo === d.fields.docNo) === i,
    );
    store(KEY_HISTORY, merged.slice(0, 500));
    renderHistory();
    alert(`นำเข้า ${data.history.length} เอกสาร`);
  } catch {
    alert('ไฟล์ไม่ถูกต้อง');
  }
  (e.target as HTMLInputElement).value = '';
});

// changing type gives the next number for that type (only if the number was auto-generated)
$<HTMLSelectElement>('docType').addEventListener('change', () => {
  const no = val('docNo');
  if (!no || /^(RE|TI|IV|QT|DOC)\d{6}-\d{4}$/.test(no)) $('docNo').value = nextDocNo(val('docType'));
  update();
});

for (const id of [...DOC_FIELDS, ...SELLER_FIELDS]) {
  $(id).addEventListener('input', update);
  $(id).addEventListener('change', update);
}

// ---------- start ----------
const seller = load<Record<string, string>>(KEY_SELLER, {});
for (const [k, v] of Object.entries(seller)) if ($(k)) $(k).value = v;
const draft = load<Doc | null>(KEY_DRAFT, null);
if (draft?.fields) apply({ ...draft, seller: { ...draft.seller, ...seller } });
else freshDoc();
renderHistory();
