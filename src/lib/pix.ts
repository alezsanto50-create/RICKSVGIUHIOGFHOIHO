import QRCode from 'qrcode';

function sanitizeAscii(text: string, maxLen: number): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maxLen);
}

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16CCITT(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface PixPayloadParams {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amount?: number;
  txid?: string;
}

export function buildPixBrCode(params: PixPayloadParams): string {
  const key = params.pixKey.trim();
  const name = sanitizeAscii(params.merchantName || 'BARBEARIA TRINDADE', 25) || 'BARBEARIA TRINDADE';
  const city = sanitizeAscii(params.merchantCity || 'SAO PAULO', 15) || 'SAO PAULO';
  const txid = (params.txid || 'TRINDADE').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || '***';

  const merchantAccountInfo = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', key);

  let payload = '';
  payload += tlv('00', '01'); // Payload Format Indicator
  payload += tlv('26', merchantAccountInfo); // Merchant Account Information
  payload += tlv('52', '0000'); // Merchant Category Code
  payload += tlv('53', '986'); // Currency BRL

  if (params.amount && params.amount > 0) {
    payload += tlv('54', params.amount.toFixed(2));
  }

  payload += tlv('58', 'BR');
  payload += tlv('59', name);
  payload += tlv('60', city);
  payload += tlv('62', tlv('05', txid));
  payload += '6304';

  const crc = crc16CCITT(payload);
  return payload + crc;
}

export async function generatePixQrDataUrl(brCode: string): Promise<string> {
  return QRCode.toDataURL(brCode, {
    width: 320,
    margin: 2,
    color: {
      dark: '#09090B',
      light: '#FFFFFF',
    },
  });
}

export function formatWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
