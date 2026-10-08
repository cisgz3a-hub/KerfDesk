import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dPick } from '../viewer3d/scene-pick';
import { InspectorMoveTip, type MoveTipMeasure } from './InspectorMoveTip';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

const PROGRAM = model(['G21 G90', 'G0 X10', 'G1 X30 F600'].join('\n'));
const CUT: Viewer3dPick = {
  segmentIndex: 1,
  fraction: 0.5,
  point: { x: 20, y: 0, z: 0 },
  vertex: null,
};

let frames: FrameRequestCallback[] = [];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function flushFrames(): void {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((callback) => callback(0)));
}

function pointer(canvas: HTMLCanvasElement, type: string, init: MouseEventInit): void {
  act(() => {
    canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
  });
}

function mount(options: {
  readonly pick: Viewer3dPick | null;
  readonly enabled?: boolean;
  readonly paused?: boolean;
  readonly measure?: MoveTipMeasure;
}) {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320 }) as DOMRect;
  const handle = { pickMove: vi.fn(() => options.pick), highlightMove: vi.fn() };
  const onLocate = vi.fn();
  act(() =>
    root.render(
      <InspectorMoveTip
        model={PROGRAM}
        segTimeEndSec={new Float64Array([1, 3])}
        onLocate={onLocate}
        canvasRef={{ current: canvas }}
        handleRef={{ current: handle as unknown as Viewer3dSceneHandle }}
        enabled={options.enabled ?? true}
        paused={options.paused ?? false}
        measure={options.measure ?? null}
      />,
    ),
  );
  return { canvas, handle, onLocate };
}

describe('InspectorMoveTip', () => {
  it('reads out and outlines the move under the pointer, once a frame', () => {
    const { canvas, handle } = mount({ pick: CUT });
    pointer(canvas, 'pointermove', { clientX: 50, clientY: 60 });
    pointer(canvas, 'pointermove', { clientX: 60, clientY: 70 });
    expect(handle.pickMove).not.toHaveBeenCalled();
    flushFrames();
    expect(handle.pickMove).toHaveBeenCalledTimes(1);
    expect(handle.pickMove).toHaveBeenCalledWith(50, 50);
    expect(handle.highlightMove).toHaveBeenLastCalledWith(1);
    const card = host.querySelector('.gcode-viewer-move-tip');
    expect(card?.textContent).toContain('Line 3 · Cut (G1)');
    expect(card?.textContent).toContain('F 600 mm/min');
    expect(card?.textContent).toContain('Reached at 0:02');
  });

  it('shows nothing over empty space and clears when the pointer leaves', () => {
    const { canvas, handle } = mount({ pick: null });
    pointer(canvas, 'pointermove', { clientX: 50, clientY: 60 });
    flushFrames();
    expect(handle.highlightMove).toHaveBeenLastCalledWith(null);
    expect(host.querySelector('.gcode-viewer-move-tip')).toBeNull();
    pointer(canvas, 'pointerleave', {});
    expect(handle.highlightMove).toHaveBeenLastCalledWith(null);
  });

  it('does not pick while a button is held, because that is a camera drag', () => {
    const { canvas, handle } = mount({ pick: CUT });
    pointer(canvas, 'pointermove', { clientX: 50, clientY: 60, buttons: 1 });
    flushFrames();
    expect(handle.pickMove).not.toHaveBeenCalled();
  });

  it('locates the clicked move, but not at the end of a pan', () => {
    const { canvas, onLocate } = mount({ pick: CUT });
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 100, button: 0 });
    pointer(canvas, 'pointerup', { clientX: 102, clientY: 101, button: 0 });
    expect(onLocate).toHaveBeenCalledWith(CUT);
    onLocate.mockClear();
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 100, button: 0 });
    pointer(canvas, 'pointerup', { clientX: 140, clientY: 100, button: 0 });
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 100, button: 2 });
    pointer(canvas, 'pointerup', { clientX: 100, clientY: 100, button: 2 });
    expect(onLocate).not.toHaveBeenCalled();
  });

  it('stops hovering while the camera moves, but a click still locates', () => {
    const { canvas, handle, onLocate } = mount({ pick: CUT, paused: true });
    pointer(canvas, 'pointermove', { clientX: 50, clientY: 60 });
    flushFrames();
    expect(handle.pickMove).not.toHaveBeenCalled();
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 100, button: 0 });
    pointer(canvas, 'pointerup', { clientX: 100, clientY: 100, button: 0 });
    expect(onLocate).toHaveBeenCalledWith(CUT);
  });

  it('while measuring, clicks set points and the card offers the snapped end', () => {
    const measure = { addPoint: vi.fn(), hover: vi.fn(), clickHint: 'Click to measure from here' };
    const snapped: Viewer3dPick = { ...CUT, vertex: { x: 30, y: 0, z: 0 } };
    const { canvas, onLocate } = mount({ pick: snapped, measure });
    pointer(canvas, 'pointermove', { clientX: 50, clientY: 60 });
    flushFrames();
    expect(measure.hover).toHaveBeenLastCalledWith(snapped);
    const card = host.querySelector('.gcode-viewer-move-tip');
    expect(card?.textContent).toContain('X 30.00');
    expect(card?.textContent).toContain('Click to measure from here (end of move)');
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 100, button: 0 });
    pointer(canvas, 'pointerup', { clientX: 100, clientY: 100, button: 0 });
    expect(measure.addPoint).toHaveBeenCalledWith(snapped);
    expect(onLocate).not.toHaveBeenCalled();
  });

  it('stays quiet while the view is not ready', () => {
    const { canvas, handle, onLocate } = mount({ pick: CUT, enabled: false });
    pointer(canvas, 'pointermove', { clientX: 50, clientY: 60 });
    pointer(canvas, 'pointerdown', { clientX: 100, clientY: 100, button: 0 });
    pointer(canvas, 'pointerup', { clientX: 100, clientY: 100, button: 0 });
    flushFrames();
    expect(handle.pickMove).not.toHaveBeenCalled();
    expect(onLocate).not.toHaveBeenCalled();
  });
});
