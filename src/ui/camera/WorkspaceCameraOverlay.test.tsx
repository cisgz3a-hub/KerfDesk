// DOM tests for the workspace overlay wiring (ADR-440): nothing without a
// saved camera model or when hidden; a still or the live element is drawn
// through the model with the workspace view; a frame the model cannot place
// says why instead of drawing a misplaced picture. jsdom has no WebGL2, so a
// stand-in renderer records each draw.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraCaptureBinding } from '../../core/camera/camera-capture-binding';
import { savedCameraModel, wideLens } from '../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useUiStore } from '../state/ui-store';
import { computeView } from '../workspace/view-transform';
import type { LiveCaptureElement } from './frame-capture';
import { cameraCaptureBindingForFrame } from './frame-source';
import type { BedOverlayUniforms } from './overlay/bed-overlay-shader';
import { usePieceScanStore } from './pieces/piece-scan-store';
import { WorkspaceCameraOverlay } from './WorkspaceCameraOverlay';

type Draw = {
  readonly source: unknown;
  /** The first pass: the whole bed at the material height. */
  readonly uniforms: BedOverlayUniforms | undefined;
  readonly passes: ReadonlyArray<BedOverlayUniforms>;
};
const gl = vi.hoisted(() => ({ available: true, draws: [] as Draw[], clears: 0 }));
vi.mock('./overlay/bed-overlay-renderer', () => ({
  createBedOverlayRenderer: () =>
    gl.available
      ? {
          draw: (
            source: unknown,
            _w: number,
            _h: number,
            passes: ReadonlyArray<BedOverlayUniforms>,
          ) => gl.draws.push({ source, uniforms: passes[0], passes }),
          clear: () => {
            gl.clears += 1;
          },
          dispose: () => undefined,
          lost: false,
        }
      : null,
}));
const liveElement = vi.hoisted(() => ({ current: null as LiveCaptureElement | null }));
vi.mock('./CameraSourceView', async () => {
  const { useEffect } = await import('react');
  return {
    CameraSourceView: (props: { onElement?: (element: LiveCaptureElement | null) => void }) => {
      const { onElement } = props;
      useEffect(() => {
        onElement?.(liveElement.current);
        return () => onElement?.(null);
      }, [onElement]);
      return null;
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BOX = { width: 800, height: 600 };
const USB: CameraCaptureBinding = {
  version: 1,
  sourceKind: 'usb',
  sourceId: 'overhead',
  width: 1280,
  height: 720,
  resizeMode: 'none',
};

// Half the calibrated resolution, same 16:9 shape.
function still(width = 640, height = 360): RgbaImage {
  return { data: new Uint8ClampedArray(width * height * 4).fill(200), width, height };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gl.available = true;
  gl.draws.length = 0;
  gl.clears = 0;
  liveElement.current = null;
  // jsdom cannot measure layout; give the overlay box the canvas area's size.
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...BOX,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: BOX.width,
    bottom: BOX.height,
    toJSON: () => ({}),
  });
  const project = createProject();
  useStore.setState({
    project: { ...project, device: { ...project.device, bedWidth: 400, bedHeight: 400 } },
  });
  useUiStore.setState({ zoomFactor: 1.5, panX: 20, panY: -10 });
  useCameraStore.setState({
    overlayVisible: true,
    overlayOpacityPercent: 60,
    overlayStill: null,
    overlayStillCapture: null,
    bedPicture: null,
    surfaceHeightMm: 12,
    heightAreas: [],
    accuracyMapVisible: false,
    sourceState: { kind: 'idle' },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function saveModel(capture: CameraCaptureBinding = USB): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, cameraModel: savedCameraModel(capture) } },
  });
}

function render(): void {
  act(() => root.render(<WorkspaceCameraOverlay />));
}

describe('WorkspaceCameraOverlay', () => {
  it('renders nothing without a saved camera model', () => {
    useCameraStore.setState({ overlayStill: still() });
    render();
    expect(container.innerHTML).toBe('');
  });

  it('draws a head camera’s stitched picture without a camera model (ADR-449)', () => {
    const image = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
    useCameraStore.setState({
      bedPicture: { image, region: { x: 10, y: 10, width: 4, height: 4 }, surfaceHeightMm: 0 },
    });
    render();
    expect(container.querySelector('canvas')).not.toBeNull();
    // A still taken afterwards replaces it.
    useCameraStore.getState().setOverlayStill(still());
    expect(useCameraStore.getState().bedPicture).toBeNull();
  });

  it('renders nothing when the overlay is hidden', () => {
    saveModel();
    useCameraStore.setState({ overlayStill: still(), overlayVisible: false });
    render();
    expect(container.innerHTML).toBe('');
  });

  it.each([360, 361])(
    'draws a resized still at 640 × %s within the model aspect tolerance',
    (height) => {
      saveModel();
      useCameraStore.setState({
        overlayStill: still(640, height),
        overlayStillCapture: { ...USB, width: 640, height },
      });
      render();
      const drawn = gl.draws.at(-1)?.uniforms;
      const view = computeView(BOX.width, BOX.height, 400, 400, {
        zoomFactor: 1.5,
        panX: 20,
        panY: -10,
      });
      expect(drawn?.uFrameSize).toEqual([640, height]);
      expect(drawn?.uFocal[0]).toBeCloseTo(wideLens().intrinsics.fx / 2, 9);
      expect(drawn?.uSurfaceZ).toBe(-12);
      expect(drawn?.uOpacity).toBeCloseTo(0.6, 9);
      expect(drawn?.uViewScale).toBeCloseTo(view.scale, 9);
      expect(drawn?.uViewOffset).toEqual([view.offsetX, view.offsetY]);
      expect(container.querySelector('[role="status"]')).toBeNull();
    },
  );

  it('draws the accuracy map over the picture only when it is switched on', () => {
    const model = savedCameraModel(USB);
    const withRings = {
      ...model,
      accuracy: { ...model.accuracy, marks: [{ x: 25, y: 25, dxMm: 0.1, dyMm: 0 }] },
    };
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, device: { ...project.device, cameraModel: withRings } },
    });
    useCameraStore.setState({ overlayStill: still() });
    render();
    expect(container.querySelector('[data-testid="camera-accuracy-map"]')).toBeNull();
    act(() => useCameraStore.getState().setAccuracyMapVisible(true));
    expect(container.querySelectorAll('[data-testid="camera-accuracy-map"] circle')).toHaveLength(
      1,
    );
  });

  it('redraws when the material height changes', () => {
    saveModel();
    useCameraStore.setState({ overlayStill: still() });
    render();
    act(() => useCameraStore.setState({ surfaceHeightMm: 30 }));
    expect(gl.draws.at(-1)?.uniforms?.uSurfaceZ).toBe(-30);
  });

  it('draws each height area as its own pass and outlines it on the canvas', () => {
    saveModel();
    useCameraStore.setState({ overlayStill: still() });
    render();
    expect(gl.draws.at(-1)?.passes).toHaveLength(1);
    expect(container.querySelector('[data-testid="camera-height-areas"]')).toBeNull();
    act(() =>
      useCameraStore.getState().addHeightArea({
        id: 'box',
        x: 40,
        y: 60,
        width: 100,
        height: 80,
        surfaceHeightMm: 35,
      }),
    );
    const passes = gl.draws.at(-1)?.passes ?? [];
    expect(passes.map((pass) => pass.uSurfaceZ)).toEqual([-12, -35]);
    expect(passes[1]?.uClip).toEqual([40, 60, 140, 140]);
    const outline = container.querySelector('[data-testid="camera-height-areas"]');
    expect(outline?.querySelectorAll('rect')).toHaveLength(1);
    expect(outline?.textContent).toBe('Area 1: 35 mm');
  });

  it('outlines found pieces, the ones left out faint and dashed', () => {
    saveModel();
    useCameraStore.setState({ overlayStill: still() });
    render();
    expect(container.querySelector('[data-testid="camera-piece-outlines"]')).toBeNull();
    const piece = (x: number, partial: boolean) => ({
      outline: [
        { x: x - 40, y: 75 },
        { x: x + 40, y: 75 },
        { x: x + 40, y: 125 },
        { x: x - 40, y: 125 },
      ],
      rect: { centre: { x, y: 100 }, axisDeg: 0, length: 80, width: 50 },
      areaMm2: 4000,
      centroid: { x, y: 100 },
      shape: 'oblong' as const,
      headingDeg: null,
      partial,
    });
    act(() => usePieceScanStore.getState().setPieces([piece(100, false), piece(250, true)]));
    const outlines = container.querySelector('[data-testid="camera-piece-outlines"]');
    const groups = [...(outlines?.querySelectorAll('g') ?? [])];
    expect(groups.map((g) => g.getAttribute('data-included'))).toEqual(['true', 'false']);
    expect(groups[1]?.querySelector('polygon')?.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(outlines?.textContent).toBe('12');
    act(() => usePieceScanStore.getState().clear());
  });

  it('says why a still of another shape or from another camera is not drawn', () => {
    saveModel();
    useCameraStore.setState({ overlayStill: still(400, 400) });
    render();
    expect(gl.draws).toHaveLength(0);
    expect(container.textContent).toContain('a different shape from the 1280 × 720');

    act(() =>
      useCameraStore.setState({
        overlayStill: still(),
        overlayStillCapture: { ...USB, sourceId: 'laptop-lid' },
      }),
    );
    expect(gl.draws).toHaveLength(0);
    expect(container.textContent).toContain('belongs to a different camera');
  });

  it('draws the live camera element when there is no still', () => {
    saveModel();
    const video = document.createElement('video');
    Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
    liveElement.current = video;
    const stream = {
      stream: {} as MediaStream,
      sourceId: 'overhead',
      resizeMode: 'none' as const,
      stop: vi.fn(),
    };
    useCameraStore.setState({ sourceState: { kind: 'live', source: { kind: 'usb', stream } } });
    render();
    expect(gl.draws.at(-1)?.source).toBe(video);
    expect(gl.draws.at(-1)?.uniforms?.uFrameSize).toEqual([1280, 720]);
  });

  it('does not draw another channel at the same redacted camera URL', () => {
    const capture = (channel: number) =>
      cameraCaptureBindingForFrame(
        {
          kind: 'machine-jpeg',
          cameraUrl: `http://camera/frame.jpg?channel=${channel}`,
          frameUrl: 'http://bridge/frame.jpg',
          queryFingerprint: `hmac-sha256:${String(channel).repeat(64)}`,
        },
        640,
        360,
      );
    const first = capture(1);
    const second = capture(2);
    expect(second.sourceId).toBe(first.sourceId);
    saveModel(first);
    useCameraStore.setState({ overlayStill: still(), overlayStillCapture: second });
    render();
    expect(gl.draws).toHaveLength(0);
    expect(container.textContent).toContain('belongs to a different camera');
    act(() => useCameraStore.setState({ overlayStillCapture: first }));
    expect(gl.draws).toHaveLength(1);
  });

  it('does not resize cropped geometry but still draws the exact calibrated crop', () => {
    const cropped: CameraCaptureBinding = { ...USB, resizeMode: 'crop-and-scale' };
    saveModel();
    useCameraStore.setState({
      overlayStill: still(),
      overlayStillCapture: { ...cropped, width: 640, height: 360 },
    });
    render();
    expect(gl.draws).toHaveLength(0);
    expect(container.textContent).toContain('crop differs');
    act(() => {
      saveModel(cropped);
      useCameraStore.setState({ overlayStill: still(1280, 720), overlayStillCapture: cropped });
    });
    expect(gl.draws.at(-1)?.uniforms?.uFrameSize).toEqual([1280, 720]);
  });

  it.each(['saved', 'current'] as const)(
    'reports unverifiable network identity when the %s fingerprint is absent',
    (missing) => {
      const unverified: CameraCaptureBinding = {
        ...USB,
        sourceKind: 'machine-jpeg',
        sourceId: 'http://camera/frame.jpg',
      };
      const verified = { ...unverified, queryFingerprint: `hmac-sha256:${'a'.repeat(64)}` };
      saveModel(missing === 'saved' ? unverified : verified);
      useCameraStore.setState({
        overlayStill: still(1280, 720),
        overlayStillCapture: missing === 'current' ? unverified : verified,
      });
      render();
      expect(gl.draws).toHaveLength(0);
      expect(container.textContent).toContain('camera resource cannot be verified');
    },
  );

  it('explains when the browser cannot draw the corrected picture', () => {
    gl.available = false;
    saveModel();
    useCameraStore.setState({ overlayStill: still() });
    render();
    expect(container.textContent).toContain('WebGL2');
  });
});
