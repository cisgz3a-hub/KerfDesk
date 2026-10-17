import { beforeEach, describe, expect, it } from 'vitest';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  type Project,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { useStore, type AppState } from '../../state/store';
import { resetStore } from '../../state/test-helpers';
import {
  centerJigArtwork,
  commitJigEditorSession,
  createJigEditorSession,
  removeJigLayout,
  replaceJigLayout,
  selectJigObjects,
  undoJigDraft,
  type JigEditorSession,
} from './jig-editor-session';

const GRID = {
  outline: { kind: 'rectangle' as const, widthMm: 50, heightMm: 30 },
  rows: 2,
  columns: 3,
  spacingX: 5,
  spacingY: 5,
};

function addArtwork(id: string, color: string): void {
  useStore.getState().drawShape(
    createRectangle({
      id,
      color,
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    }),
  );
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
  const patch = commitJigEditorSession(state, session);
  if (patch === null) throw new Error('Expected a valid editor commit');
  return { ...state, ...patch };
}

describe('registration jig editor session', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ registrationArtworkOutputSnapshot: null });
    addArtwork('enabled-art', '#0000ff');
    addArtwork('disabled-art', '#00aa00');
    useStore.getState().setLayerParam(artworkOperation('disabled-art'), { output: false });
  });

  it('keeps creation, layout changes and artwork copies isolated from the main project', () => {
    const state = useStore.getState();
    const before = structuredClone(state.project);
    let session = createJigEditorSession(state);
    session = replaceJigLayout(session, GRID);
    session = selectJigObjects(session, new Set(['enabled-art']));
    session = centerJigArtwork(session);

    expect(findRegistrationBoxes(session.draft.project.scene)).toHaveLength(6);
    expect(session.draft.project.scene.objects.length).toBeGreaterThan(before.scene.objects.length);
    expect(useStore.getState().project).toBe(state.project);
    expect(state.project).toEqual(before);
    expect(findRegistrationBoxes(state.project.scene)).toHaveLength(0);
    expect(useStore.getState().undoStack).toBe(state.undoStack);
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

  it('refuses a stale project reference or a replaced document epoch', () => {
    const state = useStore.getState();
    const session = createJigEditorSession(state);

    expect(commitJigEditorSession({ ...state, project: { ...state.project } }, session)).toBeNull();
    expect(
      commitJigEditorSession(
        { ...state, projectDocumentEpoch: state.projectDocumentEpoch + 1 },
        session,
      ),
    ).toBeNull();
  });

  it('refuses to replace a captured board and keeps its geometry and lock untouched', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const state = useStore.getState();
    const before = findRegistrationBoxes(state.project.scene);
    const session = createJigEditorSession(state);
    const changed = replaceJigLayout(session, GRID);

    expect(findRegistrationBoxes(session.draft.project.scene)).toEqual(before);
    expect(changed).toBe(session);
    expect(commitJigEditorSession(state, session)).toBeNull();
    expect(findRegistrationBoxes(state.project.scene)).toEqual(before);
  });
});
