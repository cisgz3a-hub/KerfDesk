import { readReceiptNotices } from './import-receipt';
import { store } from './store';

/**
 * Shows the warnings and errors a write's receipt carries, which the PC showed only on its own
 * screen: the machine an Undo or Redo brought back (ADR-584 Amendment 1), or characters a text's
 * font has no glyph for (ADR-591 Amendment 1).
 */
export function toastReceiptWarnings(result: Record<string, unknown> | null, ms: number): void {
  if (result === null) return;
  for (const notice of readReceiptNotices(result)) {
    if (notice.level === 'success' || notice.level === 'info') continue;
    store.toast(notice.message, notice.level, ms);
  }
}
