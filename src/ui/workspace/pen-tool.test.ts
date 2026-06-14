import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { finishPen, penClickOutcome } from './pen-tool';

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

describe('finishPen', () => {
  beforeEach(() => useUiStore.getState().setPenDraft(null));

  it('commits an open polyline with >=2 vertices and clears the draft', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setPenDraft({
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      cursor: null,
    });
    finishPen({ closed: false, project: createProject(), drawShape });
    expect(drawShape).toHaveBeenCalledTimes(1);
    const shape = drawShape.mock.calls[0]?.[0];
    expect(shape?.spec.kind).toBe('polyline');
    expect(shape?.spec.closed).toBe(false);
    expect(shape?.spec.points).toHaveLength(2);
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('does not commit an open finish with <2 vertices (keeps the draft)', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setPenDraft({ vertices: [{ x: 0, y: 0 }], cursor: null });
    finishPen({ closed: false, project: createProject(), drawShape });
    expect(drawShape).not.toHaveBeenCalled();
    expect(useUiStore.getState().penDraft).not.toBeNull();
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
    finishPen({ closed: true, project: createProject(), drawShape });
    expect(drawShape).not.toHaveBeenCalled();
  });

  it('commits a closed polyline with >=3 vertices', () => {
    const drawShape = vi.fn();
    useUiStore.getState().setPenDraft({ vertices: TRIANGLE, cursor: null });
    finishPen({ closed: true, project: createProject(), drawShape });
    expect(drawShape).toHaveBeenCalledTimes(1);
    expect(drawShape.mock.calls[0]?.[0]?.spec.closed).toBe(true);
  });

  it('commits via the real store action, pushing exactly one undo entry', () => {
    // Guards the removed redundant selectObject (delta #1): the commit must be a
    // single store write, so one undo fully reverses it.
    useStore.getState().newProject();
    useUiStore.getState().setPenDraft({ vertices: TRIANGLE, cursor: null });
    finishPen({
      closed: false,
      project: useStore.getState().project,
      drawShape: useStore.getState().drawShape,
    });
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useUiStore.getState().penDraft).toBeNull();
  });
});
