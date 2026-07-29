import type { RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { appliedBounds, createSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';
import type { ImageEditorState, Setter } from './image-editor-store';

/**
 * Close the current editor session and retain it for an explicit reopen.
 * Session-scoped crop and transform drafts never cross the close boundary.
 */
export function closeEditorAction(set: Setter, get: () => ImageEditorState): void {
  const { session } = get();
  set((state) => ({
    session: null,
    loadState: { kind: 'idle' },
    view: null,
    isSpacePanning: false,
    pendingCrop: null,
    transform: null,
    stash: session === null ? state.stash : { ...state.stash, [session.objectId]: session },
  }));
}

/**
 * Open an image in a request-owned editor session.
 * A superseded decode may neither install a session nor publish an error.
 */
export function openEditorAction(
  set: Setter,
  get: () => ImageEditorState,
  image: RasterImage,
): void {
  const { stash, session } = get();
  if (session !== null && session.objectId === image.id) return;
  const stashed = stash[image.id];
  if (stashed !== undefined) {
    set((state) => {
      const { [image.id]: _resumed, ...remainingStash } = state.stash;
      return {
        session: stashed,
        stash:
          session === null ? remainingStash : { ...remainingStash, [session.objectId]: session },
        loadState: { kind: 'idle' },
        pendingCrop: null,
        transform: null,
      };
    });
    return;
  }

  const requestToken = Symbol(image.id);
  set((state) => ({
    session: null,
    stash: session === null ? state.stash : { ...state.stash, [session.objectId]: session },
    loadState: { kind: 'loading', objectId: image.id, requestToken },
    pendingCrop: null,
    transform: null,
  }));
  decodeRasterToBuffer(image)
    .then((doc) => {
      if (!isCurrentOpenRequest(get(), image.id, requestToken)) return;
      set({
        session: createSession(image.id, image.source, doc, image.bounds),
        loadState: { kind: 'idle' },
        pendingCrop: null,
        transform: null,
      });
    })
    .catch((err: unknown) => {
      if (!isCurrentOpenRequest(get(), image.id, requestToken)) return;
      const message = err instanceof Error ? err.message : String(err);
      set({ loadState: { kind: 'failed', message } });
      useToastStore.getState().pushToast(`Could not open image for editing: ${message}`, 'error');
    });
}

/** Apply the current editor revision to its scene object. */
export function applyAction(set: Setter, get: () => ImageEditorState): void {
  void runApply(set, get);
}

/**
 * Apply the current revision, then trace only when that same session still owns
 * the intent after the asynchronous bake completes.
 */
export function applyAndTraceAction(
  set: Setter,
  get: () => ImageEditorState,
  onApplied: (objectId: string) => void,
): void {
  const startingSession = get().session;
  if (startingSession === null) return;
  void runApply(set, get).then((objectId) => {
    if (objectId === null) return;
    const currentSession = get().session;
    if (
      currentSession?.objectId !== startingSession.objectId ||
      currentSession.revision !== startingSession.revision
    ) {
      return;
    }
    closeEditorAction(set, get);
    onApplied(objectId);
  });
}

function runApply(set: Setter, get: () => ImageEditorState): Promise<string | null> {
  const { session, isApplying } = get();
  if (session === null || isApplying) return Promise.resolve(null);
  // dirtySinceApply, not undo depth: crop clears tile history but still needs
  // applying (found by the 2026-07-21 interactive self-test).
  if (!session.dirtySinceApply) return Promise.resolve(session.objectId);

  set({ isApplying: true });
  const objectId = session.objectId;
  const revision = session.revision;
  // ADR-245: Apply bakes the layer composite, never the active layer alone.
  return bakeBufferToBitmapFields(compositeSession(session))
    .then((fields) => {
      const bounds = appliedBounds(session);
      useStore.getState().applyEditedImage(objectId, {
        ...fields,
        ...(bounds === null
          ? {}
          : { pixelWidth: session.doc.width, pixelHeight: session.doc.height, bounds }),
      });
      reconcileAppliedSession(set, objectId, revision);
      useToastStore.getState().pushToast('Image edits applied.', 'success');
      return objectId;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      set({ isApplying: false });
      useToastStore.getState().pushToast(`Could not apply image edits: ${message}`, 'error');
      return null;
    });
}

function isCurrentOpenRequest(
  state: ImageEditorState,
  objectId: string,
  requestToken: symbol,
): boolean {
  return (
    state.loadState.kind === 'loading' &&
    state.loadState.objectId === objectId &&
    state.loadState.requestToken === requestToken
  );
}

function reconcileAppliedSession(set: Setter, objectId: string, revision: number): void {
  set((state) => {
    const currentMatches =
      state.session?.objectId === objectId && state.session.revision === revision;
    const stashed = state.stash[objectId];
    const stashMatches = stashed !== undefined && stashed.revision === revision;
    return {
      isApplying: false,
      session:
        currentMatches && state.session !== null
          ? { ...state.session, dirtySinceApply: false }
          : state.session,
      stash: stashMatches
        ? { ...state.stash, [objectId]: { ...stashed, dirtySinceApply: false } }
        : state.stash,
    };
  });
}
