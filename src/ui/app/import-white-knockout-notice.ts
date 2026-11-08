// The import notice for a logo's white parts (ADR-686). Solid white shapes
// beside a darker fill are left unburned, as the file shows bare material
// there, which changes what the operations hold; white the file paints
// see-through, shaded or masked burns, and the notice says so (Amendment 1).
// The operator must hear about it and how to get the white shapes back.
// Toasts carry no action button, so the notice points at Undo, which
// applyImportWhiteKnockout records as its own step. A remote `apply_edits`
// batch is one Undo step (ADR-584), so its notice says so.

import type { WhiteKnockout } from '../../core/geometry/white-fill-knockout';
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
  const sentences = knockout.whiteShapes > 0 ? [paperSentence(knockout), UNDO_SENTENCE[undo]] : [];
  if (knockout.inkWhites > 0) sentences.push(inkSentence(knockout.inkWhites));
  return {
    message: `${filename}: ${sentences.join(' ')}`,
    variant: knockout.whiteShapes > 0 ? 'warning' : 'info',
  };
}

// Only flat, opaque white is left out, and only it shows bare material in the
// file; a white background painted first cut nothing (ADR-686 Amendment 1).
function paperSentence(knockout: WhiteKnockout): string {
  const one = knockout.whiteShapes === 1;
  const shapes = one ? '1 solid white shape' : `${knockout.whiteShapes} solid white shapes`;
  const cut =
    knockout.knockedShapes === 0
      ? ''
      : `, so ${one ? 'it was' : 'they were'} cut out of the shapes under ${one ? 'it' : 'them'}`;
  return `${shapes} will not burn: the file shows bare material there${cut}.`;
}

function inkSentence(count: number): string {
  const one = count === 1;
  return (
    `${one ? '1 white shape is' : `${count} white shapes are`} see-through, shaded or masked ` +
    `in the file, so ${one ? 'it burns' : 'they burn'} like any colour. To leave ` +
    `${one ? 'it' : 'them'} unburned, turn ${one ? 'its' : 'their'} operation's Output off.`
  );
}

const UNDO_SENTENCE: Record<ImportBedFitUndo, string> = {
  'own-step': 'To burn the white too, Undo: it returns on its own operation.',
  'remote-batch': 'Undo reverts the whole batch of remote edits.',
};
