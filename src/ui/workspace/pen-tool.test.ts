import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { constrainPenPoint, finishPen, penClickOutcome } from './pen-tool';

const TRIANGLE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

describe('penClickOutcome', () => {
  it('ignores the second mousedown of a double-click (detail>=2)', () => {
    const out = penClickOutcome({
      detail: 2,
      point: { x: 5, y: 5 },
      penDraft: { vertices: TRIANGLE, cursor: null },
      closeDistanceMm: 1,
    });
    expect(out).toEqual({ kind: 'ignore' });
  });

  it('starts a new polyline when none is in progress', () => {
    const out = penClickOutcome({
      detail: 1,
      point: { x: 3, y: 4 },
      penDraft: null,
      closeDistanceMm: 1,
    });
    expect(out).toEqual({ kind: 'start', point: { x: 3, y: 4 } });
  });

  it('appends when the click is not near the first vertex', () => {
    const out = penClickOutcome({
      detail: 1,
      point: { x: 50, y: 50 },
      penDraft: { vertices: TRIANGLE, cursor: null },
      closeDistanceMm: 2,
    });
    expect(out).toEqual({ kind: 'append', point: { x: 50, y: 50 } });
  });

  it('closes when clicking near the first vertex with >=3 vertices', () => {
    const out = penClickOutcome({
      detail: 1,
      point: { x: 0.5, y: 0.5 },
      penDraft: { vertices: TRIANGLE, cursor: null },
      closeDistanceMm: 2,
    });
    expect(out).toEqual({ kind: 'close' });
  });

  it('does NOT close with only 2 vertices even near the start (would be degenerate)', () => {
    const out = penClickOutcome({
      detail: 1,
      point: { x: 0.1, y: 0.1 },
      penDraft: {
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        cursor: null,
      },
      closeDistanceMm: 2,
    });
    expect(out).toEqual({ kind: 'append', point: { x: 0.1, y: 0.1 } });
  });
});

describe('constrainPenPoint', () => {
  it('returns the raw point when Shift-style constraint is not active', () => {
    expect(
      constrainPenPoint({ vertices: TRIANGLE, cursor: null }, { x: 17, y: 13 }, false),
    ).toEqual({
      x: 17,
      y: 13,
    });
  });

  it('snaps the next point to the nearest 45 degree increment from the previous vertex', () => {
    const point = constrainPenPoint(
      { vertices: [{ x: 0, y: 0 }], cursor: null },
      { x: 10, y: 3 },
      true,
    );

    expect(point.x).toBeCloseTo(Math.hypot(10, 3), 5);
    expect(point.y).toBeCloseTo(0, 5);
  });

  it('snaps diagonal placement to 45 degrees while preserving distance', () => {
    const point = constrainPenPoint(
      { vertices: [{ x: 5, y: 5 }], cursor: null },
      { x: 15, y: 14 },
      true,
    );
    const dx = point.x - 5;
    const dy = point.y - 5;

    expect(dx).toBeCloseTo(dy, 5);
    expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(10, 9), 5);
  });
});

describe('finishPen', () => {
  beforeEach(() => {
    useUiStore.getState().setPenDraft(null);
    useUiStore.getState().setActiveLayerColor(null);
    useUiStore.getState().setToolMode({ kind: 'select' });
  });

  it('commits an open polyline with >=2 vertices and clears the draft', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setPenDraft({
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      cursor: null,
    });
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    expect(finishPen({ closed: false, project: createProject(), drawShape })).toBe(true);
    expect(drawShape).toHaveBeenCalledTimes(1);
    const shape = drawShape.mock.calls[0]?.[0];
    expect(shape?.spec.kind).toBe('polyline');
    expect(shape?.spec.closed).toBe(false);
    expect(shape?.spec.points).toHaveLength(2);
    expect(useUiStore.getState().penDraft).toBeNull();
    // Finishing a polyline returns to Select (maintainer request, 2026-07-07).
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
  });

  it('does not commit an open finish with <2 vertices (keeps the draft)', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft({ vertices: [{ x: 0, y: 0 }], cursor: null });
    expect(finishPen({ closed: false, project: createProject(), drawShape })).toBe(false);
    expect(drawShape).not.toHaveBeenCalled();
    expect(useUiStore.getState().penDraft).not.toBeNull();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'draw', shape: 'polyline' });
  });

  it('requires >=3 vertices to close (a 2-point closed path is degenerate)', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setPenDraft({
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      cursor: null,
    });
    expect(finishPen({ closed: true, project: createProject(), drawShape })).toBe(false);
    expect(drawShape).not.toHaveBeenCalled();
  });

  it('commits a closed polyline with >=3 vertices', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setPenDraft({ vertices: TRIANGLE, cursor: null });
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    expect(finishPen({ closed: true, project: createProject(), drawShape })).toBe(true);
    expect(drawShape).toHaveBeenCalledTimes(1);
    expect(drawShape.mock.calls[0]?.[0]?.spec.closed).toBe(true);
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
  });

  it('uses the current drawing layer color for committed pen geometry', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setActiveLayerColor('#00ff00');
    useUiStore.getState().setPenDraft({ vertices: TRIANGLE, cursor: null });

    expect(finishPen({ closed: false, project: twoLayerProject(), drawShape })).toBe(true);

    const shape = drawShape.mock.calls[0]?.[0];
    expect(shape?.color).toBe('#00ff00');
    expect(shape?.paths[0]?.color).toBe('#00ff00');
  });

  it('commits via the real store action, pushing exactly one undo entry', () => {
    // Guards the removed redundant selectObject (delta #1): the commit must be a
    // single store write, so one undo fully reverses it.
    useStore.getState().newProject();
    useUiStore.getState().setPenDraft({ vertices: TRIANGLE, cursor: null });
    expect(
      finishPen({
        closed: false,
        project: useStore.getState().project,
        drawShape: useStore.getState().drawShape,
      }),
    ).toBe(true);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useUiStore.getState().penDraft).toBeNull();
  });
});

function twoLayerProject(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      objects: [],
      layers: [
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
        createLayer({ id: '#00ff00', color: '#00ff00', mode: 'line' }),
      ],
    },
  };
}
