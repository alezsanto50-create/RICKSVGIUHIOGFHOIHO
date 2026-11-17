export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function getTodayBR(): string {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function getNowTimeBR(): string {
  const now = new Date();
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

export function addDaysISO(dateISO: string, delta: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function formatDateBR(dateISO: string): string {
  if (!dateISO || !dateISO.includes('-')) return dateISO || '';
  const [y, m, d] = dateISO.split('-');
  return `${d}/${m}/${y}`;
}

export function formatShortDateBR(dateISO: string): string {
  if (!dateISO || !dateISO.includes('-')) return dateISO || '';
  const [, m, d] = dateISO.split('-');
  return `${d}/${m}`;
}

export function getWeekdayShortBR(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const label = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(dt);
  return label.replace('.', '').slice(0, 3);
}

export function getMonthLabelBR(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 15));
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(dt);
  return label.replace('.', '');
}

export function calcDeltaPercent(current: number, previous: number): number | null {
  if (previous === 0) {
    return current > 0 ? 100 : null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function sanitizeDecimalInput(raw: string): string {
  return raw.replace(/[^\d.,-]/g, '');
}

export function parseCurrencyInput(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  const cleaned = String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/R\$/gi, '');
  if (!cleaned) return NaN;

  // Handle Brazilian thousands + decimal format like 1.250,50 vs 1,250.50 vs 35,50 vs 35.50
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  let normalized = cleaned;
  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      // pt-BR: 1.500,50 -> 1500.50
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // en-US: 1,500.50 -> 1500.50
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only comma(s): 35,50 -> 35.50
    normalized = cleaned.replace(',', '.');
  } else if (hasDot) {
    // Check if dot is thousands separator like 1.500 (3 digits after dot) when multiple dots or exact 3 trailing digits
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      normalized = cleaned.replace(/\./g, '');
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}
