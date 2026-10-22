import { beforeEach, describe, expect, it } from 'vitest';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  transformedBBox,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';

function drawArtwork(): void {
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 5, y: 5 },
    }),
  );
}

function selectArtwork(): void {
  useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set<string>() });
}

describe('addCapturedBoardBox', () => {
  beforeEach(() => resetStore());

  it('creates the measured box centered on the bed and selects it', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const state = useStore.getState();
    const box = findRegistrationBoxes(state.project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'rect', widthMm: 120, heightMm: 80 });
    expect(box?.transform.x).toBe((state.project.device.bedWidth - 120) / 2);
    expect(box?.transform.y).toBe((state.project.device.bedHeight - 80) / 2);
    expect(state.selectedObjectId).toBe(box?.id);
    expect(state.dirty).toBe(true);
  });

  it('locks the captured board so it cannot be dragged off registration', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(box?.locked).toBe(true);
  });

  it('keeps the outline out of the burn (box output off) — material is already placed', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const layer = useStore
      .getState()
      .project.scene.layers.find((l) => l.id === REGISTRATION_LAYER_ID);
    expect(layer?.output).toBe(false);
  });

  it('switches job placement to user-origin / front-left', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
  });

  it('clears any stale registration output snapshot on capture', () => {
    // A leftover snapshot from a prior "burn box only" toggle must not survive a
    // capture (which forces artwork scope), or it could later clobber outputs.
    useStore.setState({ registrationArtworkOutputSnapshot: { '#0000ff': true } });
    useStore.getState().addCapturedBoardBox(120, 80);
    expect(useStore.getState().registrationArtworkOutputSnapshot).toBeNull();
  });

  it('preserves existing artwork output while forcing the box off', () => {
    drawArtwork();
    useStore.getState().addCapturedBoardBox(120, 80);
    const scene = useStore.getState().project.scene;
    const artwork = scene.objects.find((object) => object.id === 'art');
    const artworkOperation =
      artwork === undefined ? null : primaryOperationForObject(artwork, scene.layers);
    expect(scene.layers.find((l) => l.id === REGISTRATION_LAYER_ID)?.output).toBe(false);
    expect(artworkOperation?.output).toBe(true);
  });
});

describe('addCapturedBoard (circle)', () => {
  beforeEach(() => resetStore());

  it('creates a locked circle (ellipse) board centered on the bed, center anchor, output off', () => {
    useStore.getState().addCapturedBoard({ kind: 'circle', diameterMm: 90 });
    const state = useStore.getState();
    const box = findRegistrationBoxes(state.project.scene)[0];
    expect(box?.spec).toMatchObject({ kind: 'ellipse', widthMm: 90, heightMm: 90 });
    expect(box?.locked).toBe(true);
    // centered on the bed (bbox top-left at (bed - d) / 2)
    expect(box?.transform.x).toBe((state.project.device.bedWidth - 90) / 2);
    expect(box?.transform.y).toBe((state.project.device.bedHeight - 90) / 2);
    // circle origin is the centre -> center anchor
    expect(state.jobPlacement).toEqual({ startFrom: 'user-origin', anchor: 'center' });
    expect(state.project.scene.layers.find((l) => l.id === REGISTRATION_LAYER_ID)?.output).toBe(
      false,
    );
    expect(state.dirty).toBe(true);
  });

  it('routes a rect shape to front-left placement (the addCapturedBoardBox wrapper path)', () => {
    useStore.getState().addCapturedBoard({ kind: 'rect', widthMm: 120, heightMm: 80 });
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
  });
});

describe('outline boards (canvas first, ADR-654)', () => {
  const outline = {
    kind: 'outline' as const,
    pointsMm: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ],
    anchorIndices: [0, 1, 2, 3],
  };
  // The same board measured by the head a quarter turn round.
  const turned = {
    ...outline,
    pointsMm: [
      { x: 60, y: 0 },
      { x: 60, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ],
  };

  beforeEach(() => resetStore());

  function drawnCentre(): { readonly x: number; readonly y: number } {
    const device = useStore.getState().project.device;
    return { x: (device.bedWidth - 100) / 2 + 50, y: (device.bedHeight - 60) / 2 + 30 };
  }

  it('draws an exact locked outline centred on the bed without changing placement', () => {
    const placement = useStore.getState().jobPlacement;
    useStore.getState().drawCapturedBoardOutline(outline);
    const state = useStore.getState();
    const box = findRegistrationBoxes(state.project.scene)[0]!;
    expect(box.spec).toEqual({ kind: 'polyline', points: outline.pointsMm, closed: true });
    expect(box.transform).toMatchObject({
      x: (state.project.device.bedWidth - 100) / 2,
      y: (state.project.device.bedHeight - 60) / 2,
    });
    expect(box).toMatchObject({ locked: true, provenance: 'captured-board' });
    expect(box.operationIds).toEqual([REGISTRATION_LAYER_ID]);
    expect(
      state.project.scene.layers.find((layer) => layer.id === REGISTRATION_LAYER_ID)?.output,
    ).toBe(false);
    expect(state.jobPlacement).toEqual(placement);
  });

  it('registers the drawn outline in place and turns the artwork on it with the board', () => {
    drawArtwork();
    useStore.getState().drawCapturedBoardOutline(outline);
    const centre = drawnCentre();
    useStore.getState().drawShape(
      createRectangle({
        id: 'on-board',
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: centre.x + 10, y: centre.y },
      }),
    );
    const undoDepth = useStore.getState().undoStack.length;

    useStore.getState().registerCapturedBoardOutline(turned, 90);

    const state = useStore.getState();
    const box = findRegistrationBoxes(state.project.scene)[0]!;
    expect(box.spec).toEqual({ kind: 'polyline', points: turned.pointsMm, closed: true });
    // The outline keeps its centre where it was drawn.
    expect(box.transform.x).toBeCloseTo(centre.x - 30);
    expect(box.transform.y).toBeCloseTo(centre.y - 50);
    expect(box).toMatchObject({ locked: true, provenance: 'captured-board' });
    const onBoard = state.project.scene.objects.find((object) => object.id === 'on-board')!;
    expect(onBoard.transform.x).toBeCloseTo(centre.x);
    expect(onBoard.transform.y).toBeCloseTo(centre.y + 10);
    expect(onBoard.transform.rotationDeg).toBeCloseTo(90);
    const offBoard = state.project.scene.objects.find((object) => object.id === 'art')!;
    expect(offBoard.transform).toMatchObject({ x: 5, y: 5, rotationDeg: 0 });
    expect(state.jobPlacement).toEqual({ startFrom: 'user-origin', anchor: 'front-left' });
    expect(state.undoStack.length).toBe(undoDepth + 1);
  });

  it('adds a centred outline when registering with none drawn', () => {
    useStore.getState().registerCapturedBoardOutline(outline, 0);
    const state = useStore.getState();
    const box = findRegistrationBoxes(state.project.scene)[0]!;
    expect(box.transform.x).toBe((state.project.device.bedWidth - 100) / 2);
    expect(state.jobPlacement).toEqual({ startFrom: 'user-origin', anchor: 'front-left' });
  });

  it('updates an outline while preserving its scene front-left', () => {
    useStore.getState().drawCapturedBoardOutline(outline);
    const before = transformedBBox(findRegistrationBoxes(useStore.getState().project.scene)[0]!);
    useStore.getState().updateCapturedBoard({
      ...outline,
      pointsMm: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 80, y: 50 },
        { x: 0, y: 70 },
      ],
    });
    const box = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    const after = transformedBBox(box);
    expect(after.minX).toBeCloseTo(before.minX);
    expect(after.maxY).toBeCloseTo(before.maxY);
    expect(box).toMatchObject({ locked: true, provenance: 'captured-board' });
  });
});

describe('updateCapturedBoard', () => {
  beforeEach(() => resetStore());

  it('resizes a rectangle in place while preserving its canvas bottom-left', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const before = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    const beforeBounds = transformedBBox(before);
    useStore.getState().updateCapturedBoard({ kind: 'rect', widthMm: 150, heightMm: 60 });

    const after = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    const afterBounds = transformedBBox(after);
    expect(after.id).toBe(before.id);
    expect(afterBounds.minX).toBeCloseTo(beforeBounds.minX, 8);
    expect(afterBounds.maxY).toBeCloseTo(beforeBounds.maxY, 8);
    expect(after.spec).toMatchObject({ kind: 'rect', widthMm: 150, heightMm: 60 });
    expect(after).toMatchObject({ locked: true, provenance: 'captured-board' });
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
  });

  it('resizes a circle in place while preserving its canvas center', () => {
    useStore.getState().addCapturedBoard({ kind: 'circle', diameterMm: 90 });
    const before = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    const beforeBounds = transformedBBox(before);
    const centerBefore = {
      x: (beforeBounds.minX + beforeBounds.maxX) / 2,
      y: (beforeBounds.minY + beforeBounds.maxY) / 2,
    };
    useStore.getState().updateCapturedBoard({ kind: 'circle', diameterMm: 110 });

    const after = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    const afterBounds = transformedBBox(after);
    expect(after.id).toBe(before.id);
    expect((afterBounds.minX + afterBounds.maxX) / 2).toBeCloseTo(centerBefore.x, 8);
    expect((afterBounds.minY + afterBounds.maxY) / 2).toBeCloseTo(centerBefore.y, 8);
    expect(after.spec).toMatchObject({ kind: 'ellipse', widthMm: 110, heightMm: 110 });
  });

  it('does not repurpose a normal registration jig as a captured board', () => {
    useStore.getState().addRegistrationCircle(80);
    const before = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    useStore.getState().updateCapturedBoard({ kind: 'circle', diameterMm: 120 });
    const after = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    expect(after).toEqual(before);
  });
});

describe('alignSelectionToRegistrationBox', () => {
  beforeEach(() => resetStore());

  it('snaps selected artwork to the board bottom-left corner', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    const boxBox = transformedBBox(box!);
    drawArtwork();
    selectArtwork();

    useStore.getState().alignSelectionToRegistrationBox('bottom-left');

    const art = useStore.getState().project.scene.objects.find((o) => o.id === 'art');
    const artBox = transformedBBox(art!);
    expect(artBox.minX).toBeCloseTo(boxBox.minX, 6);
    expect(artBox.maxY).toBeCloseTo(boxBox.maxY, 6);
  });

  it('centers selected artwork on the board', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    const boxBox = transformedBBox(box!);
    drawArtwork();
    selectArtwork();

    useStore.getState().alignSelectionToRegistrationBox('center');

    const art = useStore.getState().project.scene.objects.find((o) => o.id === 'art');
    const artBox = transformedBBox(art!);
    expect((artBox.minX + artBox.maxX) / 2).toBeCloseTo((boxBox.minX + boxBox.maxX) / 2, 6);
    expect((artBox.minY + artBox.maxY) / 2).toBeCloseTo((boxBox.minY + boxBox.maxY) / 2, 6);
  });

  it('is a no-op when only the box is selected', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    useStore.setState({ dirty: false, undoStack: [] });
    // Box is the current selection after capture; aligning it to itself moves nothing.
    useStore.getState().alignSelectionToRegistrationBox('center');
    expect(useStore.getState().dirty).toBe(false);
  });
});
