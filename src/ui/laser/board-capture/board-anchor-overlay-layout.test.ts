import { describe, expect, it } from 'vitest';
import {
  boardAnchorOverlayHasCollision,
  boardAnchorOverlayHandles,
  scenePointToOverlayPosition,
} from './board-anchor-overlay-layout';

const BOUNDS = { minX: 10, minY: 20, maxX: 110, maxY: 80 };

describe('boardAnchorOverlayHandles', () => {
  it('maps rectangle anchors onto the visible scene corners', () => {
    expect(boardAnchorOverlayHandles('rect', BOUNDS)).toEqual([
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
      boardAnchorOverlayHandles('circle', BOUNDS).map(({ target, scenePoint }) => ({
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
    const handles = boardAnchorOverlayHandles('rect', BOUNDS);
    expect(boardAnchorOverlayHasCollision(handles, { scale: 0.5, offsetX: 0, offsetY: 0 })).toBe(
      true,
    );
    expect(boardAnchorOverlayHasCollision(handles, { scale: 2, offsetX: 0, offsetY: 0 })).toBe(
      false,
    );
  });

  it('suppresses circle handles until center-to-rim spacing is unambiguous', () => {
    const handles = boardAnchorOverlayHandles('circle', BOUNDS);
    expect(boardAnchorOverlayHasCollision(handles, { scale: 1, offsetX: 0, offsetY: 0 })).toBe(
      true,
    );
    expect(boardAnchorOverlayHasCollision(handles, { scale: 2, offsetX: 0, offsetY: 0 })).toBe(
      false,
    );
  });
});
