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
