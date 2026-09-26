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
import type { BedOverlayUniforms } from './overlay/bed-overlay-shader';
import { WorkspaceCameraOverlay } from './WorkspaceCameraOverlay';

type Draw = { readonly source: unknown; readonly uniforms: BedOverlayUniforms };
const gl = vi.hoisted(() => ({ available: true, draws: [] as Draw[], clears: 0 }));
vi.mock('./overlay/bed-overlay-renderer', () => ({
  createBedOverlayRenderer: () =>
    gl.available
      ? {
          draw: (source: unknown, _w: number, _h: number, uniforms: BedOverlayUniforms) =>
            gl.draws.push({ source, uniforms }),
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
    surfaceHeightMm: 12,
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

function saveModel(): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, cameraModel: savedCameraModel(USB) } },
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

  it('renders nothing when the overlay is hidden', () => {
    saveModel();
    useCameraStore.setState({ overlayStill: still(), overlayVisible: false });
    render();
    expect(container.innerHTML).toBe('');
  });

  it('draws a still through the model at its own size, the surface height and the workspace view', () => {
    saveModel();
    useCameraStore.setState({
      overlayStill: still(),
      overlayStillCapture: { ...USB, width: 640, height: 360 },
    });
    render();
    const drawn = gl.draws.at(-1)?.uniforms;
    const view = computeView(BOX.width, BOX.height, 400, 400, {
      zoomFactor: 1.5,
      panX: 20,
      panY: -10,
    });
    expect(drawn?.uFrameSize).toEqual([640, 360]);
    expect(drawn?.uFocal[0]).toBeCloseTo(wideLens().intrinsics.fx / 2, 9);
    expect(drawn?.uSurfaceZ).toBe(-12);
    expect(drawn?.uOpacity).toBeCloseTo(0.6, 9);
    expect(drawn?.uViewScale).toBeCloseTo(view.scale, 9);
    expect(drawn?.uViewOffset).toEqual([view.offsetX, view.offsetY]);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('redraws when the material height changes', () => {
    saveModel();
    useCameraStore.setState({ overlayStill: still() });
    render();
    act(() => useCameraStore.setState({ surfaceHeightMm: 30 }));
    expect(gl.draws.at(-1)?.uniforms.uSurfaceZ).toBe(-30);
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
    expect(gl.draws.at(-1)?.uniforms.uFrameSize).toEqual([1280, 720]);
  });

  it('explains when the browser cannot draw the corrected picture', () => {
    gl.available = false;
    saveModel();
    useCameraStore.setState({ overlayStill: still() });
    render();
    expect(container.textContent).toContain('WebGL2');
  });
});
