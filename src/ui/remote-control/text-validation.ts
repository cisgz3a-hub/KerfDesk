import {
  TEXT_LETTER_SPACING_MAX,
  TEXT_LETTER_SPACING_MIN,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
  TEXT_SIZE_MAX_MM,
  TEXT_SIZE_MIN_MM,
} from '../../core/text/text-limits';
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
        return finite(field, TEXT_SIZE_MIN_MM, TEXT_SIZE_MAX_MM);
      case 'alignment':
        return field === 'left' || field === 'center' || field === 'right';
      case 'lineHeight':
        return finite(field, TEXT_LINE_HEIGHT_MIN, TEXT_LINE_HEIGHT_MAX);
      case 'letterSpacing':
        return finite(field, TEXT_LETTER_SPACING_MIN, TEXT_LETTER_SPACING_MAX);
      default:
        return false;
    }
  });
}
