import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { useStore } from '../state';
import { useCameraStore as camera } from '../state/camera-store';
import { resetStore } from '../state/test-helpers';
import { NetworkCameraView } from './NetworkCameraView';

beforeEach(() => {
  resetStore();
  camera.getState().resetAlignment();
  camera.setState({ overlayVisible: false });
});

it('cancels corner collection, retries failed alignment and saves a four-click homography to the device', async () => {
  const host = await mountControl(
    <NetworkCameraView
      frameUrl="http://bridge.invalid/frame"
      cameraUrl="http://camera.invalid/frame"
      queryFingerprint={undefined}
    />,
  );
  const image = host.querySelector('img')!;
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } });
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 300,
    right: 400,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  await act(async () => image.dispatchEvent(new Event('load')));
  await clickControl(host, 'Align to bed');
  expect(camera.getState().alignment.kind).toBe('collecting');
  await clickControl(host, 'Cancel');
  expect(camera.getState().alignment.kind).toBe('idle');
  await act(async () => camera.setState({ alignment: { kind: 'failed', reason: 'degenerate' } }));
  await clickControl(host, 'Align to bed');
  expect(camera.getState().alignment.kind).toBe('collecting');
  for (const [clientX, clientY] of [
    [0, 0],
    [400, 0],
    [400, 300],
    [0, 300],
  ] as const) {
    await act(async () =>
      image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY })),
    );
  }
  expect(camera.getState().alignment.kind).toBe('aligned');
  await clickControl(host, 'Save alignment');
  expect(host.textContent).toContain('Use this camera, then Update still.');
  expect(host.textContent).toContain('Turn Overlay on if the image is hidden.');
  expect(camera.getState().overlayVisible).toBe(false);
  expect(useStore.getState().project.device.cameraAlignment).toMatchObject({
    basis: 'raw',
    frameWidth: 400,
    frameHeight: 300,
    planeHeightMm: 0,
    capture: { sourceId: 'http://camera.invalid/frame' },
  });
  expect(control(host, 'Alignment saved').disabled).toBe(true);
  await clickControl(host, 'Re-align');
  expect(camera.getState().alignment.kind).toBe('idle');
});
