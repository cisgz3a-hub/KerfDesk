import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  type Project,
} from '../../../core/scene';
import { createRegistrationBox } from '../../../core/shapes';
import { createRectangle } from '../../../core/shapes/primitives';
import { computeView, type ViewState } from '../view-transform';
import { useJigCanvasPaint, type JigCanvasOverlay } from './jig-canvas-paint';
import { fitJigCanvasView } from './jig-canvas-view';
import { RegistrationJigCanvas } from './RegistrationJigCanvas';

vi.mock('../draw-scene', () => ({ drawScene: vi.fn() }));
vi.mock('../use-canvas-bitmap-size', () => ({
  useCanvasBitmapSize: () => ({ width: 800, height: 600 }),
}));
vi.mock('./jig-canvas-paint', () => ({ useJigCanvasPaint: vi.fn() }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let project: Project;
const commit = vi.fn();
const selection = vi.fn();

beforeEach(() => {
  commit.mockClear();
  selection.mockClear();
  vi.mocked(useJigCanvasPaint).mockClear();
  project = {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: 'artwork', color: '#000000' })],
      objects: [
        createRectangle({
          id: 'art',
          color: '#000000',
          spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
        }),
      ],
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
  const canvas = host.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = () => false;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function Harness(props: {
  readonly fitRequest?: number;
  readonly onDropFiles?: (files: ReadonlyArray<File>, outlineId: string | null) => void;
}): JSX.Element {
  const [selectedIds, onSelectionChange] = useState<ReadonlySet<string>>(new Set());
  return (
    <RegistrationJigCanvas
      {...props}
      project={project}
      selectedIds={selectedIds}
      onSelectionChange={(ids) => {
        selection(ids);
        onSelectionChange(ids);
      }}
      onCommit={commit}
    />
  );
}

function jigProject(x: number, y: number): Project {
  return {
    ...project,
    scene: {
      layers: [createRegistrationLayer()],
      objects: [createRegistrationBox({ widthMm: 80, heightMm: 40, x, y })],
    },
  };
}

function stubCanvasGeometry(): HTMLCanvasElement {
  const canvas = host.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  canvas.setPointerCapture = vi.fn();
  canvas.hasPointerCapture = () => false;
  return canvas;
}

function pointer(
  type: string,
  x: number,
  y: number,
  state?: ViewState,
  init: MouseEventInit = {},
): void {
  const canvas = host.querySelector('canvas')!;
  const view = computeView(800, 600, project.device.bedWidth, project.device.bedHeight, state);
  const event = new MouseEvent(type, {
    ...init,
    bubbles: true,
    clientX: view.offsetX + x * view.scale,
    clientY: view.offsetY + y * view.scale,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    canvas.dispatchEvent(event);
  });
}

describe('registration jig canvas drag transactions', () => {
  it('opens fitted to the jig and maps dragging through that zoom', () => {
    project = {
      ...project,
      scene: {
        layers: [createRegistrationLayer()],
        objects: [createRegistrationBox({ widthMm: 80, heightMm: 40, x: 30, y: 60 })],
      },
    };
    act(() => root.render(<Harness key="fitted" />));
    const canvas = host.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    canvas.setPointerCapture = vi.fn();
    canvas.hasPointerCapture = () => false;
    const view = fitJigCanvasView(project, { width: 800, height: 600 });
    pointer('pointerdown', 30, 80, view);
    pointer('pointerup', 35, 82, view);
    expect(commit).toHaveBeenCalledTimes(1);
    const moved = (commit.mock.calls[0]![0] as Project).scene.objects[0]!;
    expect(moved.transform.x).toBeCloseTo(35);
    expect(moved.transform.y).toBeCloseTo(62);
    expect(host.textContent).toContain('Fit jig');
  });

  it('refits to a rebuilt layout once, and keeps the view for ordinary edits', () => {
    project = jigProject(30, 60);
    act(() => root.render(<Harness key="refit" fitRequest={0} />));
    // An ordinary edit elsewhere on the bed does not chase the view: the
    // pointer still maps through the view fitted to the original outline.
    project = jigProject(250, 300);
    act(() => root.render(<Harness key="refit" fitRequest={0} />));
    stubCanvasGeometry();
    const original = fitJigCanvasView(jigProject(30, 60), { width: 800, height: 600 });
    const rebuilt = fitJigCanvasView(project, { width: 800, height: 600 });
    pointer('pointerdown', 250, 320, original);
    pointer('pointerup', 255, 322, original);
    expect(commit).toHaveBeenCalledTimes(1);
    pointer('pointerdown', 250, 320, rebuilt);
    pointer('pointerup', 255, 322, rebuilt);
    expect(commit).toHaveBeenCalledTimes(1);

    // Rebuilding the layout refits once; later renders keep that view.
    act(() => root.render(<Harness key="refit" fitRequest={1} />));
    act(() => root.render(<Harness key="refit" fitRequest={1} />));
    pointer('pointerdown', 250, 320, rebuilt);
    pointer('pointerup', 255, 322, rebuilt);
    expect(commit).toHaveBeenCalledTimes(2);
    const moved = (commit.mock.calls[1]![0] as Project).scene.objects[0]!;
    expect(moved.transform.x).toBeCloseTo(255);
    expect(moved.transform.y).toBeCloseTo(302);
  });

  it('hands dropped artwork files to the editor with the outline under the drop', () => {
    project = jigProject(30, 60);
    const onDropFiles = vi.fn();
    act(() => root.render(<Harness key="drop" onDropFiles={onDropFiles} />));
    const canvas = stubCanvasGeometry();
    const view = computeView(
      800,
      600,
      project.device.bedWidth,
      project.device.bedHeight,
      fitJigCanvasView(project, { width: 800, height: 600 }),
    );
    const drop = (x: number, y: number, files: ReadonlyArray<File>): void => {
      const event = new MouseEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: view.offsetX + x * view.scale,
        clientY: view.offsetY + y * view.scale,
      });
      Object.defineProperty(event, 'dataTransfer', { value: { files, dropEffect: 'none' } });
      act(() => {
        canvas.dispatchEvent(event);
      });
    };
    const logo = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    drop(70, 80, [logo, new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    expect(onDropFiles).toHaveBeenCalledWith([logo], project.scene.objects[0]!.id);
    drop(5, 5, [logo]);
    expect(onDropFiles).toHaveBeenLastCalledWith([logo], null);
    drop(70, 80, [new File(['x'], 'notes.txt')]);
    expect(onDropFiles).toHaveBeenCalledTimes(2);
  });

  it('previews movement locally and commits exactly once on release', () => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 15, 12);
    pointer('pointermove', 20, 14);
    expect(commit).not.toHaveBeenCalled();
    expect(project.scene.objects[0]!.transform.x).toBe(0);
    pointer('pointerup', 20, 14);
    expect(commit).toHaveBeenCalledTimes(1);
    const result = commit.mock.calls[0]![0] as Project;
    expect(result.scene.objects[0]!.transform.x).toBeCloseTo(10);
    expect(result.scene.objects[0]!.transform.y).toBeCloseTo(4);
  });

  it('discards a cancelled drag and makes no change for a click', () => {
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 20, 14);
    pointer('pointercancel', 20, 14);
    expect(commit).not.toHaveBeenCalled();
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 10, 10);
    expect(commit).not.toHaveBeenCalled();
  });

  it('pans with a right-button drag, as the main canvas does, without selecting or editing', () => {
    const before = lastView();
    // The press lands on the artwork; the right button still pans rather than moves it.
    pointer('pointerdown', 10, 10, before, { button: 2 });
    pointer('pointermove', 30, 25, before, { button: 2 });
    pointer('pointerup', 30, 25, before, { button: 2 });
    expect(lastView().panX).toBeCloseTo(before.panX + 20);
    expect(lastView().panY).toBeCloseTo(before.panY + 15);
    expect(commit).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    act(() => void host.querySelector('canvas')!.dispatchEvent(menu));
    expect(menu.defaultPrevented).toBe(true);
  });

  it('zooms with a non-passive native wheel listener so the page does not scroll', () => {
    const add = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    act(() => root.render(<Harness key="wheel" />));
    expect(add).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    const canvas = host.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      clientX: 400,
      clientY: 300,
    });
    act(() => {
      canvas.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
  });
});

function lastOverlay(): JigCanvasOverlay {
  return vi.mocked(useJigCanvasPaint).mock.lastCall![2];
}

function lastView(): ViewState {
  return vi.mocked(useJigCanvasPaint).mock.lastCall![4];
}

function committed(): Project['scene']['objects'][number] {
  expect(commit).toHaveBeenCalledTimes(1);
  return (commit.mock.calls[0]![0] as Project).scene.objects[0]!;
}

function pxToMm(): number {
  return 1 / computeView(800, 600, project.device.bedWidth, project.device.bedHeight).scale;
}

describe('registration jig canvas handles', () => {
  it('resizes from a corner proportionally, previewing until one commit on release', () => {
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 10, 10);
    pointer('pointerdown', 20, 20);
    pointer('pointermove', 26, 22);
    pointer('pointermove', 30, 25);
    expect(commit).not.toHaveBeenCalled();
    pointer('pointerup', 30, 25);
    const resized = committed();
    expect(resized.transform.scaleX).toBeCloseTo(1.5);
    expect(resized.transform.scaleY).toBeCloseTo(1.5);
  });

  it('resizes freely from a corner with Shift held', () => {
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 10, 10);
    pointer('pointerdown', 20, 20);
    pointer('pointerup', 30, 25, undefined, { shiftKey: true });
    const resized = committed();
    expect(resized.transform.scaleX).toBeCloseTo(1.5);
    expect(resized.transform.scaleY).toBeCloseTo(1.25);
  });

  it('rotates with the rotate handle in one commit, and a click on it changes nothing', () => {
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 10, 10);
    const handleY = -24 * pxToMm();
    pointer('pointerdown', 10, handleY);
    pointer('pointerup', 10, handleY);
    expect(commit).not.toHaveBeenCalled();
    pointer('pointerdown', 10, handleY);
    pointer('pointermove', 30, 5);
    pointer('pointerup', 40, 10);
    expect(committed().transform.rotationDeg).toBeCloseTo(90);
  });
});

describe('registration jig canvas box selection', () => {
  function threeSquares(): void {
    const square = (id: string, x: number, locked = false) => ({
      ...createRectangle({
        id,
        color: '#000000',
        spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
        transform: { ...project.scene.objects[0]!.transform, x },
      }),
      locked,
    });
    project = {
      ...project,
      scene: {
        ...project.scene,
        objects: [square('art', 0), square('pinned', 30, true), square('other', 60)],
      },
    };
    act(() => root.render(<Harness key="marquee" />));
    stubCanvasGeometry();
  }

  it('selects what the dragged box encloses, never locked objects, without an edit', () => {
    threeSquares();
    pointer('pointerdown', -5, -5);
    pointer('pointermove', 50, 30);
    expect(lastOverlay().marquee).toEqual({
      start: { x: expect.closeTo(-5), y: expect.closeTo(-5) },
      end: { x: expect.closeTo(50), y: expect.closeTo(30) },
    });
    pointer('pointermove', 85, 25);
    pointer('pointerup', 85, 25);
    expect([...selection.mock.lastCall![0]]).toEqual(['art', 'other']);
    expect(lastOverlay().marquee).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it('adds to the selection with Shift and replaces it without', () => {
    threeSquares();
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 10, 10);
    pointer('pointerdown', 55, -5, undefined, { shiftKey: true });
    pointer('pointerup', 85, 25, undefined, { shiftKey: true });
    expect([...selection.mock.lastCall![0]]).toEqual(['art', 'other']);
    pointer('pointerdown', 55, -5);
    pointer('pointerup', 85, 25);
    expect([...selection.mock.lastCall![0]]).toEqual(['other']);
  });

  it('treats a press on empty canvas that barely moves as a click', () => {
    threeSquares();
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 10, 10);
    pointer('pointerdown', 25, 25);
    pointer('pointerup', 25 + pxToMm(), 25 + pxToMm());
    expect([...selection.mock.lastCall![0]]).toEqual([]);
  });
});

describe('registration jig canvas file drop target', () => {
  it('highlights the outline under files dragged over the canvas', () => {
    project = jigProject(30, 60);
    act(() => root.render(<Harness key="drag-over" onDropFiles={vi.fn()} />));
    const canvas = stubCanvasGeometry();
    const view = computeView(
      800,
      600,
      project.device.bedWidth,
      project.device.bedHeight,
      fitJigCanvasView(project, { width: 800, height: 600 }),
    );
    const drag = (type: string, x: number, y: number, types: ReadonlyArray<string>): void => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: view.offsetX + x * view.scale,
        clientY: view.offsetY + y * view.scale,
      });
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [], types, dropEffect: 'none' },
      });
      act(() => {
        canvas.dispatchEvent(event);
      });
    };
    const outlineId = project.scene.objects[0]!.id;
    drag('dragover', 70, 80, ['Files']);
    expect(lastOverlay().dropOutlineId).toBe(outlineId);
    drag('dragover', 5, 5, ['Files']);
    expect(lastOverlay().dropOutlineId).toBeNull();
    drag('dragover', 70, 80, ['text/plain']);
    expect(lastOverlay().dropOutlineId).toBeNull();
    drag('dragover', 70, 80, ['Files']);
    drag('dragleave', 70, 80, ['Files']);
    expect(lastOverlay().dropOutlineId).toBeNull();
    drag('dragover', 70, 80, ['Files']);
    drag('drop', 70, 80, ['Files']);
    expect(lastOverlay().dropOutlineId).toBeNull();
  });
});
