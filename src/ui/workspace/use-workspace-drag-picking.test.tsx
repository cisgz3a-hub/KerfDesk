// What a press picks, at several zooms (annoyance audit A2: B6-P2-1, B6-P2-2
// and B6-P2-6; ADR-196 Amendment 1), through the real pointer pipeline.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import {
  cleanupPointerHarness,
  harnessPxToMm,
  loadProject,
  objectById,
  outline,
  pointer,
  pressAndRelease,
  renderPointerHarness,
  resetPointerHarness,
  selectedIds,
  straightLine,
} from './pointer-feel-test-harness';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => resetPointerHarness(false));
afterEach(cleanupPointerHarness);

const ZOOMS = [0.25, 1, 4, 16] as const;
// The view is centred on the bed, so artwork there stays on the canvas at 16x.
const CENTRE = { x: 200, y: 200 };

describe('a click reaches a line by screen distance (B6-P2-2)', () => {
  it.each(ZOOMS)('picks a line 4 px away and misses it 7 px away at zoom %f', async (zoom) => {
    loadProject(straightLine('line', CENTRE.x - 5, CENTRE.y, 10));
    // A lone object is selected on load (ADR-222); start with nothing selected.
    useStore.getState().selectObject(null);
    const canvas = await renderPointerHarness(zoom);

    await pressAndRelease(canvas, CENTRE, { dyPx: 7 });
    expect(selectedIds()).toEqual([]);
    await pressAndRelease(canvas, CENTRE, { dyPx: 4 });
    expect(selectedIds()).toEqual(['line']);
  });

  it('picks the nearer of two lines in reach, not the one stacked on top', async () => {
    const gapMm = 6 * harnessPxToMm();
    loadProject(
      straightLine('under', CENTRE.x - 20, CENTRE.y, 40),
      straightLine('over', CENTRE.x - 20, CENTRE.y + gapMm, 40),
    );
    const canvas = await renderPointerHarness();

    // 2 px from `under`, 4 px from `over`.
    await pressAndRelease(canvas, CENTRE, { dyPx: 2 });

    expect(selectedIds()).toEqual(['under']);
  });
});

describe('a press inside an outline that is not selected (B6-P2-2)', () => {
  it('selects the outline on a click, as before (ADR-196)', async () => {
    loadProject(outline('frame', 100, 100, 200), outline('inner', 150, 150, 20));
    const canvas = await renderPointerHarness();

    await pressAndRelease(canvas, { x: 250, y: 250 });

    expect(selectedIds()).toEqual(['frame']);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('draws a selection box when it becomes a drag, and leaves the outline alone', async () => {
    loadProject(outline('frame', 100, 100, 200), outline('inner', 150, 150, 20));
    const canvas = await renderPointerHarness();

    await pointer(canvas, 'pointerdown', { x: 140, y: 140 });
    await pointer(canvas, 'pointermove', { x: 180, y: 180 });
    expect(useUiStore.getState().selectionMarquee).not.toBeNull();
    expect(selectedIds()).toEqual([]);
    await pointer(canvas, 'pointerup', { x: 180, y: 180 });

    expect(selectedIds()).toEqual(['inner']);
    expect(objectById('frame').transform).toMatchObject({ x: 100, y: 100 });
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('still moves an outline that is selected, from anywhere inside it', async () => {
    loadProject(outline('frame', 100, 100, 200));
    useStore.getState().selectObject('frame');
    const canvas = await renderPointerHarness();

    await pressAndRelease(canvas, { x: 140, y: 140 }, { travelPx: { x: 30, y: 0 } });

    expect(objectById('frame').transform.x).toBeGreaterThan(100);
    expect(useUiStore.getState().selectionMarquee).toBeNull();
  });

  it('still moves an outline grabbed by its line', async () => {
    loadProject(outline('frame', 100, 100, 200));
    const canvas = await renderPointerHarness();

    await pressAndRelease(canvas, { x: 140, y: 100 }, { travelPx: { x: 30, y: 0 } });

    expect(selectedIds()).toEqual(['frame']);
    expect(objectById('frame').transform.x).toBeGreaterThan(100);
  });
});

describe('a stationary right-click (B6-P2-1)', () => {
  const RIGHT = { button: 2 };

  async function twoOfThreeSelected(): Promise<HTMLCanvasElement> {
    loadProject(outline('a', 20, 20, 40), outline('b', 100, 20, 40), outline('c', 20, 100, 40));
    useStore.getState().selectObjects(['a', 'b']);
    return renderPointerHarness();
  }

  it('keeps a multi-selection when it lands on one of its objects', async () => {
    const canvas = await twoOfThreeSelected();

    await pressAndRelease(canvas, { x: 110, y: 20 }, RIGHT);

    expect(selectedIds()).toEqual(['a', 'b']);
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({
      context: 'workspace-selection',
    });
  });

  it('keeps a multi-selection when it lands on its move handle', async () => {
    const canvas = await twoOfThreeSelected();

    await pressAndRelease(canvas, { x: 80, y: 40 }, RIGHT);

    expect(selectedIds()).toEqual(['a', 'b']);
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({
      context: 'workspace-selection',
    });
  });

  it('selects an object that was not selected', async () => {
    const canvas = await twoOfThreeSelected();

    await pressAndRelease(canvas, { x: 30, y: 100 }, RIGHT);

    expect(selectedIds()).toEqual(['c']);
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({
      context: 'workspace-selection',
    });
  });

  it('keeps the selection on empty canvas and opens the empty-canvas menu', async () => {
    const canvas = await twoOfThreeSelected();

    await pressAndRelease(canvas, { x: 300, y: 300 }, RIGHT);

    expect(selectedIds()).toEqual(['a', 'b']);
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({
      context: 'workspace-empty',
    });
  });

  it('keeps the selection and offers Unlock on locked artwork (ADR-706)', async () => {
    loadProject(outline('a', 20, 20, 40), outline('b', 100, 20, 40), {
      ...outline('held', 20, 100, 40),
      locked: true,
    });
    useStore.getState().selectObjects(['a', 'b']);
    const canvas = await renderPointerHarness();

    await pressAndRelease(canvas, { x: 30, y: 100 }, RIGHT);

    expect(selectedIds()).toEqual(['a', 'b']);
    expect(useUiStore.getState().workspaceContextBar).toMatchObject({
      context: 'workspace-empty',
      lockedObjectId: 'held',
    });
  });

  it.each(ZOOMS)('reaches a line by the same 5 px as a click at zoom %f', async (zoom) => {
    loadProject(straightLine('line', CENTRE.x - 5, CENTRE.y, 10));
    useStore.getState().selectObject(null);
    const canvas = await renderPointerHarness(zoom);

    await pressAndRelease(canvas, CENTRE, { ...RIGHT, dyPx: 7 });
    expect(selectedIds()).toEqual([]);
    await pressAndRelease(canvas, CENTRE, { ...RIGHT, dyPx: 4 });
    expect(selectedIds()).toEqual(['line']);
  });
});

describe('a small selected object (B6-P2-6)', () => {
  // A 4 mm square: about 2, 9, 37 and 147 px across at these zooms.
  it.each(ZOOMS)('moves when dragged by its middle at zoom %f', async (zoom) => {
    loadProject(outline('dot', CENTRE.x - 2, CENTRE.y - 2, 4));
    useStore.getState().selectObject('dot');
    const canvas = await renderPointerHarness(zoom);

    await pressAndRelease(canvas, CENTRE, { travelPx: { x: 20, y: 0 } });

    const moved = objectById('dot').transform;
    expect(moved.x).toBeCloseTo(CENTRE.x - 2 + 20 * harnessPxToMm(), 6);
    expect(moved).toMatchObject({ scaleX: 1, scaleY: 1 });
  });

  it.each(ZOOMS)('moves when dragged 1 px inside its corner at zoom %f', async (zoom) => {
    loadProject(outline('dot', CENTRE.x - 2, CENTRE.y - 2, 4));
    useStore.getState().selectObject('dot');
    const canvas = await renderPointerHarness(zoom);
    const sidePx = 4 / harnessPxToMm();
    const corner = { x: CENTRE.x - 2, y: CENTRE.y - 2 };

    await pressAndRelease(canvas, corner, { dxPx: 1, dyPx: 1, travelPx: { x: 20, y: 0 } });

    const after = objectById('dot').transform;
    // On a box with room for them (24 px and over) the corner handle keeps its whole square.
    if (sidePx >= 24) expect(after.scaleX).not.toBe(1);
    else expect(after).toMatchObject({ scaleX: 1, scaleY: 1 });
  });

  it.each(ZOOMS)('still resizes from just outside its corner at zoom %f', async (zoom) => {
    loadProject(outline('dot', CENTRE.x - 2, CENTRE.y - 2, 4));
    useStore.getState().selectObject('dot');
    const canvas = await renderPointerHarness(zoom);
    const corner = { x: CENTRE.x + 2, y: CENTRE.y + 2 };

    await pressAndRelease(canvas, corner, { dxPx: 2, dyPx: 2, travelPx: { x: 20, y: 20 } });

    expect(objectById('dot').transform.scaleX).toBeGreaterThan(1);
  });

  it.each(ZOOMS)('moves a straight line dragged by its middle at zoom %f', async (zoom) => {
    loadProject(straightLine('line', CENTRE.x - 5, CENTRE.y, 10));
    useStore.getState().selectObject('line');
    const canvas = await renderPointerHarness(zoom);

    await pressAndRelease(canvas, CENTRE, { travelPx: { x: 0, y: 20 } });

    expect(objectById('line').transform.y).toBeCloseTo(CENTRE.y + 20 * harnessPxToMm(), 6);
  });

  it('lengthens a straight line dragged by its end', async () => {
    loadProject(straightLine('line', CENTRE.x - 20, CENTRE.y, 40));
    useStore.getState().selectObject('line');
    const canvas = await renderPointerHarness();
    const end = { x: CENTRE.x + 20, y: CENTRE.y };

    await pressAndRelease(canvas, end, { travelPx: { x: 40, y: 0 } });

    const line = objectById('line');
    expect(line.transform.scaleX).toBeCloseTo((40 + 40 * harnessPxToMm()) / 40, 6);
    expect(line.transform.x).toBeCloseTo(CENTRE.x - 20, 6);
  });
});
