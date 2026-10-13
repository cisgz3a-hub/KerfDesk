import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Vec2 } from '../../core/scene';
import { buildCanvasMarkerPlan } from '../state/canvas-motion-plan';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { CanvasStartPoints } from './CanvasStartPoints';
import { computeView } from './view-transform';
import { layoutStartHandles, type StartLayoutRect } from './canvas-start-layout';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const SIZE = { width: 348, height: 348 };
const ZOOM = { x: 100, y: 308, width: 236, height: 28 };
const SETTINGS = { x: 232, y: 272, width: 104, height: 28 };
const LABEL = { width: 70, height: 18 };
let host: HTMLDivElement;
let root: Root;

function rectangle(rect: StartLayoutRect): DOMRect {
  return {
    ...rect,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => ({}),
  };
}

function Harness(props: { readonly screenPoint: Vec2 }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const project = useStore((state) => state.project);
  const viewState = { zoomFactor: 1, panX: 0, panY: 0 };
  const view = computeView(
    SIZE.width,
    SIZE.height,
    project.device.bedWidth,
    project.device.bedHeight,
    viewState,
  );
  const point = {
    x: (props.screenPoint.x - view.offsetX) / view.scale,
    y: (props.screenPoint.y - view.offsetY) / view.scale,
  };
  const plan = {
    ...buildCanvasMarkerPlan({
      prepared: { ok: true, project, job: { groups: [] }, jobOriginOffset: { x: 0, y: 0 } },
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
    }),
    framePerimeter: [point],
    jobStart: point,
  };
  return (
    <>
      <canvas ref={canvas} width={SIZE.width} height={SIZE.height} />
      <CanvasStartPoints
        canvas={canvas}
        project={project}
        view={viewState}
        size={SIZE}
        overlay={{ plan, run: null }}
      />
      <div role="group" aria-label="Zoom">
        <button type="button">Zoom in</button>
      </div>
    </>
  );
}

beforeEach(() => {
  resetStore();
  useStore.setState({ project: createProject() });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches('[aria-label="Zoom"]')) return rectangle(ZOOM);
    if (this.matches('.lf-start-settings')) return rectangle(SETTINGS);
    if (this.matches('.lf-start-label')) return rectangle({ x: 0, y: 0, ...LABEL });
    return rectangle({ x: 0, y: 0, ...SIZE });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function boxes(button: HTMLButtonElement) {
  const anchor = button.parentElement;
  const label = button.querySelector<HTMLElement>('.lf-start-label');
  if (anchor === null || label === null) throw new Error('Missing marker DOM');
  const handle = {
    x: parseFloat(anchor.style.left) + parseFloat(button.style.left) - 12,
    y: parseFloat(anchor.style.top) + parseFloat(button.style.top) - 12,
    width: 24,
    height: 24,
  };
  return {
    handle,
    label: {
      x: handle.x + parseFloat(label.style.left),
      y: handle.y + parseFloat(label.style.top),
      ...LABEL,
    },
    anchor,
  };
}

function expectInside(rect: StartLayoutRect): void {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(SIZE.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(SIZE.height);
}

function expectSeparate(a: StartLayoutRect, b: StartLayoutRect): void {
  expect(
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
  ).toBe(true);
}

describe('start marker DOM layout', () => {
  it('keeps both draggable controls outside text hit regions without covering chrome', () => {
    const text = { x: 160, y: 200, width: 130, height: 35 };
    const handles = layoutStartHandles(
      { frame: { x: 180, y: 220 }, job: { x: 194, y: 226 } },
      SIZE,
      [ZOOM, SETTINGS],
      [text],
    );
    expect(Object.values(handles)).toHaveLength(2);
    for (const handle of Object.values(handles)) {
      expectInside(handle);
      expectSeparate(handle, text);
      expectSeparate(handle, ZOOM);
      expectSeparate(handle, SETTINGS);
    }
    expectSeparate(handles.frame!, handles.job!);
  });

  it('keeps handles accessible when zoomed text fills the entire viewport', () => {
    const handles = layoutStartHandles(
      { frame: { x: 180, y: 220 }, job: { x: 194, y: 226 } },
      SIZE,
      [ZOOM, SETTINGS],
      [{ x: -500, y: -500, width: 2000, height: 2000 }],
    );
    expect(Object.values(handles)).toHaveLength(2);
    for (const handle of Object.values(handles)) {
      expectInside(handle);
      expectSeparate(handle, ZOOM);
      expectSeparate(handle, SETTINGS);
    }
    expectSeparate(handles.frame!, handles.job!);
  });

  it('omits markers whose true point is outside the visible viewport', async () => {
    await act(async () => root.render(<Harness screenPoint={{ x: -50, y: 100 }} />));
    expect(host.querySelectorAll('.lf-start-handle')).toHaveLength(0);
  });
  it.each([
    { x: 0, y: 0 },
    { x: 348, y: 0 },
    { x: 0, y: 348 },
    { x: 348, y: 348 },
  ])('keeps both hover/focus label boxes inside the viewport at $x,$y', async (screenPoint) => {
    await act(async () => root.render(<Harness screenPoint={screenPoint} />));
    for (const button of host.querySelectorAll<HTMLButtonElement>('.lf-start-handle')) {
      await act(async () => button.focus());
      expect(document.activeElement).toBe(button);
      const layout = boxes(button);
      expectInside(layout.handle);
      expectInside(layout.label);
    }
  });

  it('moves fitted bottom-right handles clear of measured chrome and connects to the true point', async () => {
    const screenPoint = { x: 324, y: 324 };
    await act(async () => root.render(<Harness screenPoint={screenPoint} />));
    const handles = [...host.querySelectorAll<HTMLButtonElement>('.lf-start-handle')].map(boxes);
    expect(handles).toHaveLength(2);
    expectSeparate(handles[0]!.handle, handles[1]!.handle);
    for (const { handle, label, anchor } of handles) {
      expectSeparate(handle, ZOOM);
      expectSeparate(handle, SETTINGS);
      expectSeparate(label, ZOOM);
      expectSeparate(label, SETTINGS);
      expect(parseFloat(anchor.style.left)).toBe(screenPoint.x);
      expect(parseFloat(anchor.style.top)).toBe(screenPoint.y);
      const connector = anchor.querySelector<HTMLElement>('.lf-start-connector');
      expect(connector?.style.transform).toBe(
        `rotate(${Math.atan2(handle.y + 12 - screenPoint.y, handle.x + 12 - screenPoint.x)}rad)`,
      );
      expect(parseFloat(connector?.style.width ?? '')).toBeCloseTo(
        Math.hypot(handle.x + 12 - screenPoint.x, handle.y + 12 - screenPoint.y),
      );
    }
    let clicks = 0;
    host
      .querySelector('[aria-label="Zoom"] button')
      ?.addEventListener('click', () => (clicks += 1));
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom"] button')?.click();
    expect(clicks).toBe(1);
  });
});
