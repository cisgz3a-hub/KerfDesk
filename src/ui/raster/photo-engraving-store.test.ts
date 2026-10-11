import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { useStore, type AppState } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  openPhotoEngraving,
  photoEngravingSessionIsCurrent,
  usePhotoEngravingStore,
  type PhotoEngravingSession,
} from './photo-engraving-store';

function setup(imagePatch: Partial<RasterImage> = {}, objects: readonly SceneObject[] = []) {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AID/',
    pixelWidth: 3,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    operationIds: ['image'],
    ...imagePatch,
  };
  const operation = createLayer({ id: 'image', color: '#808080', mode: 'image' });
  const project = {
    ...createProject(),
    scene: { objects: [image, ...objects], layers: [operation] },
  };
  useStore.setState({ project, selectedObjectId: image.id, projectDocumentEpoch: 12 });
  return { image, operation, project, state: useStore.getState() };
}

function currentSession(): PhotoEngravingSession {
  const session = usePhotoEngravingStore.getState().session;
  if (session === null) throw new Error('Expected photo session');
  return session;
}

function withScene(
  state: AppState,
  objects: readonly SceneObject[],
  layers?: readonly Layer[],
): AppState {
  return {
    ...state,
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects, layers: layers ?? state.project.scene.layers },
    },
  };
}

describe('photo engraving sessions', () => {
  beforeEach(() => {
    resetStore();
    usePhotoEngravingStore.setState({ session: null });
  });

  afterEach(() => {
    for (const toast of useToastStore.getState().toasts)
      useToastStore.getState().dismissToast(toast.id);
  });

  it('opens one ordinary selected photo with exact source, operation and document ownership', () => {
    const { image, operation, project, state } = setup();
    openPhotoEngraving();
    const session = currentSession();

    expect(session.image).toBe(image);
    expect(session.operation).toBe(operation);
    expect(session.device).toBe(project.device);
    expect(session.sceneObjects).toBe(project.scene.objects);
    expect(session.projectDocumentEpoch).toBe(12);
    expect(photoEngravingSessionIsCurrent(state, session)).toBe(true);
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('does not allow an old close callback or copied owner to close a new same-id session', () => {
    const { image, operation, state } = setup();
    openPhotoEngraving();
    const first = currentSession();
    const replacement = { ...image, brightness: 7 };
    useStore.setState(withScene(state, [replacement], [operation]));
    openPhotoEngraving();
    const second = currentSession();
    expect(second).not.toBe(first);
    expect(second.image.id).toBe(first.image.id);
    expect(second.sessionId).not.toBe(first.sessionId);

    usePhotoEngravingStore.getState().close(first);
    expect(currentSession()).toBe(second);
    usePhotoEngravingStore.getState().close({ ...second });
    expect(currentSession()).toBe(second);
    usePhotoEngravingStore.getState().close(second);
    expect(usePhotoEngravingStore.getState().session).toBeNull();
    expect(useStore.getState().project.scene.objects[0]).toBe(replacement);
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('targets the enabled operation when the primary operation has output turned off', () => {
    const { image, operation, state } = setup({ operationIds: ['image', 'visible'] });
    const hidden = { ...operation, visible: false, output: false };
    const visible = createLayer({ id: 'visible', color: '#ff0000', mode: 'image' });
    const next = withScene(state, [image], [hidden, visible]);
    useStore.setState(next);
    openPhotoEngraving();

    const session = currentSession();
    expect(session.operation).toBe(visible);
    expect(photoEngravingSessionIsCurrent(next, session)).toBe(true);
    expect(useStore.getState().project.scene.layers[0]).toBe(hidden);
    expect(hidden).toMatchObject({ visible: false, output: false });
  });

  it('keeps a hidden operation as the target when its output is enabled', () => {
    const { image, operation, state } = setup({ operationIds: ['image', 'visible'] });
    const hidden = { ...operation, visible: false, output: true };
    const visible = createLayer({ id: 'visible', color: '#ff0000', mode: 'image' });
    const next = withScene(state, [image], [hidden, visible]);
    useStore.setState(next);
    openPhotoEngraving();

    expect(currentSession().operation).toBe(hidden);
    expect(photoEngravingSessionIsCurrent(next, currentSession())).toBe(true);
  });

  it('keeps the primary operation available for preparation when every bound output is off', () => {
    const { image, operation, state } = setup({ operationIds: ['image', 'other'] });
    const primary = { ...operation, output: false };
    const other = { ...createLayer({ id: 'other', color: '#ff0000' }), output: false };
    const next = withScene(state, [image], [primary, other]);
    useStore.setState(next);
    openPhotoEngraving();

    expect(currentSession().operation).toBe(primary);
    expect(photoEngravingSessionIsCurrent(next, currentSession())).toBe(true);
    expect(useStore.getState().project.scene.layers).toEqual([primary, other]);
    expect(primary.output).toBe(false);
    expect(other.output).toBe(false);
  });

  it.each([
    'locked',
    'trace-source',
    'multi-selection',
    'deselected',
    'vector',
    'cnc',
    'unbound',
  ] as const)('does not open an unavailable %s selection', (kind) => {
    const { image, state } = setup();
    if (kind === 'locked') useStore.setState(withScene(state, [{ ...image, locked: true }]));
    if (kind === 'trace-source')
      useStore.setState(withScene(state, [{ ...image, role: 'trace-source' }]));
    if (kind === 'multi-selection')
      useStore.setState({ additionalSelectedIds: new Set(['another']) });
    if (kind === 'deselected') useStore.setState({ selectedObjectId: null });
    if (kind === 'vector') useStore.setState(withScene(state, [svgObj(image.id, ['#808080'])]));
    if (kind === 'cnc')
      useStore.setState({ project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    if (kind === 'unbound')
      useStore.setState(withScene(state, [{ ...image, operationIds: ['missing'] }]));
    const before = useStore.getState();

    openPhotoEngraving();
    expect(usePhotoEngravingStore.getState().session).toBeNull();
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });

  it.each(['image', 'operation', 'device', 'document', 'cnc', 'selection'] as const)(
    'makes a captured session stale when its %s changes, including same-id replacements',
    (kind) => {
      const { image, operation, state } = setup();
      openPhotoEngraving();
      const session = currentSession();
      let next = state;
      if (kind === 'image') next = withScene(state, [{ ...image }]);
      if (kind === 'operation') next = withScene(state, [image], [{ ...operation }]);
      if (kind === 'device')
        next = { ...state, project: { ...state.project, device: { ...state.project.device } } };
      if (kind === 'document') next = { ...state, projectDocumentEpoch: 13 };
      if (kind === 'cnc')
        next = { ...state, project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG } };
      if (kind === 'selection') next = { ...state, additionalSelectedIds: new Set(['other']) };
      expect(photoEngravingSessionIsCurrent(next, session)).toBe(false);
      expect(usePhotoEngravingStore.getState().session).toBe(session);
    },
  );

  it('binds the actual external mask and detects edited or removed same-id masks', () => {
    const mask = svgObj('mask', ['#000000']);
    const { image, state } = setup({ imageMaskId: mask.id }, [mask]);
    openPhotoEngraving();
    const session = currentSession();
    expect(photoEngravingSessionIsCurrent(state, session)).toBe(true);
    expect(photoEngravingSessionIsCurrent(withScene(state, [image, { ...mask }]), session)).toBe(
      false,
    );
    expect(photoEngravingSessionIsCurrent(withScene(state, [image]), session)).toBe(false);
  });

  it('detects an absent external mask becoming present after the dialog opens', () => {
    const { image, state } = setup({ imageMaskId: 'mask' });
    openPhotoEngraving();
    const session = currentSession();
    expect(photoEngravingSessionIsCurrent(state, session)).toBe(true);
    const next = withScene(state, [image, svgObj('mask', ['#000000'])]);
    expect(photoEngravingSessionIsCurrent(next, session)).toBe(false);
  });

  it.each([false, true])(
    'keeps unrelated document edits current when mask present is %s',
    (hasMask) => {
      const mask = svgObj('mask', ['#000000']);
      const sibling = svgObj('sibling', ['#000000']);
      const { image, state } = setup(hasMask ? { imageMaskId: mask.id } : {}, [mask, sibling]);
      openPhotoEngraving();
      const session = currentSession();
      const changedSibling = { ...sibling, transform: { ...sibling.transform, x: 10 } };
      const next = withScene(state, [image, mask, changedSibling]);
      expect(next.project).not.toBe(state.project);
      expect(photoEngravingSessionIsCurrent(next, session)).toBe(true);
      if (!hasMask)
        expect(photoEngravingSessionIsCurrent(withScene(state, [image]), session)).toBe(true);
    },
  );
});
