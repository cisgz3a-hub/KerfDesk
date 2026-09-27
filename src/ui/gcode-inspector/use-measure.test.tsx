import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dPick } from '../viewer3d/scene-pick';
import { measuredPoint, useMeasure, type MeasureTool } from './use-measure';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function pickAt(x: number, vertex: Viewer3dPick['vertex'] = null): Viewer3dPick {
  return { segmentIndex: 0, fraction: 0.5, point: { x, y: 0, z: -1 }, vertex };
}

let host: HTMLDivElement;
let root: Root;
let tool: MeasureTool;
const setMeasure = vi.fn();
const handleRef = { current: { setMeasure } as unknown as Viewer3dSceneHandle };

function Harness(props: { readonly resetKey: unknown }) {
  tool = useMeasure(handleRef, true, props.resetKey);
  return null;
}

function render(resetKey: unknown = 'job'): void {
  act(() => root.render(<Harness resetKey={resetKey} />));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  setMeasure.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('measuredPoint', () => {
  it('uses the end of the move when the pointer snapped to it', () => {
    expect(measuredPoint(pickAt(4))).toEqual({ x: 4, y: 0, z: -1 });
    expect(measuredPoint(pickAt(4, { x: 5, y: 0, z: -1 }))).toEqual({ x: 5, y: 0, z: -1 });
  });
});

describe('useMeasure', () => {
  it('draws nothing until it is on and a first point is chosen', () => {
    render();
    act(() => tool.addPoint(pickAt(1)));
    expect(setMeasure).toHaveBeenLastCalledWith(null);
    act(() => tool.toggle());
    expect(tool.active).toBe(true);
    expect(tool.from).toBeNull();
    expect(setMeasure).toHaveBeenLastCalledWith(null);
  });

  it('measures from the first click to the second, following the pointer between', () => {
    render();
    act(() => tool.toggle());
    expect(tool.clickHint).toBe('Click to measure from here');
    act(() => tool.addPoint(pickAt(0, { x: 0, y: 0, z: 0 })));
    expect(setMeasure).toHaveBeenLastCalledWith({ from: { x: 0, y: 0, z: 0 }, to: null });
    expect(tool.clickHint).toBe('Click to measure to here');
    act(() => tool.hover(pickAt(7)));
    expect(tool.to).toEqual({ x: 7, y: 0, z: -1 });
    act(() => tool.addPoint(pickAt(9)));
    expect(setMeasure).toHaveBeenLastCalledWith({
      from: { x: 0, y: 0, z: 0 },
      to: { x: 9, y: 0, z: -1 },
    });
    act(() => tool.hover(pickAt(3)));
    expect(tool.to).toEqual({ x: 9, y: 0, z: -1 });
  });

  it('starts over on a third click', () => {
    render();
    act(() => tool.toggle());
    act(() => tool.addPoint(pickAt(1)));
    act(() => tool.addPoint(pickAt(2)));
    act(() => tool.addPoint(pickAt(3)));
    expect(tool.from).toEqual({ x: 3, y: 0, z: -1 });
    expect(tool.to).toBeNull();
  });

  it('clears on a new program, on Clear and when switched off', () => {
    render();
    act(() => tool.toggle());
    act(() => tool.addPoint(pickAt(1)));
    render('another job');
    expect(tool.from).toBeNull();
    expect(setMeasure).toHaveBeenLastCalledWith(null);
    act(() => tool.addPoint(pickAt(1)));
    act(() => tool.clear());
    expect(tool.from).toBeNull();
    act(() => tool.addPoint(pickAt(1)));
    act(() => tool.toggle());
    expect(tool.active).toBe(false);
    expect(tool.from).toBeNull();
    expect(setMeasure).toHaveBeenLastCalledWith(null);
  });
});
