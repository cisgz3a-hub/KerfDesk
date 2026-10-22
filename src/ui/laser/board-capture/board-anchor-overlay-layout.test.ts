import { describe, expect, it } from 'vitest';
import {
  boardAnchorOverlayHasCollision,
  boardAnchorOverlayHandles,
  scenePointToOverlayPosition,
} from './board-anchor-overlay-layout';

const BOUNDS = { minX: 10, minY: 20, maxX: 110, maxY: 80 };
const RECT = { kind: 'rect' as const, origin: { x: 0, y: 0 }, widthMm: 100, heightMm: 60 };
const CIRCLE = { kind: 'circle' as const, center: { x: 0, y: 0 }, radiusMm: 30 };

describe('boardAnchorOverlayHandles', () => {
  it('maps rectangle anchors onto the visible scene corners', () => {
    expect(boardAnchorOverlayHandles(RECT, BOUNDS)).toEqual([
      {
        target: { kind: 'rect', anchor: 'bottom-left' },
        label: 'Verify board bottom-left corner',
        scenePoint: { x: 10, y: 80 },
      },
      {
        target: { kind: 'rect', anchor: 'bottom-right' },
        label: 'Verify board bottom-right corner',
        scenePoint: { x: 110, y: 80 },
      },
      {
        target: { kind: 'rect', anchor: 'top-left' },
        label: 'Verify board top-left corner',
        scenePoint: { x: 10, y: 20 },
      },
      {
        target: { kind: 'rect', anchor: 'top-right' },
        label: 'Verify board top-right corner',
        scenePoint: { x: 110, y: 20 },
      },
    ]);
  });

  it('maps circle center and cardinal rim anchors onto the visible bounds', () => {
    expect(
      boardAnchorOverlayHandles(CIRCLE, BOUNDS).map(({ target, scenePoint }) => ({
        target,
        scenePoint,
      })),
    ).toEqual([
      { target: { kind: 'circle', anchor: 'center' }, scenePoint: { x: 60, y: 50 } },
      { target: { kind: 'circle', anchor: 'rim-top' }, scenePoint: { x: 60, y: 20 } },
      { target: { kind: 'circle', anchor: 'rim-right' }, scenePoint: { x: 110, y: 50 } },
      { target: { kind: 'circle', anchor: 'rim-bottom' }, scenePoint: { x: 60, y: 80 } },
      { target: { kind: 'circle', anchor: 'rim-left' }, scenePoint: { x: 10, y: 50 } },
    ]);
  });

  it('maps registered outline anchors into its visible scene bounds', () => {
    const geometry = {
      kind: 'outline' as const,
      localPointsMm: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 60, y: 60 },
        { x: 0, y: 60 },
      ],
      anchorIndices: [0, 1, 3],
      viewSigns: { x: 1 as const, y: 1 as const },
      measured: [
        { index: 0, machine: { x: 20, y: 30 } },
        { index: 1, machine: { x: 120, y: 30 } },
      ],
    };
    expect(boardAnchorOverlayHandles(geometry, BOUNDS)).toEqual([
      {
        target: { kind: 'outline', index: 0, ordinal: 1 },
        label: 'Verify board anchor 1',
        scenePoint: { x: 10, y: 20 },
      },
      {
        target: { kind: 'outline', index: 1, ordinal: 2 },
        label: 'Verify board anchor 2',
        scenePoint: { x: 110, y: 20 },
      },
      {
        target: { kind: 'outline', index: 3, ordinal: 3 },
        label: 'Verify board anchor 3',
        scenePoint: { x: 10, y: 80 },
      },
    ]);
  });
});

describe('scenePointToOverlayPosition', () => {
  it('uses the workspace view scale and offsets', () => {
    expect(
      scenePointToOverlayPosition({ x: 15, y: 25 }, { scale: 2, offsetX: 10, offsetY: -5 }),
    ).toEqual({ left: 40, top: 45 });
  });
});

describe('boardAnchorOverlayHasCollision', () => {
  it('suppresses rectangle handles when either projected edge crowds the hit areas', () => {
    const handles = boardAnchorOverlayHandles(RECT, BOUNDS);
    expect(boardAnchorOverlayHasCollision(handles, { scale: 0.5, offsetX: 0, offsetY: 0 })).toBe(
      true,
    );
    expect(boardAnchorOverlayHasCollision(handles, { scale: 2, offsetX: 0, offsetY: 0 })).toBe(
      false,
    );
  });

  it('suppresses circle handles until center-to-rim spacing is unambiguous', () => {
    const handles = boardAnchorOverlayHandles(CIRCLE, BOUNDS);
    expect(boardAnchorOverlayHasCollision(handles, { scale: 1, offsetX: 0, offsetY: 0 })).toBe(
      true,
    );
    expect(boardAnchorOverlayHasCollision(handles, { scale: 2, offsetX: 0, offsetY: 0 })).toBe(
      false,
    );
  });
});
