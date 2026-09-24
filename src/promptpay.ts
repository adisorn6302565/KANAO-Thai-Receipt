// PromptPay payload (EMVCo merchant-presented QR, Thai QR Payment standard)

export type TargetType = 'phone' | 'id' | 'ewallet';

const AID = 'A000000677010111';

function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as 4 uppercase hex digits */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Detect target type from digits only: 10 = phone, 13 = national/tax ID, 15 = e-wallet */
export function detectTarget(raw: string): TargetType | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) return 'phone';
  if (d.length === 13) return 'id';
  if (d.length === 15) return 'ewallet';
  return null;
}

/** Thai national ID checksum (mod 11) */
export function isValidThaiId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

export function buildPayload(target: string, amount?: number): string {
  const digits = target.replace(/\D/g, '');
  const type = detectTarget(digits);
  if (!type) throw new Error('เบอร์โทร 10 หลัก, เลขบัตร/เลขผู้เสียภาษี 13 หลัก หรือ e-Wallet 15 หลัก');

  let account: string;
  if (type === 'phone') account = tlv('01', ('0066' + digits.slice(1)).padStart(13, '0'));
  else if (type === 'id') account = tlv('02', digits);
  else account = tlv('03', digits);

  const hasAmount = amount !== undefined && amount > 0;
  if (hasAmount && (!Number.isFinite(amount) || amount > 9_999_999_999.99)) throw new Error('จำนวนเงินไม่ถูกต้อง');

  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') + // 12 = one-time (amount set), 11 = reusable
    tlv('29', tlv('00', AID) + account) +
    tlv('53', '764') + // THB
    (hasAmount ? tlv('54', amount!.toFixed(2)) : '') +
    tlv('58', 'TH') +
    '6304';
  return payload + crc16(payload);
}
