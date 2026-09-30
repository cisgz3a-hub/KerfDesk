import { act } from 'react';
import type * as FrameSource from './frame-source';
import { beforeEach, expect, it, vi } from 'vitest';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { lookAt, savedCameraModel } from '../../core/camera/model/model-fixtures';
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
        cameraModel: {
          ...savedCameraModel({
            version: 1,
            sourceKind: 'usb',
            sourceId: 'audit-usb',
            width: 8,
            height: 8,
            resizeMode: 'none',
          }),
          // An 8 × 8 px camera 20 mm above the middle of the 8 × 8 mm bed.
          lens: {
            intrinsics: { fx: 20, fy: 20, cx: 4, cy: 4 },
            distortion: [0, 0, 0, 0],
            imageWidth: 8,
            imageHeight: 8,
          },
          pose: lookAt([4, 4, -20], [4, 4.001, 0]),
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

it('offers the accuracy map only for a calibration saved with its rings, and toggles it', async () => {
  camera.setState({ accuracyMapVisible: false });
  const bare = await mountControl(<OverlayControls />);
  expect(bare.textContent).not.toContain('Accuracy map');
  const device = useStore.getState().project.device;
  const model = device.cameraModel;
  if (model === undefined) throw new Error('fixture has a camera model');
  await act(async () =>
    useStore.getState().updateDeviceProfile({
      cameraModel: {
        ...model,
        accuracy: { ...model.accuracy, marks: [{ x: 2, y: 2, dxMm: 0.1, dyMm: 0 }] },
      },
    }),
  );
  await clickControl(bare, 'Accuracy map off');
  expect(camera.getState().accuracyMapVisible).toBe(true);
  await clickControl(bare, 'Accuracy map on');
  expect(camera.getState().accuracyMapVisible).toBe(false);
});

it('keeps a cleared material-height draft separate from the stored camera correction', async () => {
  camera.setState({ surfaceHeightMm: 12.5 });
  const host = await mountControl(<OverlayControls />);
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Material surface height above bed"]',
  );
  if (input === null) throw new Error('Material height input missing');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const type = async (value: string): Promise<void> => {
    await act(async () => {
      input.focus();
      setValue?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await type('');
  expect(input.value).toBe('');
  expect(camera.getState().surfaceHeightMm).toBe(12.5);
  await type('0.5');
  expect(camera.getState().surfaceHeightMm).toBe(0.5);
  await type('');
  await act(async () => input.blur());
  expect(input.value).toBe('0.5');
  expect(camera.getState().surfaceHeightMm).toBe(0.5);
  await type('501');
  expect(input.value).toBe('501');
  expect(camera.getState().surfaceHeightMm).toBe(500);
  await act(async () => input.blur());
  expect(input.value).toBe('500');
});
