import { controller } from './controller';
import { readReceiptNotices } from './import-receipt';
import { store } from './store';

/** A machine change is several sentences, read before the next Frame. */
const HISTORY_NOTICE_MS = 15_000;

/**
 * Undo or Redo on the PC's shared history. A step that changed the machine setup, such as Keep
 * current machine for an opened file, comes back with a notice naming the machine Frame and Start
 * now use (ADR-584 Amendment 1). The PC's own notice is on the PC, so the phone shows this one.
 */
export async function undoOrRedo(command: 'undo' | 'redo'): Promise<void> {
  const result = await controller.write(command);
  if (result === null) return;
  for (const notice of readReceiptNotices(result)) {
    if (notice.level === 'success' || notice.level === 'info') continue;
    store.toast(notice.message, notice.level, HISTORY_NOTICE_MS);
  }
}
