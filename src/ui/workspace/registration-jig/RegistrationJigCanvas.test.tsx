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
import { fitJigCanvasView } from './jig-canvas-view';
import { RegistrationJigCanvas } from './RegistrationJigCanvas';

vi.mock('../draw-scene', () => ({ drawScene: vi.fn() }));
vi.mock('../use-canvas-bitmap-size', () => ({
  useCanvasBitmapSize: () => ({ width: 800, height: 600 }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let project: Project;
const commit = vi.fn();

beforeEach(() => {
  commit.mockClear();
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

function Harness(): JSX.Element {
  const [selectedIds, onSelectionChange] = useState<ReadonlySet<string>>(new Set());
  return (
    <RegistrationJigCanvas
      project={project}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      onCommit={commit}
    />
  );
}

function pointer(type: string, x: number, y: number, state?: ViewState): void {
  const canvas = host.querySelector('canvas')!;
  const view = computeView(800, 600, project.device.bedWidth, project.device.bedHeight, state);
  const event = new MouseEvent(type, {
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
});
