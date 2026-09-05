import type { RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { appliedBounds, createSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';
import type { ImageEditorState, Setter } from './image-editor-store';
import {
  type ImageEditorApplyRequest,
  type ImageEditorSessionOwner,
  type StashedEditorSession,
  applyRequestOwnsSession,
  nullableOwnersMatch,
  ownerAfterApply,
  ownerFor,
  ownerIsCurrent,
  ownersMatch,
  reconcileAppliedStash,
  retainDocumentEpochStash,
  stashSession,
} from './image-editor-ownership';

/**
 * Close the current editor session and retain it for an explicit reopen.
 * Session-scoped crop and transform drafts never cross the close boundary.
 */
export function closeEditorAction(set: Setter, get: () => ImageEditorState): void {
  const { applyRequest, session, sessionOwner } = get();
  const projectDocumentEpoch = useStore.getState().projectDocumentEpoch;
  const shouldRetainSession =
    session !== null && (sessionOwner === null || ownerIsCurrent(sessionOwner));
  const shouldRetainApply =
    shouldRetainSession && applyRequestOwnsSession(applyRequest, session, sessionOwner);
  set((state) => ({
    session: null,
    sessionOwner: null,
    loadState: { kind: 'idle' },
    view: null,
    isSpacePanning: false,
    pendingCrop: null,
    transform: null,
    isApplying: false,
    applyRequest: shouldRetainApply ? state.applyRequest : null,
    stash:
      session === null || !shouldRetainSession
        ? retainDocumentEpochStash(state.stash, projectDocumentEpoch)
        : stashSession(
            retainDocumentEpochStash(state.stash, projectDocumentEpoch),
            session.objectId,
            {
              session,
              owner: sessionOwner,
            },
          ),
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
  const owner = ownerFor(image);
  const { loadState, session, sessionOwner } = get();
  const stash = retainDocumentEpochStash(get().stash, owner.projectDocumentEpoch);
  if (stash !== get().stash) set({ stash });
  if (
    session !== null &&
    session.objectId === image.id &&
    (sessionOwner === null || ownersMatch(sessionOwner, owner))
  ) {
    return;
  }
  if (
    loadState.kind === 'loading' &&
    loadState.objectId === image.id &&
    ownersMatch(loadState.owner, owner)
  ) {
    return;
  }
  const stashed = stash[image.id];
  if (stashed !== undefined && (stashed.owner === null || ownersMatch(stashed.owner, owner))) {
    resumeStashedSession(set, image.id, stashed, owner, session, sessionOwner);
    return;
  }

  const requestToken = Symbol(image.id);
  set((state) => ({
    session: null,
    sessionOwner: null,
    stash: stashSession(
      state.stash,
      image.id,
      session === null || session.objectId === image.id ? null : { session, owner: sessionOwner },
    ),
    loadState: { kind: 'loading', objectId: image.id, requestToken, owner },
    pendingCrop: null,
    transform: null,
    isApplying: false,
    applyRequest: null,
  }));
  decodeRasterToBuffer(image)
    .then((doc) => {
      if (!isCurrentOpenRequest(get(), image.id, requestToken)) return;
      if (!ownerIsCurrent(owner)) {
        set({ loadState: { kind: 'idle' } });
        return;
      }
      set({
        session: createSession(image.id, image.source, doc, image.bounds),
        sessionOwner: owner,
        loadState: { kind: 'idle' },
        pendingCrop: null,
        transform: null,
      });
    })
    .catch((err: unknown) => {
      if (!isCurrentOpenRequest(get(), image.id, requestToken)) return;
      if (!ownerIsCurrent(owner)) {
        set({ loadState: { kind: 'idle' } });
        return;
      }
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
  const { session, sessionOwner, isApplying } = get();
  if (session === null || isApplying) return Promise.resolve(null);
  if (sessionOwner !== null && !ownerIsCurrent(sessionOwner)) return Promise.resolve(null);
  // dirtySinceApply, not undo depth: crop clears tile history but still needs
  // applying (found by the 2026-07-21 interactive self-test).
  if (!session.dirtySinceApply) return Promise.resolve(session.objectId);

  const request: ImageEditorApplyRequest = {
    requestToken: Symbol(session.objectId),
    session,
    owner: sessionOwner,
  };
  set({ isApplying: true, applyRequest: request });
  const objectId = session.objectId;
  // ADR-245: Apply bakes the layer composite, never the active layer alone.
  return bakeBufferToBitmapFields(compositeSession(session))
    .then((fields) => {
      if (!applyRequestIsCurrent(get(), request)) return null;
      if (sessionOwner !== null && !ownerIsCurrent(sessionOwner)) {
        releaseApplyRequest(set, request);
        return null;
      }
      // A prior Apply may already have cropped the scene object. Revert must
      // explicitly restore the as-opened extent instead of omitting bounds.
      const bounds = appliedBounds(session) ?? session.sourceBounds;
      useStore.getState().applyEditedImage(objectId, {
        ...fields,
        pixelWidth: session.doc.width,
        pixelHeight: session.doc.height,
        bounds,
      });
      const replacementOwner =
        sessionOwner === null ? null : ownerAfterApply(sessionOwner, objectId);
      reconcileAppliedSession(set, request, replacementOwner);
      useToastStore.getState().pushToast('Image edits applied.', 'success');
      return objectId;
    })
    .catch((err: unknown) => {
      if (!applyRequestIsCurrent(get(), request)) return null;
      if (sessionOwner !== null && !ownerIsCurrent(sessionOwner)) {
        releaseApplyRequest(set, request);
        return null;
      }
      const message = err instanceof Error ? err.message : String(err);
      releaseApplyRequest(set, request);
      useToastStore.getState().pushToast(`Could not apply image edits: ${message}`, 'error');
      return null;
    });
}

function applyRequestIsCurrent(state: ImageEditorState, request: ImageEditorApplyRequest): boolean {
  return state.applyRequest?.requestToken === request.requestToken;
}

function releaseApplyRequest(set: Setter, request: ImageEditorApplyRequest): void {
  set((state) =>
    applyRequestIsCurrent(state, request) ? { applyRequest: null, isApplying: false } : {},
  );
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

function reconcileAppliedSession(
  set: Setter,
  request: ImageEditorApplyRequest,
  replacementOwner: ImageEditorSessionOwner | null,
): void {
  set((state) => {
    if (!applyRequestIsCurrent(state, request)) return {};
    const { session: startingSession, owner: startingOwner } = request;
    const currentMatches = state.session === startingSession;
    const currentOwnerMatches =
      state.session?.objectId === startingSession.objectId &&
      nullableOwnersMatch(state.sessionOwner, startingOwner);
    return {
      isApplying: false,
      applyRequest: null,
      session:
        currentMatches && state.session !== null
          ? { ...state.session, dirtySinceApply: false }
          : state.session,
      sessionOwner: currentOwnerMatches ? replacementOwner : state.sessionOwner,
      stash: reconcileAppliedStash(state.stash, startingSession, startingOwner, replacementOwner),
    };
  });
}

function resumeStashedSession(
  set: Setter,
  objectId: string,
  stashed: StashedEditorSession,
  owner: ImageEditorSessionOwner,
  currentSession: ImageEditorState['session'],
  currentOwner: ImageEditorSessionOwner | null,
): void {
  set((state) => {
    const { [objectId]: _resumed, ...remainingStash } = state.stash;
    const resumedOwner = stashed.owner ?? owner;
    const isResumingApply = applyRequestOwnsSession(
      state.applyRequest,
      stashed.session,
      resumedOwner,
    );
    return {
      session: stashed.session,
      sessionOwner: resumedOwner,
      stash:
        currentSession === null || currentSession.objectId === objectId
          ? remainingStash
          : stashSession(remainingStash, currentSession.objectId, {
              session: currentSession,
              owner: currentOwner,
            }),
      loadState: { kind: 'idle' },
      pendingCrop: null,
      transform: null,
      isApplying: isResumingApply,
      applyRequest: isResumingApply ? state.applyRequest : null,
    };
  });
}
