import { act } from 'react';
import type * as FrameSource from './frame-source';
import { beforeEach, expect, it, vi } from 'vitest';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { useStore } from '../state';
import { useCameraStore as camera } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { resetStore } from '../state/test-helpers';
import { OverlayControls } from './OverlayControls';

const capture = vi.hoisted(() => vi.fn());
vi.mock('./frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));
vi.mock('./png-encode', () => ({ rgbaToPngDataUrl: () => 'data:image/png;base64,audit' }));
const frame = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'audit-usb',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};
beforeEach(() => {
  resetStore();
  capture.mockReset();
  capture.mockResolvedValue(frame);
  camera.setState({
    sourceState: { kind: 'idle' },
    overlayVisible: false,
    overlayStill: null,
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        bedWidth: 8,
        bedHeight: 8,
        homing: { ...project.device.homing, enabled: false },
        cameraAlignment: {
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          frameWidth: 8,
          frameHeight: 8,
          basis: 'raw',
          alignedAt: 0,
          planeHeightMm: 0,
          capture: {
            version: 1,
            sourceKind: 'usb',
            sourceId: 'audit-usb',
            width: 8,
            height: 8,
            resizeMode: 'none',
          },
        },
      },
    },
  });
  useLaserStore.setState({ trustedPositionEpoch: 7 });
  useUiStore.setState({ imageDialog: null });
});

it('toggles the actual overlay, freezes a frame, returns to Live and exits placement without changing origin', async () => {
  useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
  const host = await mountControl(<OverlayControls />);
  expect(control(host, 'Update still').disabled).toBe(true);
  expect(control(host, 'Live').disabled).toBe(true);
  expect(control(host, 'Trace from camera').disabled).toBe(true);
  await clickControl(host, 'Overlay off');
  expect(camera.getState()).toMatchObject({ overlayVisible: true, placementActive: true });
  await clickControl(host, 'Confirm bed coordinates');
  expect(camera.getState().confirmedPositionEpoch).toBe(7);
  await clickControl(host, 'Overlay on');
  expect(camera.getState()).toMatchObject({ overlayVisible: false, placementActive: true });
  await act(async () => camera.setState({ sourceState: { kind: 'live', source } }));
  await clickControl(host, 'Update still');
  expect(capture).toHaveBeenCalledWith(source);
  expect(camera.getState().overlayStill).toBe(frame);
  await clickControl(host, 'Live');
  expect(camera.getState().overlayStill).toBeNull();
  await clickControl(host, 'Exit camera placement');
  expect(camera.getState()).toMatchObject({
    overlayVisible: false,
    placementActive: false,
    confirmedPositionEpoch: null,
  });
  expect(useStore.getState().jobPlacement).toEqual({ startFrom: 'user-origin', anchor: 'center' });
});

it('camera Trace captures at the input boundary and opens a bed-sized source in the normal trace dialog', async () => {
  camera.setState({ sourceState: { kind: 'live', source } });
  const host = await mountControl(<OverlayControls />);
  await clickControl(host, 'Trace from camera');
  expect(capture).toHaveBeenCalledWith(source);
  expect(useUiStore.getState().imageDialog).toMatchObject({
    sourceOrigin: 'camera-capture',
    source: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 }, pixelWidth: 32, pixelHeight: 32 },
  });
  expect(camera.getState().placementActive).toBe(true);
});
