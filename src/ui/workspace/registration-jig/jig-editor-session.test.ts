import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findRegistrationBoxBounds,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  type Project,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { useLaserStore } from '../../state/laser-store';
import { useStore } from '../../state/store';
import { resetStore } from '../../state/test-helpers';
import {
  centerJigArtwork,
  createJigEditorSession,
  jigOutlinesLocked,
  jigSessionView,
  jigStoreChange,
  removeJigLayout,
  replaceJigLayout,
  selectJigObjects,
} from './jig-editor-session';
import { jigRunPhase } from './jig-run-phase';
import { applyJigEdit } from './use-jig-editor';

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

/** Open jig mode on the store's project, as the jig page does on mount. */
function openJig(): void {
  const state = useStore.getState();
  const change = jigStoreChange(state, jigSessionView(state), createJigEditorSession(state));
  if (change !== null) useStore.setState(change);
}

function burnOutlines(): void {
  useStore.setState(applyRegistrationOutput(useStore.getState(), 'artwork'));
}

describe('registration jig mode session', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ registrationArtworkOutputSnapshot: null });
    addArtwork('enabled-art', '#0000ff');
    addArtwork('disabled-art', '#00aa00');
    useStore.getState().setLayerParam(artworkOperation('disabled-art'), { output: false });
  });
  afterEach(() => {
    useLaserStore.setState({ motionOperation: null });
  });

  it('creates a new jig as one undoable edit in Outline only and keeps artwork intent', () => {
    const before = useStore.getState();
    const enabledId = artworkOperation('enabled-art');
    const disabledId = artworkOperation('disabled-art');
    openJig();
    const opened = useStore.getState();

    expect(findRegistrationBoxes(opened.project.scene)).toHaveLength(1);
    expect(jigRunPhase(opened.project.scene)).toBe('outlines');
    expect(opened.undoStack).toEqual([...before.undoStack, before.project]);
    expect(opened.dirty).toBe(true);
    expect(opened.registrationArtworkOutputSnapshot).toMatchObject({
      [enabledId]: true,
      [disabledId]: false,
    });
    const artwork = applyRegistrationOutput(opened, 'artwork');
    expect(outputs(artwork.project)).toMatchObject({
      [REGISTRATION_LAYER_ID]: false,
      [enabledId]: true,
      [disabledId]: false,
    });
    openJig();
    expect(useStore.getState()).toBe(opened);
  });

  it('edits the open project directly, with the outlines kept locked in it', () => {
    openJig();
    applyJigEdit((session) => replaceJigLayout(session, GRID), { fresh: true });
    applyJigEdit((session) => selectJigObjects(session, new Set(['enabled-art'])), {});
    applyJigEdit(centerJigArtwork, {});
    const { project } = useStore.getState();

    expect(findRegistrationBoxes(project.scene)).toHaveLength(6);
    expect(findRegistrationBoxes(project.scene).every((box) => box.locked)).toBe(true);
    expect(jigOutlinesLocked(jigSessionView(useStore.getState()).draft.project)).toBe(false);
    expect(project.scene.objects.length).toBeGreaterThan(8);
  });

  it('shows burned outlines locked until the operator unlocks them on purpose', () => {
    openJig();
    burnOutlines();
    const state = useStore.getState();

    expect(jigRunPhase(state.project.scene)).toBe('artwork');
    expect(jigOutlinesLocked(jigSessionView(state).draft.project)).toBe(true);
    const unlocked = jigSessionView(state, { outlinesUnlocked: true });
    expect(jigOutlinesLocked(unlocked.draft.project)).toBe(false);
    applyJigEdit((session) => replaceJigLayout(session, GRID), { outlinesUnlocked: true });
    expect(
      findRegistrationBoxes(useStore.getState().project.scene).every((box) => box.locked),
    ).toBe(true);
  });

  it('keeps a new jig centred on the bed when its grid grows', () => {
    openJig();
    const { bedWidth, bedHeight } = useStore.getState().project.device;
    applyJigEdit((session) => replaceJigLayout(session, { ...GRID, columns: 6 }), { fresh: true });
    const bounds = findRegistrationBoxBounds(useStore.getState().project.scene)!;

    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(bedWidth / 2);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(bedHeight / 2);
  });

  it('keeps the first outline corner of an existing jig, whose outlines may be burned', () => {
    openJig();
    const before = findRegistrationBoxBounds(useStore.getState().project.scene)!;
    applyJigEdit((session) => replaceJigLayout(session, GRID), {});
    const after = findRegistrationBoxBounds(useStore.getState().project.scene)!;

    expect(after.minX).toBeCloseTo(before.minX);
    expect(after.minY).toBeCloseTo(before.minY);
  });

  it('keeps the current run and artwork intent when the layout is rebuilt', () => {
    openJig();
    const outlineRun = useStore.getState();
    applyJigEdit((session) => replaceJigLayout(session, GRID), {});
    const rebuilt = useStore.getState();
    expect(outputs(rebuilt.project)).toEqual(outputs(outlineRun.project));
    expect(rebuilt.registrationArtworkOutputSnapshot).toEqual(
      outlineRun.registrationArtworkOutputSnapshot,
    );

    burnOutlines();
    const artworkRun = useStore.getState();
    applyJigEdit((session) => replaceJigLayout(session, { ...GRID, rows: 1 }), {
      outlinesUnlocked: true,
    });
    expect(outputs(useStore.getState().project)).toEqual(outputs(artworkRun.project));
  });

  it('adds no undo step for a selection change or an edit that changes nothing', () => {
    openJig();
    const opened = useStore.getState();
    applyJigEdit((session) => selectJigObjects(session, new Set(['enabled-art'])), {});
    applyJigEdit((session) => session, {});

    expect(useStore.getState().selectedObjectId).toBe('enabled-art');
    expect(useStore.getState().project).toBe(opened.project);
    expect(useStore.getState().undoStack).toBe(opened.undoStack);
  });

  it('undoes a jig edit with the project Undo', () => {
    openJig();
    const opened = useStore.getState().project;
    applyJigEdit((session) => replaceJigLayout(session, GRID), {});
    useStore.getState().undo();

    expect(useStore.getState().project).toBe(opened);
  });

  it('changes only the selection while the machine is moving', () => {
    openJig();
    const opened = useStore.getState().project;
    useLaserStore.setState({ motionOperation: { kind: 'frame' } as never });
    applyJigEdit((session) => replaceJigLayout(session, GRID), {});
    applyJigEdit((session) => selectJigObjects(session, new Set(['enabled-art'])), {});

    expect(useStore.getState().project).toBe(opened);
    expect(useStore.getState().selectedObjectId).toBe('enabled-art');
  });

  it('restores enabled artwork before removing an outline-mode jig', () => {
    openJig();
    applyJigEdit(removeJigLayout, {});
    const { project, registrationArtworkOutputSnapshot } = useStore.getState();

    expect(findRegistrationBoxes(project.scene)).toHaveLength(0);
    expect(registrationArtworkOutputSnapshot).toBeNull();
    expect(outputs(project)[artworkOperation('enabled-art')]).toBe(true);
    expect(outputs(project)[artworkOperation('disabled-art')]).toBe(false);
  });

  it('leaves a captured board untouched', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const state = useStore.getState();
    const before = findRegistrationBoxes(state.project.scene);
    openJig();
    applyJigEdit((session) => replaceJigLayout(session, GRID), {});

    expect(findRegistrationBoxes(useStore.getState().project.scene)).toEqual(before);
    expect(useStore.getState().project).toBe(state.project);
  });

  it('names the next run, including the one-pass mix the jig must avoid', () => {
    expect(jigRunPhase(useStore.getState().project.scene)).toBe('none');
    openJig();
    expect(jigRunPhase(useStore.getState().project.scene)).toBe('outlines');
    burnOutlines();
    expect(jigRunPhase(useStore.getState().project.scene)).toBe('artwork');
    useStore.getState().setLayerParam(REGISTRATION_LAYER_ID, { output: true });
    expect(jigRunPhase(useStore.getState().project.scene)).toBe('both');
  });
});
