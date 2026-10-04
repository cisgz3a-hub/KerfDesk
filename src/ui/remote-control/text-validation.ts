import { finite, identifier, record } from './validation';

/** Text values are data, including quotes or prompt-like content; only bounds are validated. */
export function validTextPatch(value: unknown): boolean {
  if (!record(value) || Object.keys(value).length === 0) return false;
  return Object.entries(value).every(([key, field]) => {
    switch (key) {
      case 'text':
        return typeof field === 'string' && field.length > 0 && field.length <= 4096;
      case 'fontId':
        return identifier(field);
      case 'fontSizeMm':
        return finite(field, Number.MIN_VALUE, 1000);
      case 'alignment':
        return field === 'left' || field === 'center' || field === 'right';
      case 'lineHeight':
        return finite(field, 0.1, 20);
      case 'letterSpacing':
        return finite(field, -1, 20);
      default:
        return false;
    }
  });
}
