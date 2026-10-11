/**
 * Accepts either decimal separator ("0.5" or "0,5"). Commas are never thousands separators.
 * Mixed, repeated or grouped separators and non-finite values are refused (returns null).
 */
export function parseDecimal(raw: string, min = -Infinity, max = Infinity): number | null {
  const text = raw.trim();
  if (!/^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

export function formatMm(value: number | undefined, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toString();
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}
