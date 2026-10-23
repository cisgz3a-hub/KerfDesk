import { afterEach, beforeEach, expect, it } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { refreshCameraPicture } from './refresh-picture';

const initialCamera = useCameraStore.getState();
const source = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid/frame',
  frameUrl: 'http://bridge.invalid/frame',
};
const frame = { width: 8, height: 8, data: new Uint8ClampedArray(256) };

beforeEach(() => {
  resetStore();
  useStore.getState().updateDeviceProfile({ cameraModel: savedCameraModel() });
  useCameraStore.setState({ ...initialCamera, sourceState: { kind: 'live', source } });
});
afterEach(() => useCameraStore.setState(initialCamera));

it('keeps the newest requested picture when an older capture finishes last', async () => {
  let finish!: (value: RgbaImage) => void;
  const old = refreshCameraPicture(() => new Promise((resolve) => (finish = resolve)));
  const newer = { ...frame, data: new Uint8ClampedArray(256).fill(255) };
  expect(await refreshCameraPicture(async () => newer)).toBe('refreshed');
  finish(frame);
  expect(await old).toBe('superseded');
  expect(useCameraStore.getState().overlayStill).toBe(newer);
});

it('does not revive an older request when the newest capture fails', async () => {
  let finish!: (value: RgbaImage) => void;
  const old = refreshCameraPicture(() => new Promise((resolve) => (finish = resolve)));
  expect(await refreshCameraPicture(async () => null)).toBe('failed');
  finish(frame);
  expect(await old).toBe('superseded');
  expect(useCameraStore.getState().overlayStill).toBeNull();
});

it.each(['document', 'source', 'visibility'] as const)(
  'does not publish after %s changes, even when the old state returns',
  async (change) => {
    let finish!: (value: RgbaImage) => void;
    const pending = refreshCameraPicture(() => new Promise((resolve) => (finish = resolve)));
    if (change === 'document') {
      const epoch = useStore.getState().projectDocumentEpoch;
      useStore.setState({ projectDocumentEpoch: epoch + 1 });
    } else if (change === 'source') {
      useCameraStore.setState({ sourceState: { kind: 'idle' } });
      useCameraStore.setState({ sourceState: { kind: 'live', source } });
    } else {
      useCameraStore.getState().setOverlayVisible(true);
      useCameraStore.getState().setOverlayVisible(false);
    }
    finish(frame);
    await pending;
    expect(useCameraStore.getState().overlayStill).toBeNull();
    expect(useCameraStore.getState().placementActive).toBe(false);
  },
);
