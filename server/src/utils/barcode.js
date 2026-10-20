function ean13CheckDigit(d12) {
  const digits = String(d12).split('').map(Number);
  const s = digits.reduce((a, d, i) => a + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (s % 10)) % 10;
}

function isValidEAN13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

const isValidCode128 = (code) => typeof code === 'string' && code.length >= 1 && code.length <= 48 && /^[\x20-\x7E]+$/.test(code);

function validateBarcode(code, format) {
  if (!code) return 'Barcode is required';
  if (format === 'EAN13') {
    if (!/^\d{13}$/.test(code)) return 'EAN-13 barcode must be exactly 13 digits';
    if (!isValidEAN13(code)) return `Invalid EAN-13 check digit (expected ${ean13CheckDigit(code.slice(0, 12))})`;
    return null;
  }
  if (!isValidCode128(code)) return 'Code128 barcode must be 1-48 printable ASCII characters';
  return null;
}

/** Builds a barcode value from a sequence number according to barcode settings. */
function buildBarcode(seq, settings = {}) {
  const format = settings.defaultFormat || 'EAN13';
  if (format === 'EAN13') {
    const prefix = String(settings.ean13Prefix || '890123').replace(/\D/g, '').slice(0, 11);
    const body = prefix + String(seq).padStart(12 - prefix.length, '0');
    if (body.length !== 12) throw new Error('EAN-13 sequence exhausted for this prefix; change the barcode prefix in settings');
    return { code: body + ean13CheckDigit(body), format };
  }
  const prefix = settings.code128Prefix || 'FS';
  return { code: `${prefix}${String(seq).padStart(8, '0')}`, format };
}

/** Detects the format of a manually entered barcode. Any 13-digit number is treated as EAN-13 so a typo fails the check digit. */
const detectFormat = (code) => (/^\d{13}$/.test(String(code)) ? 'EAN13' : 'CODE128');

module.exports = { ean13CheckDigit, isValidEAN13, isValidCode128, validateBarcode, buildBarcode, detectFormat };
