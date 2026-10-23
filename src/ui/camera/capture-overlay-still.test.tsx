import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as FrameSource from './frame-source';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { clickControl, mountControl } from '../image-editor/control-audit-test-support';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { resetStore } from '../state/test-helpers';
import { refreshCameraPicture } from './helpers/refresh-picture';
import { useCameraPlacementControls } from './use-camera-placement-controls';

const capture = vi.hoisted(() => vi.fn<typeof FrameSource.captureSourceFrame>());
vi.mock('./frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));
const initialCamera = useCameraStore.getState();
const source = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid',
  frameUrl: 'http://bridge.invalid',
};
const oldFrame = { width: 8, height: 8, data: new Uint8ClampedArray(256) };
const newFrame = { ...oldFrame, data: new Uint8ClampedArray(256).fill(255) };

beforeEach(() => {
  resetStore();
  capture.mockReset();
  useStore.getState().updateDeviceProfile({ cameraModel: savedCameraModel() });
  useCameraStore.setState({ ...initialCamera, sourceState: { kind: 'live', source } });
});
afterEach(() => useCameraStore.setState(initialCamera));

function Controls(): JSX.Element {
  const controls = useCameraPlacementControls(true);
  return (
    <>
      <button onClick={() => void controls.updateStill()}>Refresh</button>
      <button onClick={controls.useLive}>Live</button>
    </>
  );
}

it.each(['panel', 'shortcut'] as const)(
  'lets the newest %s refresh supersede the other entry point',
  async (newest) => {
    let finish!: (frame: RgbaImage) => void;
    capture
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue(newFrame);
    const host = await mountControl(<Controls />);
    let oldRequest: Promise<unknown> | undefined;
    if (newest === 'panel') {
      oldRequest = refreshCameraPicture();
      await clickControl(host, 'Refresh');
    } else {
      await clickControl(host, 'Refresh');
      await act(async () => {
        await refreshCameraPicture();
      });
    }
    await act(async () => {
      finish(oldFrame);
      await oldRequest;
    });
    expect(useCameraStore.getState().overlayStill).toBe(newFrame);
  },
);

it('Live abandons an in-flight capture even when the held picture was already null', async () => {
  let finish!: (frame: RgbaImage) => void;
  capture.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const host = await mountControl(<Controls />);
  await clickControl(host, 'Refresh');
  await clickControl(host, 'Live');
  await act(async () => finish(oldFrame));
  expect(useCameraStore.getState().overlayStill).toBeNull();
});
