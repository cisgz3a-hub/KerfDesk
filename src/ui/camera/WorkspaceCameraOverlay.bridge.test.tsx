// Rolling audit v13 Y4-P1-2 (ADR-440 Amendment 10): a 4K RTSP camera's overlay
// was sampled and uploaded about 30 times a second, changed or not, holding
// the UI thread 97 % of a job. Now each new picture, decoded off the UI
// thread, is drawn once. jsdom has no WebGL2, so a stand-in renderer records
// each draw, and the test delivers the feed's pictures itself.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { cameraCaptureBindingForFrame } from './frame-source';
import type { BedOverlayUniforms } from './overlay/bed-overlay-shader';
import type * as FrameFeed from './overlay/machine-frame-feed';
import { WorkspaceCameraOverlay } from './WorkspaceCameraOverlay';

const gl = vi.hoisted(() => ({
  draws: [] as Array<{ source: unknown; uniforms: BedOverlayUniforms | undefined }>,
}));
vi.mock('./overlay/bed-overlay-renderer', () => ({
  createBedOverlayRenderer: () => ({
    draw: (source: unknown, _w: number, _h: number, passes: ReadonlyArray<BedOverlayUniforms>) =>
      gl.draws.push({ source, uniforms: passes[0] }),
    clear: () => undefined,
    dispose: () => undefined,
    lost: false,
  }),
}));
const feed = vi.hoisted(() => ({
  onFrame: null as null | ((frame: { bitmap: ImageBitmap; width: number; height: number }) => void),
  displayWidth: 0,
  starts: 0,
}));
vi.mock('./overlay/machine-frame-feed', async (importOriginal) => {
  const real = await importOriginal<typeof FrameFeed>();
  return {
    ...real,
    startMachineFrameFeed: (
      source: { kind: string },
      options: Parameters<typeof real.startMachineFrameFeed>[1],
    ) => {
      if (source.kind === 'usb') return null;
      feed.onFrame = options.onFrame;
      feed.displayWidth = options.displayWidth();
      feed.starts += 1;
      return () => {
        feed.onFrame = null;
      };
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RTSP = {
  kind: 'machine-rtsp' as const,
  frameUrl: 'http://127.0.0.1:9/frame.jpg',
  previewUrl: 'http://127.0.0.1:9/preview.mjpg',
  sourceId: 'rtsp://127.0.0.1/stub',
  queryFingerprint: `hmac-sha256:${'b'.repeat(64)}`,
  liveness: { kind: 'unmonitored', advisory: 'stub' },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gl.draws.length = 0;
  feed.starts = 0;
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    toJSON: () => ({}),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('a bridge camera on the overlay', () => {
  it('draws each new picture once, from the decoded bitmap, and not on a timer', () => {
    vi.useFakeTimers();
    const source = RTSP as unknown as Parameters<typeof cameraCaptureBindingForFrame>[0];
    const project = createProject();
    useStore.setState({
      project: {
        ...project,
        device: {
          ...project.device,
          bedWidth: 400,
          bedHeight: 400,
          cameraModel: savedCameraModel(cameraCaptureBindingForFrame(source, 1280, 720)),
        },
      },
    });
    useCameraStore.setState({
      overlayVisible: true,
      overlayStill: null,
      bedPicture: null,
      sourceState: { kind: 'live', source },
    });
    act(() => root.render(<WorkspaceCameraOverlay />));
    expect(feed.starts).toBe(1);
    expect(feed.displayWidth).toBeLessThanOrEqual(1920);
    expect(gl.draws).toHaveLength(0);
    const first = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      feed.onFrame?.({ bitmap: first, width: 1280, height: 720 });
    });
    expect(gl.draws).toHaveLength(1);
    expect(gl.draws[0]?.source).toBe(first);
    expect(gl.draws[0]?.uniforms?.uFrameSize).toEqual([1280, 720]);
    // No new picture: nothing more is uploaded, however long it waits.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(gl.draws).toHaveLength(1);
    const second = { close: vi.fn() } as unknown as ImageBitmap;
    act(() => {
      feed.onFrame?.({ bitmap: second, width: 1280, height: 720 });
    });
    expect(gl.draws).toHaveLength(2);
    expect(first.close).toHaveBeenCalled();
  });
});
