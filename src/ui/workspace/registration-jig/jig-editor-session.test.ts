import { beforeEach, describe, expect, it } from 'vitest';
import {
  addObject,
  findRegistrationBoxBounds,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  updateLayer,
  type Layer,
  type Project,
  type TextObject,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { useStore, type AppState } from '../../state/store';
import { resetStore } from '../../state/test-helpers';
import {
  centerJigArtwork,
  changeJigDraft,
  commitJigEditorSession,
  createJigEditorSession,
  jigDraftDirty,
  jigOutlinesLocked,
  removeJigLayout,
  replaceJigLayout,
  selectJigObjects,
  undoJigDraft,
  unlockJigOutlines,
  type JigEditorSession,
} from './jig-editor-session';
import { importJigArtwork, nudgeJigSelection } from './jig-editor-artwork';

const GRID = {
  outline: { kind: 'rectangle' as const, widthMm: 50, heightMm: 30 },
  rows: 2,
  columns: 3,
  spacingX: 5,
  spacingY: 5,
};

function square(id: string, color: string, x = 5, y = 5) {
  return createRectangle({
    id,
    color,
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
  });
}

function addArtwork(id: string, color: string): void {
  useStore.getState().drawShape(square(id, color));
}

/** Artwork in the middle of the bed, where the first jig outline is centred. */
function addArtworkOnOutline(id: string, color: string): void {
  const { bedWidth, bedHeight } = useStore.getState().project.device;
  useStore.getState().drawShape(square(id, color, bedWidth / 2 - 5, bedHeight / 2 - 5));
}

function artworkOperation(id: string): string {
  const { scene } = useStore.getState().project;
  const object = scene.objects.find((candidate) => candidate.id === id);
  const operation = object && primaryOperationForObject(object, scene.layers);
  if (!operation) throw new Error(`Missing artwork operation: ${id}`);
  return operation.id;
}

function outputs(project: Project): Record<string, boolean> {
  return Object.fromEntries(project.scene.layers.map((layer) => [layer.id, layer.output]));
}

function commit(state: AppState, session: JigEditorSession): AppState {
  const result = commitJigEditorSession(state, session);
  if (result.kind === 'refused')
    throw new Error(`Expected a valid editor commit: ${result.reason}`);
  return { ...state, ...result.change };
}

/** Save the first jig to the main canvas and leave it in the store. */
function saveFirstJig(): AppState {
  const initial = useStore.getState();
  useStore.setState(commit(initial, createJigEditorSession(initial)));
  return useStore.getState();
}

/** A change made on the main canvas, outside the editor's draft. */
function moveInMain(id: string, dx: number): void {
  const { project } = useStore.getState();
  const objects = project.scene.objects.map((object) =>
    object.id === id
      ? { ...object, transform: { ...object.transform, x: object.transform.x + dx } }
      : object,
  );
  useStore.setState({ project: { ...project, scene: { ...project.scene, objects } } });
}

/** Serial-number text on an artwork operation: variable data that advances. */
function addSerialText(operationId: string): void {
  const { project } = useStore.getState();
  const text: TextObject = {
    kind: 'text',
    id: 'serial-text',
    content: '001',
    fontKey: 'roboto-regular',
    sizeMm: 5,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: operation(project, operationId)!.color,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    paths: [],
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 30 },
    operationIds: [operationId],
    variableTemplate: { tokens: [{ kind: 'serial', prefix: '', width: 3 }] },
  };
  useStore.setState({ project: { ...project, scene: addObject(project.scene, text) } });
}

function objectX(project: Project, id: string): number | undefined {
  return project.scene.objects.find((object) => object.id === id)?.transform.x;
}

function operation(project: Project, id: string): Layer | undefined {
  return project.scene.layers.find((layer) => layer.id === id);
}

describe('registration jig editor session', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ registrationArtworkOutputSnapshot: null });
    addArtworkOnOutline('enabled-art', '#0000ff');
    addArtwork('disabled-art', '#00aa00');
    useStore.getState().setLayerParam(artworkOperation('disabled-art'), { output: false });
  });

  it('keeps creation, layout changes and artwork copies isolated from the main project', () => {
    const state = useStore.getState();
    const before = structuredClone(state.project);
    let session = createJigEditorSession(state);
    session = replaceJigLayout(session, GRID);
    session = importJigArtwork(session, square('jig-art', '#ff00ff'));
    session = selectJigObjects(session, new Set(['jig-art']));
    session = centerJigArtwork(session);

    expect(findRegistrationBoxes(session.draft.project.scene)).toHaveLength(6);
    expect(session.draft.project.scene.objects.length).toBeGreaterThan(before.scene.objects.length);
    expect(useStore.getState().project).toBe(state.project);
    expect(state.project).toEqual(before);
    expect(findRegistrationBoxes(state.project.scene)).toHaveLength(0);
    expect(useStore.getState().undoStack).toBe(state.undoStack);
  });

  it('opens on a clean canvas: no main-canvas selection and its artwork out of reach', () => {
    useStore.getState().selectObject('enabled-art');
    const session = createJigEditorSession(useStore.getState());

    // Only the new jig's own first outline may be selected, never main-canvas artwork.
    const [created] = findRegistrationBoxes(session.draft.project.scene);
    expect(session.draft.selectedObjectId).toBe(created!.id);
    expect(session.draft.additionalSelectedIds.size).toBe(0);
    // No jig yet, so all main-canvas artwork is background, even on the new outline.
    expect([...session.background].sort()).toEqual(['disabled-art', 'enabled-art']);
    expect(selectJigObjects(session, new Set(['enabled-art'])).draft.selectedObjectId).toBeNull();
    const picked = selectJigObjects(session, new Set(['disabled-art', created!.id]));
    expect(picked.draft.selectedObjectId).toBe(created!.id);
    expect(picked.draft.additionalSelectedIds.size).toBe(0);
  });

  it('reopens a saved jig with its own artwork and leaves the rest in the background', () => {
    saveFirstJig();
    // The main canvas's selection (which also scopes Selected artwork only output).
    useStore.getState().selectObject('disabled-art');
    const saved = useStore.getState();
    const session = createJigEditorSession(saved);

    expect([...session.background]).toEqual(['disabled-art']);
    // Saving keeps the background artwork exactly where it was.
    const moved = nudgeJigSelection(selectJigObjects(session, new Set(['enabled-art'])), 1, 0);
    const resaved = commit(saved, moved);
    expect(resaved.project.scene.objects.map((object) => object.id)).toEqual(
      saved.project.scene.objects.map((object) => object.id),
    );
    expect(resaved.project.scene.objects.find((object) => object.id === 'disabled-art')).toBe(
      saved.project.scene.objects.find((object) => object.id === 'disabled-art'),
    );
    // The editor's own selection stays in the editor; the main selection comes back.
    expect(resaved.selectedObjectId).toBe('disabled-art');
    expect(resaved.additionalSelectedIds.size).toBe(0);
  });

  it('saves the first layout as Outline only with one undo entry and restores artwork intent', () => {
    const state = useStore.getState();
    const enabledId = artworkOperation('enabled-art');
    const disabledId = artworkOperation('disabled-art');
    const session = replaceJigLayout(createJigEditorSession(state), GRID);
    const saved = commit(state, session);

    expect(outputs(saved.project)).toMatchObject({
      [REGISTRATION_LAYER_ID]: true,
      [enabledId]: false,
      [disabledId]: false,
    });
    expect(saved.undoStack).toEqual([...state.undoStack, state.project]);
    expect(saved.redoStack).toEqual([]);
    expect(saved.registrationArtworkOutputSnapshot).toMatchObject({
      [enabledId]: true,
      [disabledId]: false,
    });
    const artwork = applyRegistrationOutput(saved, 'artwork');
    expect(outputs(artwork.project)).toMatchObject({
      [REGISTRATION_LAYER_ID]: false,
      [enabledId]: true,
      [disabledId]: false,
    });
  });

  it('locks saved outlines on the main canvas and unlocks only the editor copy', () => {
    const state = useStore.getState();
    const saved = commit(state, replaceJigLayout(createJigEditorSession(state), GRID));
    const reopened = createJigEditorSession(saved);

    expect(findRegistrationBoxes(saved.project.scene).every((box) => box.locked)).toBe(true);
    expect(findRegistrationBoxes(reopened.draft.project.scene).every((box) => !box.locked)).toBe(
      true,
    );
    expect(findRegistrationBoxes(saved.project.scene).every((box) => box.locked)).toBe(true);
  });

  it('opens burned outlines locked and unlocks them only as an undoable edit', () => {
    const initial = useStore.getState();
    const saved = commit(initial, createJigEditorSession(initial));
    const artworkState = { ...saved, ...applyRegistrationOutput(saved, 'artwork') };
    const reopened = createJigEditorSession(artworkState);

    expect(jigOutlinesLocked(reopened.draft.project)).toBe(true);
    expect(jigDraftDirty(reopened)).toBe(false);
    const unlocked = unlockJigOutlines(reopened);
    expect(jigOutlinesLocked(unlocked.draft.project)).toBe(false);
    expect(jigDraftDirty(unlocked)).toBe(true);
    expect(unlockJigOutlines(unlocked)).toBe(unlocked);
    expect(jigOutlinesLocked(undoJigDraft(unlocked).draft.project)).toBe(true);
    expect(jigOutlinesLocked(createJigEditorSession(saved).draft.project)).toBe(false);
  });

  it('keeps a new jig centred on the bed when its grid grows', () => {
    const state = useStore.getState();
    const { bedWidth, bedHeight } = state.project.device;
    const session = replaceJigLayout(createJigEditorSession(state), { ...GRID, columns: 6 });
    const bounds = findRegistrationBoxBounds(session.draft.project.scene)!;

    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(bedWidth / 2);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(bedHeight / 2);
  });

  it('retains Artwork only when an existing jig is reopened and saved', () => {
    const initial = useStore.getState();
    const saved = commit(initial, createJigEditorSession(initial));
    const artworkState = { ...saved, ...applyRegistrationOutput(saved, 'artwork') };
    const reopened = createJigEditorSession(artworkState);
    const resaved = commit(artworkState, replaceJigLayout(reopened, GRID));

    expect(reopened.firstSave).toBe(false);
    expect(outputs(resaved.project)).toEqual(outputs(artworkState.project));
    expect(resaved.registrationArtworkOutputSnapshot).toBeNull();
  });

  it('preserves Outline only and its artwork snapshot when the layout is regenerated', () => {
    const initial = useStore.getState();
    const saved = commit(initial, createJigEditorSession(initial));
    const changed = replaceJigLayout(createJigEditorSession(saved), GRID);

    expect(outputs(changed.draft.project)).toEqual(outputs(saved.project));
    expect(changed.draft.registrationArtworkOutputSnapshot).toBe(
      saved.registrationArtworkOutputSnapshot,
    );
    const restored = applyRegistrationOutput({ ...changed.draft, undoStack: [] }, 'artwork');
    expect(outputs(restored.project)[artworkOperation('enabled-art')]).toBe(true);
    expect(outputs(restored.project)[artworkOperation('disabled-art')]).toBe(false);
  });

  it('keeps undo and redo inside the draft and drops redo history after a new edit', () => {
    const initial = createJigEditorSession(useStore.getState());
    const changed = replaceJigLayout(initial, GRID);
    const undone = undoJigDraft(changed);
    const redone = undoJigDraft(undone, true);

    expect(undone.draft).toBe(initial.draft);
    expect(redone.draft).toBe(changed.draft);
    expect(undoJigDraft(initial)).toBe(initial);
    const branched = replaceJigLayout(undone, { ...GRID, columns: 2 });
    expect(branched.future).toHaveLength(0);
    expect(undoJigDraft(branched, true)).toBe(branched);
  });

  it('restores enabled artwork before removing an outline-mode jig', () => {
    const initial = useStore.getState();
    const saved = commit(initial, createJigEditorSession(initial));
    const removed = removeJigLayout(createJigEditorSession(saved));

    expect(findRegistrationBoxes(removed.draft.project.scene)).toHaveLength(0);
    expect(removed.draft.registrationArtworkOutputSnapshot).toBeNull();
    expect(outputs(removed.draft.project)[artworkOperation('enabled-art')]).toBe(true);
    expect(outputs(removed.draft.project)[artworkOperation('disabled-art')]).toBe(false);
  });

  it('saves over an unchanged copy of the project but refuses a replaced document', () => {
    const state = useStore.getState();
    const session = replaceJigLayout(createJigEditorSession(state), GRID);

    const copied = commit({ ...state, project: { ...state.project } }, session);
    expect(findRegistrationBoxes(copied.project.scene)).toHaveLength(6);
    expect(
      commitJigEditorSession(
        { ...state, projectDocumentEpoch: state.projectDocumentEpoch + 1 },
        session,
      ),
    ).toEqual({ kind: 'refused', reason: 'new-document' });
  });

  it('carries an unrelated object added in the main project into the saved draft', () => {
    const saved = saveFirstJig();
    const session = replaceJigLayout(createJigEditorSession(saved), GRID);
    addArtwork('late-art', '#ff0000');
    const main = useStore.getState();
    const lateOperation = artworkOperation('late-art');
    const resaved = commit(main, session);

    expect(findRegistrationBoxes(resaved.project.scene)).toHaveLength(6);
    expect(resaved.project.scene.objects.map((object) => object.id)).toEqual(
      expect.arrayContaining(['enabled-art', 'disabled-art', 'late-art']),
    );
    expect(operation(resaved.project, lateOperation)).toBe(operation(main.project, lateOperation));
    expect(resaved.project.scene.artworkOrder).toEqual([
      ...(session.draft.project.scene.artworkOrder ?? []),
      'late-art',
    ]);
    expect(resaved.undoStack).toEqual([...main.undoStack, main.project]);
  });

  it('keeps the draft through a variable-text advance after a job', () => {
    useStore.getState().setVariableSettings({ advancement: 'after-successful-stream' });
    addSerialText(artworkOperation('enabled-art'));
    const saved = saveFirstJig();
    // The artwork run outputs the serial text, so its completion advances it.
    useStore.setState(applyRegistrationOutput(saved, 'artwork'));
    const running = useStore.getState();
    const opened = selectJigObjects(createJigEditorSession(running), new Set(['enabled-art']));
    const session = nudgeJigSelection(opened, 1, 0);
    useStore.getState().advanceVariablesAfter(running.project, 'successful-stream');
    const main = useStore.getState();
    const resaved = commit(main, session);

    expect(running.project.variables?.serialValue).toBe(1);
    expect(main.project.variables?.serialValue).toBe(2);
    expect(resaved.project.variables).toBe(main.project.variables);
    expect(objectX(resaved.project, 'enabled-art')).toBe(
      objectX(running.project, 'enabled-art')! + 1,
    );
    expect(outputs(resaved.project)).toEqual(outputs(running.project));
  });

  it('refuses when an outline moved in the main project while the editor was open', () => {
    const saved = saveFirstJig();
    const opened = selectJigObjects(createJigEditorSession(saved), new Set(['enabled-art']));
    const session = nudgeJigSelection(opened, 1, 0);
    const [outline] = findRegistrationBoxes(saved.project.scene);
    moveInMain(outline!.id, 5);

    expect(commitJigEditorSession(useStore.getState(), session)).toEqual({
      kind: 'refused',
      reason: 'outlines',
    });
  });

  it('refuses the same artwork edited in both, but merges edits to different artwork', () => {
    const saved = saveFirstJig();
    const opened = selectJigObjects(createJigEditorSession(saved), new Set(['enabled-art']));
    const session = nudgeJigSelection(opened, 1, 0);
    moveInMain('disabled-art', 5);
    const merged = commit(useStore.getState(), session);

    expect(objectX(merged.project, 'enabled-art')).toBe(objectX(saved.project, 'enabled-art')! + 1);
    expect(objectX(merged.project, 'disabled-art')).toBe(
      objectX(saved.project, 'disabled-art')! + 5,
    );
    moveInMain('enabled-art', 5);
    expect(commitJigEditorSession(useStore.getState(), session)).toEqual({
      kind: 'refused',
      reason: 'artwork',
    });
  });

  it('merges operation settings changed on different fields and refuses the same field', () => {
    const saved = saveFirstJig();
    const id = artworkOperation('enabled-art');
    const opened = createJigEditorSession(saved);
    const { project } = opened.draft;
    const session = changeJigDraft(opened, {
      project: { ...project, scene: updateLayer(project.scene, id, { speed: 1234 }) },
    });
    useStore.getState().setLayerParam(id, { passes: 3 });
    const merged = commit(useStore.getState(), session);

    expect(operation(merged.project, id)).toMatchObject({ speed: 1234, passes: 3 });
    const scene = updateLayer(saved.project.scene, id, { speed: 99 });
    expect(
      commitJigEditorSession({ ...saved, project: { ...saved.project, scene } }, session),
    ).toEqual({ kind: 'refused', reason: 'operations' });
  });

  it('keeps the draft when an outline run selects Artwork only while the editor is open', () => {
    const initial = useStore.getState();
    const saved = commit(initial, createJigEditorSession(initial));
    const session = replaceJigLayout(createJigEditorSession(saved), GRID);
    const switched = { ...saved, ...applyRegistrationOutput(saved, 'artwork') };
    const resaved = commit(switched, session);

    expect(findRegistrationBoxes(resaved.project.scene)).toHaveLength(6);
    expect(outputs(resaved.project)).toMatchObject({
      [REGISTRATION_LAYER_ID]: false,
      [artworkOperation('enabled-art')]: true,
      [artworkOperation('disabled-art')]: false,
    });
    expect(resaved.registrationArtworkOutputSnapshot).toBeNull();
    expect(resaved.undoStack).toEqual([...switched.undoStack, switched.project]);
  });

  it('refuses to replace a captured board and keeps its geometry and lock untouched', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const state = useStore.getState();
    const before = findRegistrationBoxes(state.project.scene);
    const session = createJigEditorSession(state);
    const changed = replaceJigLayout(session, GRID);

    expect(findRegistrationBoxes(session.draft.project.scene)).toEqual(before);
    expect(changed).toBe(session);
    expect(commitJigEditorSession(state, session)).toEqual({
      kind: 'refused',
      reason: 'captured-board',
    });
    expect(findRegistrationBoxes(state.project.scene)).toEqual(before);
  });
});
