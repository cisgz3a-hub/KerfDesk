import type { RasterImage } from '../../core/scene';
import { useStore } from '../state';
import type { EditorSession } from './editor-session';

export type ImageEditorSessionOwner = {
  readonly projectDocumentEpoch: number;
  readonly sourceImage: RasterImage;
};

export type StashedEditorSession = {
  readonly session: EditorSession;
  /** Null exists only for directly injected test sessions; UI opens always own a source image. */
  readonly owner: ImageEditorSessionOwner | null;
};

export type EditorSessionStash = Readonly<Record<string, StashedEditorSession>>;

export type ImageEditorApplyRequest = {
  readonly requestToken: symbol;
  readonly session: EditorSession;
  readonly owner: ImageEditorSessionOwner | null;
};

export function ownerFor(sourceImage: RasterImage): ImageEditorSessionOwner {
  return { projectDocumentEpoch: useStore.getState().projectDocumentEpoch, sourceImage };
}

export function ownerIsCurrent(owner: ImageEditorSessionOwner): boolean {
  const state = useStore.getState();
  if (state.projectDocumentEpoch !== owner.projectDocumentEpoch) return false;
  return (
    state.project.scene.objects.find((object) => object.id === owner.sourceImage.id) ===
    owner.sourceImage
  );
}

export function ownerAfterApply(
  owner: ImageEditorSessionOwner,
  objectId: string,
): ImageEditorSessionOwner | null {
  const state = useStore.getState();
  if (state.projectDocumentEpoch !== owner.projectDocumentEpoch) return null;
  const sourceImage = state.project.scene.objects.find((object) => object.id === objectId);
  return sourceImage?.kind === 'raster-image'
    ? { projectDocumentEpoch: owner.projectDocumentEpoch, sourceImage }
    : null;
}

export function ownersMatch(a: ImageEditorSessionOwner, b: ImageEditorSessionOwner): boolean {
  return a.projectDocumentEpoch === b.projectDocumentEpoch && a.sourceImage === b.sourceImage;
}

/**
 * Whether a closed session may resume on `next` (ADR-311 Amendment 2, audit
 * 23-P2-3). A nudge, or a layer, power or dither change, makes a new image
 * object but keeps the file, pixels and size the session was opened from.
 * Apply writes only those fields, so the newer placement and settings survive
 * it. Exact owners still fence every asynchronous completion (ADR-311 §2);
 * this only decides a reopen.
 */
export function ownersShareSource(
  stashed: ImageEditorSessionOwner,
  next: ImageEditorSessionOwner,
): boolean {
  if (stashed.projectDocumentEpoch !== next.projectDocumentEpoch) return false;
  const before = stashed.sourceImage;
  const after = next.sourceImage;
  return before === after || (samePixels(before, after) && sameBounds(before, after));
}

function samePixels(before: RasterImage, after: RasterImage): boolean {
  return (
    before.id === after.id &&
    before.source === after.source &&
    before.dataUrl === after.dataUrl &&
    before.imageAsset === after.imageAsset &&
    before.editorDocument === after.editorDocument &&
    before.pixelWidth === after.pixelWidth &&
    before.pixelHeight === after.pixelHeight
  );
}

function sameBounds(before: RasterImage, after: RasterImage): boolean {
  return (
    before.bounds.minX === after.bounds.minX &&
    before.bounds.minY === after.bounds.minY &&
    before.bounds.maxX === after.bounds.maxX &&
    before.bounds.maxY === after.bounds.maxY
  );
}

export function nullableOwnersMatch(
  a: ImageEditorSessionOwner | null,
  b: ImageEditorSessionOwner | null,
): boolean {
  return a === null ? b === null : b !== null && ownersMatch(a, b);
}

export function applyRequestOwnsSession(
  request: ImageEditorApplyRequest | null,
  session: EditorSession | null,
  owner: ImageEditorSessionOwner | null,
): boolean {
  return (
    request !== null &&
    session !== null &&
    request.session === session &&
    nullableOwnersMatch(request.owner, owner)
  );
}

export function retainDocumentEpochStash(
  stash: EditorSessionStash,
  projectDocumentEpoch: number,
): EditorSessionStash {
  const retained = Object.entries(stash).filter(
    ([, entry]) =>
      entry.owner === null || entry.owner.projectDocumentEpoch === projectDocumentEpoch,
  );
  return retained.length === Object.keys(stash).length ? stash : Object.fromEntries(retained);
}

export function stashSession(
  stash: EditorSessionStash,
  staleObjectId: string,
  next: StashedEditorSession | null,
): EditorSessionStash {
  const { [staleObjectId]: _stale, ...remaining } = stash;
  return next === null ? remaining : { ...remaining, [next.session.objectId]: next };
}

export function reconcileAppliedStash(
  stash: EditorSessionStash,
  startingSession: EditorSession,
  startingOwner: ImageEditorSessionOwner | null,
  replacementOwner: ImageEditorSessionOwner | null,
): EditorSessionStash {
  const stashed = stash[startingSession.objectId];
  if (stashed === undefined) return stash;
  const ownerMatches = nullableOwnersMatch(stashed.owner, startingOwner);
  if (stashed.session === startingSession) {
    return {
      ...stash,
      [startingSession.objectId]: {
        session: { ...stashed.session, dirtySinceApply: false },
        owner: ownerMatches ? replacementOwner : stashed.owner,
      },
    };
  }
  return ownerMatches
    ? { ...stash, [startingSession.objectId]: { ...stashed, owner: replacementOwner } }
    : stash;
}
