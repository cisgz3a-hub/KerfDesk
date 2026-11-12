// A press becomes a drag only after it has travelled (annoyance audit A2,
// B6-P2-3 and B6-P3-9; ADR-196 Amendment 1), through the real pointer pipeline.

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
  pressEscape,
  renderPointerHarness,
  resetPointerHarness,
  selectedIds,
} from './pointer-feel-test-harness';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanupPointerHarness);

// The square's top edge, away from every handle of a 60 mm box.
const ON_EDGE = { x: 37, y: 23 };

describe('a click that slips does not move artwork (B6-P2-3)', () => {
  beforeEach(() => resetPointerHarness(true));

  it.each([
    ['a selected object', true],
    ['an object the press selects', false],
  ])('leaves %s where it was, with snapping on', async (_label, selectFirst) => {
    // Off the 10 mm grid, so today's one-pixel move is pulled onto a grid line.
    const project = loadProject(outline('a', 23, 23, 60));
    if (selectFirst) useStore.getState().selectObject('a');
    const canvas = await renderPointerHarness();

    await pressAndRelease(canvas, ON_EDGE, { travelPx: { x: 1, y: 0 } });

    expect(objectById('a').transform).toEqual({ ...objectById('a').transform, x: 23, y: 23 });
    // The same project object: nothing keyed on it, a completed Frame
    // included (ADR-565), can have been expired by the click.
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().pendingUndo).toBeNull();
    expect(selectedIds()).toEqual(['a']);
  });

  it('keeps no undo snapshot until the press has travelled', async () => {
    loadProject(outline('a', 23, 23, 60));
    useStore.getState().selectObject('a');
    const canvas = await renderPointerHarness();

    await pointer(canvas, 'pointerdown', ON_EDGE);
    expect(canvas.dataset.dragKind).toBe('move');
    expect(useStore.getState().pendingUndo).toBeNull();
    await pointer(canvas, 'pointermove', ON_EDGE, { dxPx: 3, dyPx: 2 });
    expect(useStore.getState().pendingUndo).toBeNull();
    await pointer(canvas, 'pointermove', ON_EDGE, { dxPx: 30 });
    expect(useStore.getState().pendingUndo).not.toBeNull();
    await pointer(canvas, 'pointerup', ON_EDGE, { dxPx: 30 });

    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().pendingUndo).toBeNull();
  });

  it('ends a press on Esc before it travelled, with nothing to roll back', async () => {
    const project = loadProject(outline('a', 23, 23, 60));
    useStore.getState().selectObject('a');
    const canvas = await renderPointerHarness();

    await pointer(canvas, 'pointerdown', ON_EDGE);
    await pressEscape();
    expect(canvas.dataset.dragKind).toBe('');
    await pointer(canvas, 'pointermove', ON_EDGE, { dxPx: 40 });
    await pointer(canvas, 'pointerup', ON_EDGE, { dxPx: 40 });

    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(selectedIds()).toEqual(['a']);
  });
});

describe('a drag measures from the press point', () => {
  beforeEach(() => resetPointerHarness(false));

  it('moves by the whole travel once past the threshold, so the grab point stays put', async () => {
    loadProject(outline('a', 23, 23, 60));
    useStore.getState().selectObject('a');
    const canvas = await renderPointerHarness();
    const pxToMm = harnessPxToMm();

    await pointer(canvas, 'pointerdown', ON_EDGE);
    await pointer(canvas, 'pointermove', ON_EDGE, { dxPx: 4 });
    expect(objectById('a').transform.x).toBe(23);
    await pointer(canvas, 'pointermove', ON_EDGE, { dxPx: 5 });
    expect(objectById('a').transform.x).toBeCloseTo(23 + 5 * pxToMm, 6);
    // Coming back inside the threshold keeps dragging: the press is a drag now.
    await pointer(canvas, 'pointermove', ON_EDGE, { dxPx: 1 });
    expect(objectById('a').transform.x).toBeCloseTo(23 + pxToMm, 6);
    await pointer(canvas, 'pointerup', ON_EDGE, { dxPx: 1 });

    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it.each([
    ['mouse', 4, 5],
    ['pen', 6, 7],
    ['touch', 10, 11],
  ] as const)('a %s press holds for %i px and drags at %i px', async (pointerType, held, drags) => {
    loadProject(outline('a', 23, 23, 60));
    useStore.getState().selectObject('a');
    const canvas = await renderPointerHarness();

    await pointer(canvas, 'pointerdown', ON_EDGE, { pointerType });
    await pointer(canvas, 'pointermove', ON_EDGE, { pointerType, dyPx: held });
    expect(objectById('a').transform.y).toBe(23);
    await pointer(canvas, 'pointermove', ON_EDGE, { pointerType, dyPx: drags });
    expect(objectById('a').transform.y).toBeGreaterThan(23);
    await pointer(canvas, 'pointerup', ON_EDGE, { pointerType, dyPx: drags });
  });

  it('holds a resize handle until the press has travelled', async () => {
    loadProject(outline('a', 23, 23, 60));
    useStore.getState().selectObject('a');
    const canvas = await renderPointerHarness();
    const corner = { x: 83, y: 83 };

    await pointer(canvas, 'pointerdown', corner);
    expect(canvas.dataset.dragKind).toBe('scale');
    await pointer(canvas, 'pointermove', corner, { dxPx: 3, dyPx: 2 });
    expect(objectById('a').transform.scaleX).toBe(1);
    expect(useStore.getState().pendingUndo).toBeNull();
    await pointer(canvas, 'pointermove', corner, { dxPx: 40, dyPx: 40 });
    expect(objectById('a').transform.scaleX).toBeGreaterThan(1);
    await pointer(canvas, 'pointerup', corner, { dxPx: 40, dyPx: 40 });

    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('holds the rotate handle until the press has travelled', async () => {
    loadProject(outline('a', 23, 23, 60));
    useStore.getState().selectObject('a');
    const canvas = await renderPointerHarness();
    // 24 px above the middle of the top edge.
    const handle = { x: 53, y: 23 - 24 * harnessPxToMm() };

    await pointer(canvas, 'pointerdown', handle);
    expect(canvas.dataset.dragKind).toBe('rotate');
    await pointer(canvas, 'pointermove', handle, { dxPx: 3 });
    expect(objectById('a').transform.rotationDeg).toBe(0);
    await pointer(canvas, 'pointermove', handle, { dxPx: 60 });
    expect(objectById('a').transform.rotationDeg).not.toBe(0);
    await pointer(canvas, 'pointerup', handle, { dxPx: 60 });

    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('holds a multi-selection resize until the press has travelled', async () => {
    const project = loadProject(outline('a', 20, 20, 40), outline('b', 100, 20, 40));
    useStore.getState().selectObjects(['a', 'b']);
    const canvas = await renderPointerHarness();
    const corner = { x: 140, y: 60 };

    await pressAndRelease(canvas, corner, { travelPx: { x: 2, y: 2 } });

    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(selectedIds()).toEqual(['a', 'b']);
  });
});

describe('a plain click on one of several selected objects (B6-P3-9)', () => {
  beforeEach(() => resetPointerHarness(false));

  async function twoSelected(): Promise<HTMLCanvasElement> {
    loadProject(outline('a', 20, 20, 40), outline('b', 100, 20, 40));
    useStore.getState().selectObjects(['a', 'b']);
    return renderPointerHarness();
  }

  it('narrows the selection to it on release', async () => {
    const canvas = await twoSelected();

    await pointer(canvas, 'pointerdown', { x: 110, y: 20 });
    // Still both while the button is down: the press may yet become a drag.
    expect(selectedIds()).toEqual(['a', 'b']);
    await pointer(canvas, 'pointerup', { x: 110, y: 20 });

    expect(selectedIds()).toEqual(['b']);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('narrows after a slip inside the threshold too', async () => {
    const canvas = await twoSelected();

    await pressAndRelease(canvas, { x: 110, y: 20 }, { travelPx: { x: 2, y: -2 } });

    expect(selectedIds()).toEqual(['b']);
    expect(objectById('b').transform.x).toBe(100);
  });

  it('keeps the selection when the press becomes a drag', async () => {
    const canvas = await twoSelected();

    await pressAndRelease(canvas, { x: 110, y: 20 }, { travelPx: { x: 30, y: 0 } });

    expect(selectedIds()).toEqual(['a', 'b']);
    expect(objectById('a').transform.x).toBeGreaterThan(20);
    expect(objectById('b').transform.x).toBeGreaterThan(100);
  });

  it('keeps the selection on a click of the move handle', async () => {
    const canvas = await twoSelected();

    await pressAndRelease(canvas, { x: 80, y: 40 });

    expect(selectedIds()).toEqual(['a', 'b']);
  });

  it('leaves Shift+click removing the object', async () => {
    const canvas = await twoSelected();

    await pressAndRelease(canvas, { x: 110, y: 20 }, { shiftKey: true });

    expect(selectedIds()).toEqual(['a']);
  });

  it('leaves Alt+click cycling through what is under the pointer', async () => {
    const canvas = await twoSelected();

    await pressAndRelease(canvas, { x: 110, y: 20 }, { altKey: true });

    // Alt+click picks from the stack at the point; here that is `b` alone.
    expect(selectedIds()).toEqual(['b']);
    expect(useUiStore.getState().selectionMarquee).toBeNull();
  });
});
