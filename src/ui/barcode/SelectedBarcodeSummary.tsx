// SelectedBarcodeSummary — the artwork panel's barcode block (ADR-386): what
// the selected code encodes and how large it engraves, with the way back
// into the barcode dialog. Barcodes re-encode rather than resize by field,
// so the dialog, not inline fields, is where they change.

import type { CSSProperties } from 'react';
import { BARCODE_SYMBOLOGY_LABELS, isBarcodeObject } from '../../core/barcode';
import type { SceneObject } from '../../core/scene';
import { useBarcodeDialogStore } from './barcode-dialog-store';

export function SelectedBarcodeSummary(props: {
  readonly objects: ReadonlyArray<SceneObject>;
}): JSX.Element | null {
  const open = useBarcodeDialogStore((state) => state.open);
  const object = props.objects.length === 1 ? props.objects[0] : undefined;
  if (!isBarcodeObject(object)) return null;
  const { spec, bounds, transform } = object;
  const width = (bounds.maxX - bounds.minX) * Math.abs(transform.scaleX);
  const height = (bounds.maxY - bounds.minY) * Math.abs(transform.scaleY);
  const kind = spec.variableTemplate === undefined ? 'Data' : 'Variable data';
  return (
    <div style={containerStyle}>
      <p style={titleStyle}>
        {BARCODE_SYMBOLOGY_LABELS[spec.symbology]} · {mm(width)} × {mm(height)} mm
        {spec.invert ? ' · inverted' : ''}
      </p>
      <p style={dataStyle} title={spec.data}>
        {kind}: {spec.data}
      </p>
      <button
        type="button"
        className="lf-btn"
        title="Change the type, data, size or options of this barcode."
        onClick={() => open({ mode: 'edit', objectId: object.id })}
      >
        Edit barcode…
      </button>
    </div>
  );
}

function mm(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const containerStyle: CSSProperties = { display: 'grid', gap: 4, marginBottom: 8 };
const titleStyle: CSSProperties = { margin: 0, fontSize: 'var(--lf-text-xs)' };
const dataStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--lf-text-xs)',
  color: 'var(--lf-text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
