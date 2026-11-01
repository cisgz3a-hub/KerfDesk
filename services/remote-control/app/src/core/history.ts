import { controller } from './controller';
import { toastReceiptWarnings } from './receipt-warnings';

/** A machine change is several sentences, read before the next Frame. */
const HISTORY_NOTICE_MS = 15_000;

/**
 * Undo or Redo on the PC's shared history. A step that changed the machine setup, such as Keep
 * current machine for an opened file, comes back with a notice naming the machine Frame and Start
 * now use (ADR-584 Amendment 1). The PC's own notice is on the PC, so the phone shows this one.
 */
export async function undoOrRedo(command: 'undo' | 'redo'): Promise<void> {
  toastReceiptWarnings(await controller.write(command), HISTORY_NOTICE_MS);
}
