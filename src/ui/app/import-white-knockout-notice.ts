// The import notice for a logo's white parts (ADR-686). White shapes over a
// darker fill are left unburned, as the file shows them, which changes what
// the operations hold; the operator must hear about it and how to get the
// white shapes back. Toasts carry no action button, so the notice points at
// Undo, which applyImportWhiteKnockout records as its own step. A remote
// `apply_edits` batch is one Undo step (ADR-584), so its notice says so.

import type { ImportOutcome } from '../state/store';
import type { ImportBedFitUndo } from './import-bed-fit-notice';
import type { ToastDescriptor } from './import-toasts';

export function describeImportWhiteKnockout(
  filename: string,
  outcome: ImportOutcome | undefined,
  undo: ImportBedFitUndo = 'own-step',
): ToastDescriptor | null {
  const knockout = outcome?.whiteKnockout;
  if (knockout === undefined) return null;
  const count = knockout.whiteShapes;
  const shapes = count === 1 ? '1 white shape' : `${count} white shapes`;
  return {
    message:
      `${filename}: ${shapes} will not burn, as in the file: ` +
      `${count === 1 ? 'it was' : 'they were'} cut out of the shapes under ${count === 1 ? 'it' : 'them'}. ` +
      UNDO_SENTENCE[undo],
    variant: 'warning',
  };
}

const UNDO_SENTENCE: Record<ImportBedFitUndo, string> = {
  'own-step': 'To burn the white too, Undo: it returns on its own operation.',
  'remote-batch': 'Undo reverts the whole batch of remote edits.',
};
