// Builds the barcode object from the dialog's result and commits it (ADR-372).
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
import { useStore } from '../state';
import { applyInsertBarcode, applyReplaceBarcode } from '../state/barcode-insert-mutation';
import { renderVariableText } from '../text/render-variable-text';

// eslint-disable-next-line no-restricted-syntax -- scene DATA: the artwork color new barcodes carry, as drawn shapes do (ADR-047).
const BARCODE_COLOR = '#000000';

export type BarcodeCommit =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

/** Inserts a new barcode, or replaces `editing` in place. */
export async function commitBarcode(args: {
  readonly spec: BarcodeShape;
  readonly value: string;
  readonly editing?: BarcodeObject;
  readonly renderer?: VariableTextRenderer;
}): Promise<BarcodeCommit> {
  const color = args.editing?.color ?? BARCODE_COLOR;
  const created = await createBarcodeObject({
    id: args.editing?.id ?? crypto.randomUUID(),
    color,
    spec: args.spec,
    value: args.value,
    renderCaption: barcodeCaptionRenderer(
      args.renderer ?? renderVariableText,
      color,
      useStore.getState().project,
    ),
  });
  if (!created.ok) return created;
  const state = useStore.getState();
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
