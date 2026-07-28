import {
  blitTransformedInPlace,
  IDENTITY_AFFINE,
  pushHistoryEntry,
  transformedBounds,
  type AffineTransform,
  type PixelRect,
} from '../../core/image-edit';
import { extractFloatingRegion, selectAllMask, type SelectionMask } from '../../core/image-select';
import { clearEditorLayerInPlace } from './editor-layer-clear';
import { captureScoped, type EditorSession } from './editor-session';

/** Floating pixels, selection ownership, and affine draft for one Ctrl+T edit. */
export type EditorTransformSession = {
  readonly floating: NonNullable<ReturnType<typeof extractFloatingRegion>>;
  readonly mask: SelectionMask;
  readonly affine: AffineTransform;
  readonly sourceObjectId: string;
  readonly sourceLayerId: string;
  readonly sourceRevision: number;
  readonly sourceDocument: EditorSession['doc'];
};

/** Lift the explicit selection, or the whole active layer, without mutating it. */
export function startEditorTransform(session: EditorSession): EditorTransformSession | null {
  const mask = session.selection ?? selectAllMask(session.doc.width, session.doc.height);
  const floating = extractFloatingRegion(session.doc, mask);
  return floating === null
    ? null
    : {
        floating,
        mask,
        affine: IDENTITY_AFFINE,
        sourceObjectId: session.objectId,
        sourceLayerId: session.activeLayerId,
        sourceRevision: session.revision,
        sourceDocument: session.doc,
      };
}

/** Commit one affine edit as one layer-scoped history entry. */
export function commitEditorTransform(
  session: EditorSession,
  transform: EditorTransformSession,
): EditorSession {
  if (!isTransformOwnedBySession(session, transform)) return session;
  if (isIdentityAffine(transform.affine)) return session;
  const target = transformedBounds(transform.floating, transform.affine);
  const union = unionRects(transform.floating.rect, target);
  const entry = captureScoped(session, union, 'Free transform');
  clearEditorLayerInPlace(session.doc, session.activeLayerId, transform.mask);
  blitTransformedInPlace(session.doc, transform.floating, transform.affine);
  return {
    ...session,
    history: pushHistoryEntry(session.history, entry),
    selection: null,
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: union,
  };
}

function isTransformOwnedBySession(
  session: EditorSession,
  transform: EditorTransformSession,
): boolean {
  return (
    transform.sourceObjectId === session.objectId &&
    transform.sourceLayerId === session.activeLayerId &&
    transform.sourceRevision === session.revision &&
    transform.sourceDocument === session.doc
  );
}

function isIdentityAffine(affine: AffineTransform): boolean {
  return (
    affine.translateX === 0 &&
    affine.translateY === 0 &&
    affine.scaleX === 1 &&
    affine.scaleY === 1 &&
    affine.rotateDeg === 0
  );
}

function unionRects(first: PixelRect, second: PixelRect): PixelRect {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  };
}
