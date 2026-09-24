// Amount in words, Thai style: 1250.50 -> "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์"

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** 0 < n < 1,000,000 */
function sixDigits(n: number): string {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const place = s.length - 1 - i;
    if (d === 0) continue;
    if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else if (place === 0 && d === 1 && s.length > 1) out += 'เอ็ด'; // 11, 101, 1001 ...
    else out += DIGITS[d] + PLACES[place];
  }
  return out;
}

/** Whole number in words, any size (groups of 6 digits joined with ล้าน) */
export function numberText(n: number): string {
  if (n === 0) return DIGITS[0];
  const s = String(n);
  const groups: number[] = [];
  for (let end = s.length; end > 0; end -= 6) groups.unshift(Number(s.slice(Math.max(0, end - 6), end)));
  let out = '';
  groups.forEach((g, i) => {
    if (g > 0) {
      // a lone 1 after ล้าน is still เอ็ด (1,000,001 = หนึ่งล้านเอ็ด)
      out += g === 1 && out ? 'เอ็ด' : sixDigits(g);
    }
    if (i < groups.length - 1) out += 'ล้าน';
  });
  return out;
}

export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const negative = amount < 0;
  const satangTotal = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;

  let out = '';
  if (baht > 0) out += numberText(baht) + 'บาท';
  if (satang === 0) out += baht > 0 ? 'ถ้วน' : 'ศูนย์บาทถ้วน';
  else out += numberText(satang) + 'สตางค์';
  return (negative ? 'ลบ' : '') + out;
}
