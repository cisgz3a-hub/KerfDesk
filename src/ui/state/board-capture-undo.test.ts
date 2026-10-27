// ADR-654 Amendment 2 (rolling audit v4 H9-P2-1): Place Board changes Start From
// in the same Undo step as the board, so Undo and Redo never leave the canvas
// showing one layout while the next Start burns at another.

import { beforeEach, describe, expect, it } from 'vitest';
import { findRegistrationBoxes, IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { currentReplayExecutionSignature } from '../laser/start-job-execution-tracking';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const ABSOLUTE = { startFrom: 'absolute', anchor: 'front-left' } as const;
const BOARD_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;

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

function drawArtwork(id: string, x: number, y: number): void {
  useStore.getState().drawShape(
    createRectangle({
      id,
      color: '#0000ff',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y },
    }),
  );
}

function artwork(id: string) {
  return useStore.getState().project.scene.objects.find((object) => object.id === id);
}

function turn(id: string): number | undefined {
  return artwork(id)?.transform.rotationDeg;
}

function boards(): number {
  return findRegistrationBoxes(useStore.getState().project.scene).length;
}

describe('Place Board Undo and Redo restore Start From with the board', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().setJobPlacement(ABSOLUTE);
    drawArtwork('art', 50, 40);
  });

  it('puts a rectangle capture and its User Origin back together', () => {
    const before = currentReplayExecutionSignature();
    useStore.getState().addCapturedBoardBox(120, 80);
    const captured = currentReplayExecutionSignature();
    expect(useStore.getState().jobPlacement).toEqual(BOARD_ORIGIN);

    useStore.getState().undo();
    expect(boards()).toBe(0);
    expect(useStore.getState().jobPlacement).toEqual(ABSOLUTE);
    expect(currentReplayExecutionSignature()).toBe(before);

    useStore.getState().redo();
    expect(boards()).toBe(1);
    expect(useStore.getState().jobPlacement).toEqual(BOARD_ORIGIN);
    expect(currentReplayExecutionSignature()).toBe(captured);
  });

  it('puts a circle capture back to the placement the operator had', () => {
    useStore.getState().setJobPlacement({ anchor: 'center' });
    useStore.getState().addCapturedBoard({ kind: 'circle', diameterMm: 90 });
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'center',
    });

    useStore.getState().undo();
    expect(useStore.getState().jobPlacement).toEqual({ startFrom: 'absolute', anchor: 'center' });
  });

  it('undoes an outline registration with its turn and its User Origin', () => {
    useStore.getState().drawCapturedBoardOutline(outline);
    const device = useStore.getState().project.device;
    drawArtwork('on-board', (device.bedWidth - 100) / 2 + 40, (device.bedHeight - 60) / 2 + 25);
    const drawn = currentReplayExecutionSignature();
    expect(useStore.getState().jobPlacement).toEqual(ABSOLUTE);

    useStore.getState().registerCapturedBoardOutline(outline, 5);
    const registered = currentReplayExecutionSignature();
    expect(turn('on-board')).toBeCloseTo(5);
    expect(useStore.getState().jobPlacement).toEqual(BOARD_ORIGIN);

    useStore.getState().undo();
    expect(turn('on-board')).toBe(0);
    expect(useStore.getState().jobPlacement).toEqual(ABSOLUTE);
    expect(currentReplayExecutionSignature()).toBe(drawn);

    useStore.getState().redo();
    expect(turn('on-board')).toBeCloseTo(5);
    expect(useStore.getState().jobPlacement).toEqual(BOARD_ORIGIN);
    expect(currentReplayExecutionSignature()).toBe(registered);
  });

  it('undoes a board correction to the Start From the operator chose after capture', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    useStore.getState().setJobPlacement(ABSOLUTE);

    useStore.getState().updateCapturedBoard({ kind: 'rect', widthMm: 150, heightMm: 60 });
    expect(useStore.getState().jobPlacement).toEqual(BOARD_ORIGIN);

    useStore.getState().undo();
    expect(boards()).toBe(1);
    expect(useStore.getState().jobPlacement).toEqual(ABSOLUTE);
  });

  it('keeps User Origin when only a later edit on the board is undone', () => {
    useStore.getState().addCapturedBoardBox(120, 80);
    drawArtwork('later', 150, 150);

    useStore.getState().undo();
    expect(artwork('later')).toBeUndefined();
    expect(boards()).toBe(1);
    expect(useStore.getState().jobPlacement).toEqual(BOARD_ORIGIN);
  });
});
