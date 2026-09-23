import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findRegistrationBoxBounds } from '../../core/scene';
import { WorkspaceCameraOverlay } from '../camera/WorkspaceCameraOverlay';
import { BoardAnchorOverlay } from '../laser/board-capture/BoardAnchorOverlay';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import * as drawing from './draw-scene';
import { canvasMouseToScene } from './view-transform';
import { Workspace } from './Workspace';
import { WorkspaceViewport } from './WorkspaceViewport';

const WIDTH = 800;
const FULL_HEIGHT = 600;
const VIEW = { zoomFactor: 1.25, panX: 12, panY: -8 };
const observers = new Set<ResizeObserverStub>();
let reservedStageHeight = 420;
let host: HTMLDivElement;
let root: Root;

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    observers.add(this);
  }
  disconnect(): void {
    observers.delete(this);
  }
  notify(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetStore();
  reservedStageHeight = 420;
  useLaserStore.setState(initialLaserState());
  useUiStore.setState({ ...VIEW, toolMode: { kind: 'select' }, draftShape: null, penDraft: null });
  useStore.getState().addCapturedBoard({ kind: 'rect', widthMm: 120, heightMm: 80 });
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        bedWidth: 400,
        bedHeight: 400,
        cameraAlignment: {
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          frameWidth: 4,
          frameHeight: 4,
          basis: 'raw',
          alignedAt: 0,
          planeHeightMm: 0,
        },
      },
    },
  });
  // A saved synthetic still only: no capture source, media stream or machine.
  useCameraStore.setState({
    overlayVisible: true,
    overlayOpacityPercent: 50,
    overlayStill: { data: new Uint8ClampedArray(64).fill(200), width: 4, height: 4 },
    overlayStillCapture: null,
    surfaceHeightMm: 0,
    sourceState: { kind: 'idle' },
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const insideStageCell = this.closest('.lf-workspace-stage, .lf-workspace-accessories') !== null;
    const height =
      insideStageCell && useStore.getState().previewMode ? reservedStageHeight : FULL_HEIGHT;
    return rect(height);
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  expect(observers.size).toBe(0);
  useCameraStore.setState({ overlayStill: null, overlayVisible: false });
  resetStore();
  useUiStore.setState({ zoomFactor: 1, panX: 0, panY: 0 });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps artwork, camera and board coordinates on the resized stage while Preview reserves its dock', async () => {
  const draw = vi.spyOn(drawing, 'drawScene');
  const project = useStore.getState().project;
  await act(async () =>
    root.render(
      <WorkspaceViewport content={<Workspace />}>
        <WorkspaceCameraOverlay />
        <BoardAnchorOverlay
          geometry={{ kind: 'rect', origin: { x: 0, y: 0 }, widthMm: 120, heightMm: 80 }}
          activeTarget={null}
          disabled
          onSelect={() => undefined}
        />
      </WorkspaceViewport>,
    ),
  );
  const base = baseCanvas();
  const stage = host.querySelector('.lf-workspace-stage');
  const accessories = host.querySelector('.lf-workspace-accessories');
  const viewport = host.querySelector('.lf-workspace-canvas-area');
  expect(stage).not.toBeNull();
  expect(accessories?.parentElement).toBe(viewport);
  expect(stage?.closest('.lf-workspace-canvas-area')).toBe(viewport);
  expect(base.parentElement).toBe(stage);
  expect(cameraCanvas().parentElement?.parentElement).toBe(accessories);
  expect(boardOverlay().parentElement).toBe(accessories);
  assertSharedCoordinates(FULL_HEIGHT);
  expect(host.querySelector('.lf-preview-dock')).toBeNull();

  await act(async () => useStore.setState({ previewMode: true }));
  await resizeStage(420);
  const dock = host.querySelector('.lf-preview-dock');
  expect(dock?.parentElement).toBe(stage?.parentElement);
  expect(stage?.contains(dock)).toBe(false);
  expect(accessories?.contains(dock)).toBe(false);
  assertSharedCoordinates(420);
  expect(draw.mock.calls.at(-1)?.slice(1, 3)).toEqual([WIDTH, 420]);

  // Expanding preview details can change the dock height without a window resize.
  await resizeStage(320);
  assertSharedCoordinates(320);
  expect(draw.mock.calls.at(-1)?.slice(1, 3)).toEqual([WIDTH, 320]);

  await act(async () => useStore.setState({ previewMode: false }));
  await resizeStage(FULL_HEIGHT);
  expect(host.querySelector('.lf-preview-dock')).toBeNull();
  expect(baseCanvas()).toBe(base);
  assertSharedCoordinates(FULL_HEIGHT);
  expect(draw.mock.calls.at(-1)?.slice(1, 3)).toEqual([WIDTH, FULL_HEIGHT]);
  expect(useUiStore.getState()).toMatchObject(VIEW);
  expect(useStore.getState().project).toBe(project);
});

it('preserves accessory state and source lifetime when design and G-code content replace each other', async () => {
  const mount = vi.fn();
  const stopSource = vi.fn();
  const renderView = async (showGcode: boolean): Promise<void> => {
    await act(async () =>
      root.render(
        <WorkspaceViewport
          content={
            showGcode ? <div className="lf-workspace-stage">G-code fixture</div> : <Workspace />
          }
        >
          <StatefulAccessory mount={mount} stopSource={stopSource} />
        </WorkspaceViewport>,
      ),
    );
  };
  await renderView(false);
  const accessory = host.querySelector<HTMLButtonElement>('[data-testid="capture-point"]');
  if (accessory === null) throw new Error('Missing fixture accessory');
  await act(async () => accessory.click());
  expect(accessory.textContent).toBe('Captured points: 1');

  await renderView(true);
  expect(host.querySelector('canvas[aria-label$=" workspace"]')).toBeNull();
  expect(host.querySelector('[data-testid="capture-point"]')).toBe(accessory);
  expect(accessory.textContent).toBe('Captured points: 1');
  await renderView(false);
  expect(baseCanvas()).not.toBeNull();
  expect(host.querySelector('[data-testid="capture-point"]')).toBe(accessory);
  expect(accessory.textContent).toBe('Captured points: 1');
  expect(mount).toHaveBeenCalledOnce();
  expect(stopSource).not.toHaveBeenCalled();
});

function StatefulAccessory({
  mount,
  stopSource,
}: {
  readonly mount: () => void;
  readonly stopSource: () => void;
}): JSX.Element {
  const [capturedPoints, setCapturedPoints] = useState(0);
  useEffect(() => {
    mount();
    return stopSource;
  }, [mount, stopSource]);
  return (
    <button data-testid="capture-point" onClick={() => setCapturedPoints((count) => count + 1)}>
      Captured points: {capturedPoints}
    </button>
  );
}

async function resizeStage(height: number): Promise<void> {
  reservedStageHeight = height;
  await act(async () => {
    for (const observer of [...observers]) observer.notify();
  });
}

function assertSharedCoordinates(height: number): void {
  const base = baseCanvas();
  expect([base.width, base.height]).toEqual([WIDTH, height]);
  // Independent fit calculation for a 400 mm square bed and its 30 px rulers/margin.
  const scale = ((height - 60) / 400) * VIEW.zoomFactor;
  const offsetX = (WIDTH - 400 * scale) / 2 + VIEW.panX * scale;
  const offsetY = (height - 400 * scale) / 2 + VIEW.panY * scale;
  const matrix = cameraCanvas().style.transform.slice(9, -1).split(',').map(Number);
  expect(matrix[0]).toBeCloseTo(scale, 8);
  expect(matrix[5]).toBeCloseTo(scale, 8);
  expect(matrix[12]).toBeCloseTo(offsetX, 8);
  expect(matrix[13]).toBeCloseTo(offsetY, 8);
  const corner = boardOverlay().querySelector<HTMLButtonElement>('[data-board-anchor="top-right"]');
  const bounds = findRegistrationBoxBounds(useStore.getState().project.scene);
  if (corner === null || bounds === null) throw new Error('Missing board reference corner');
  expect(Number.parseFloat(corner.style.left)).toBeCloseTo(offsetX + bounds.maxX * scale, 8);
  expect(Number.parseFloat(corner.style.top)).toBeCloseTo(offsetY + bounds.minY * scale, 8);
  const scenePoint = canvasMouseToScene(
    {
      clientX: 10 + offsetX + 80 * scale,
      clientY: 20 + offsetY + 60 * scale,
    } as React.MouseEvent<HTMLCanvasElement>,
    base,
    useStore.getState().project,
    VIEW,
  );
  expect(scenePoint?.x).toBeCloseTo(80, 8);
  expect(scenePoint?.y).toBeCloseTo(60, 8);
}

function baseCanvas(): HTMLCanvasElement {
  const base = host.querySelector<HTMLCanvasElement>('canvas[aria-label$=" workspace"]');
  if (base === null) throw new Error('Missing workspace canvas');
  return base;
}

function cameraCanvas(): HTMLCanvasElement {
  const still = [...host.querySelectorAll('canvas')].find((canvas) =>
    canvas.style.transform.startsWith('matrix3d'),
  );
  if (still === undefined) throw new Error('Missing saved camera still');
  return still;
}

function boardOverlay(): HTMLElement {
  const overlay = host.querySelector<HTMLElement>('[aria-label="Board verification points"]');
  if (overlay === null) throw new Error('Missing board overlay');
  return overlay;
}

function rect(height: number): DOMRect {
  return {
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 810,
    bottom: 20 + height,
    width: WIDTH,
    height,
    toJSON: () => ({}),
  };
}
