// Builds the barcode object from the dialog's result and commits it (ADR-386).
// Human-readable text is outlined with the bundled font through the same
// renderer as variable text, so what is inserted is what output engraves.

import {
  BARCODE_SYMBOLOGY_LABELS,
  createBarcodeObject,
  type BarcodeObject,
  type BarcodeShape,
} from '../../core/barcode';
import type { ShapeObject } from '../../core/scene';
import { barcodeCaptionRenderer } from '../../io/gcode/materialize-variable-barcode';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { useStore, type AppState } from '../state';
import { applyInsertBarcode, applyReplaceBarcode } from '../state/barcode-insert-mutation';
import { commitProjectEditNow } from '../state/project-edit-commit';
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
  return commitCreatedBarcode(
    args.editing,
    created.object,
    BARCODE_SYMBOLOGY_LABELS[args.spec.symbology],
  );
}

// A barcode bound to a V-carve, relief or adaptive operation is Pro artwork:
// without Pro, changing its modules asks first (ADR-592).
function commitCreatedBarcode(
  editing: BarcodeObject | undefined,
  object: ShapeObject,
  label: string,
): BarcodeCommit {
  if (editing === undefined) {
    if (!commitProjectEditNow((current) => applyInsertBarcode(current, object))) return NEEDS_PRO;
    return { ok: true, message: `Inserted ${label} on a new Fill operation.` };
  }
  let missing = false;
  const committed = commitProjectEditNow((current) => {
    const replaced = applyReplaceBarcode(current, object);
    missing = replaced === null;
    return replaced ?? {};
  });
  if (missing) {
    return { ok: false, message: 'The barcode was deleted or locked while you edited it.' };
  }
  if (!committed) return NEEDS_PRO;
  return { ok: true, message: `Updated ${label}.` };
}

const NEEDS_PRO: BarcodeCommit = {
  ok: false,
  message: 'This barcode is Pro work. Unlock KerfDesk Pro, then apply it again.',
};

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
