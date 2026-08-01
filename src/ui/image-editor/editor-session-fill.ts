// Fill-family session ops (ADR-246, V2 plan B1): paint bucket and gradient.
// Bucket composes existing primitives — wand-flood sampled on the COMPOSITE
// (what the operator sees; the transparent-active-layer lesson), filled on
// the active layer. Both commit exactly one scoped history entry.

import { pushHistoryEntry, type PaintColor, type PaintPoint } from '../../core/image-edit';
import { fillGradientInPlace, type GradientSpec } from '../../core/image-retouch';
import { fillMaskedInPlace, maskBounds, wandSelection } from '../../core/image-select';
import { captureScoped, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

type BucketOptions = {
  readonly tolerance: number;
  readonly contiguous: boolean;
};

/** Flood-fill the clicked region of the VISIBLE image onto the active layer. */
export function commitBucketFill(
  session: EditorSession,
  x: number,
  y: number,
  color: PaintColor,
  options: BucketOptions,
): EditorSession {
  const region = wandSelection(compositeSession(session), x, y, options);
  const bounds = maskBounds(region);
  if (bounds === null) return session;
  const entry = captureScoped(session, bounds, 'Paint bucket');
  fillMaskedInPlace(session.doc, region, color);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: bounds,
  };
}

/** Fill the selection (or everything) with the dragged fg→bg gradient. */
export function commitGradient(
  session: EditorSession,
  spec: GradientSpec,
  foreground: PaintColor,
  background: PaintColor,
): EditorSession {
  const full = { x: 0, y: 0, width: session.doc.width, height: session.doc.height };
  const bounds = session.selection === null ? full : (maskBounds(session.selection) ?? full);
  const entry = captureScoped(session, bounds, 'Gradient');
  fillGradientInPlace(session.doc, spec, foreground, background, session.selection ?? undefined);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: bounds,
  };
}

/** Pointer-completion entry: bucket click at a document point. */
export function applyBucketAt(x: number, y: number): void {
  const store = useImageEditorStore.getState();
  if (store.session === null) return;
  useImageEditorStore.setState({
    session: commitBucketFill(store.session, x, y, store.foreground, {
      tolerance: store.wandTolerance,
      contiguous: store.wandContiguous,
    }),
  });
}

/** Pointer-completion entry: gradient drag finished. */
export function applyGradientDrag(
  from: PaintPoint,
  to: PaintPoint,
  shape: GradientSpec['shape'],
): void {
  const store = useImageEditorStore.getState();
  if (store.session === null) return;
  useImageEditorStore.setState({
    session: commitGradient(store.session, { from, to, shape }, store.foreground, store.background),
  });
}
