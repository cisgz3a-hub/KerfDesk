// Builds the barcode object from the dialog's result and commits it (ADR-386).
// Human-readable text is outlined with the bundled font through the same
// renderer as variable text, so what is inserted is what output engraves.

import {
  BARCODE_SYMBOLOGY_LABELS,
  createBarcodeObject,
  type BarcodeObject,
  type BarcodeShape,
} from '../../core/barcode';
import { barcodeCaptionRenderer } from '../../io/gcode/materialize-variable-barcode';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { useStore, type AppState } from '../state';
import { applyInsertBarcode, applyReplaceBarcode } from '../state/barcode-insert-mutation';
import { renderVariableText } from '../text/render-variable-text';

// eslint-disable-next-line no-restricted-syntax -- scene DATA: the artwork color new barcodes carry, as drawn shapes do (ADR-047).
const BARCODE_COLOR = '#000000';

export type BarcodeCommit =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

type BarcodeCommitOwner = {
  readonly editing?: BarcodeObject;
  /** The dialog still owns this asynchronous request and remains mounted. */
  readonly isCurrent?: () => boolean;
};

/** Inserts a new barcode, or replaces `editing` in place. */
export async function commitBarcode(
  args: BarcodeCommitOwner & {
    readonly spec: BarcodeShape;
    readonly value: string;
    readonly renderer?: VariableTextRenderer;
  },
): Promise<BarcodeCommit> {
  const before = useStore.getState();
  if (args.isCurrent?.() === false) {
    return { ok: false, message: 'This barcode request is no longer current.' };
  }
  const color = args.editing?.color ?? BARCODE_COLOR;
  const created = await createBarcodeObject({
    id: args.editing?.id ?? crypto.randomUUID(),
    color,
    spec: args.spec,
    value: args.value,
    renderCaption: barcodeCaptionRenderer(
      args.renderer ?? renderVariableText,
      color,
      before.project,
    ),
  });
  const state = useStore.getState();
  const stale = staleBarcodeRequest(args, state, before.projectDocumentEpoch);
  if (stale !== null) return { ok: false, message: stale };
  if (!created.ok) return created;
  const label = BARCODE_SYMBOLOGY_LABELS[args.spec.symbology];
  if (args.editing === undefined) {
    useStore.setState(applyInsertBarcode(state, created.object));
    return { ok: true, message: `Inserted ${label} on a new Fill operation.` };
  }
  const replaced = applyReplaceBarcode(state, created.object);
  if (replaced === null) {
    return { ok: false, message: 'The barcode was deleted or locked while you edited it.' };
  }
  useStore.setState(replaced);
  return { ok: true, message: `Updated ${label}.` };
}

function staleBarcodeRequest(
  owner: BarcodeCommitOwner,
  state: Pick<AppState, 'project' | 'projectDocumentEpoch'>,
  documentEpoch: number,
): string | null {
  if (owner.isCurrent?.() === false || state.projectDocumentEpoch !== documentEpoch) {
    return 'This barcode request is no longer current.';
  }
  const editing = owner.editing;
  if (
    editing !== undefined &&
    state.project.scene.objects.find((object) => object.id === editing.id) !== editing
  ) {
    return 'The barcode changed while you edited it. Open it again to edit.';
  }
  return null;
}
