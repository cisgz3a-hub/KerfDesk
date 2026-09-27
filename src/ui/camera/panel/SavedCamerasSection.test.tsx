import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { cameraSourceIdWithoutCredentials } from '../../../core/camera/camera-capture-binding';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { clickElement, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { savePhoneCamera } from '../../state/camera-preference-storage';
import { useCameraStore, type CameraSourceState } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { activeCameraModel, ownCameraModel } from '../active-camera-model';
import { SavedCamerasSection } from './SavedCamerasSection';

const FINGERPRINT = `hmac-sha256:${'c'.repeat(64)}`;
const FALCON_URL = 'http://192.168.10.1:8080/snapshot';

const overhead = savedCameraModel(binding('usb', 'overhead-cam'));
const builtIn = savedCameraModel(binding('machine-jpeg', FALCON_URL));

function binding(
  sourceKind: CameraCaptureBinding['sourceKind'],
  sourceId: string,
): CameraCaptureBinding {
  return {
    version: 1,
    sourceKind,
    sourceId,
    ...(sourceKind === 'usb' ? {} : { queryFingerprint: FINGERPRINT }),
    width: 1280,
    height: 960,
    resizeMode: sourceKind === 'usb' ? 'none' : 'unknown',
  };
}

function usbLive(sourceId: string): CameraSourceState {
  return {
    kind: 'live',
    source: {
      kind: 'usb',
      stream: { stream: {} as MediaStream, sourceId, resizeMode: 'none', stop: vi.fn() },
    },
  };
}

const falconLive: CameraSourceState = {
  kind: 'live',
  source: {
    kind: 'machine-jpeg',
    cameraUrl: FALCON_URL,
    frameUrl: 'http://127.0.0.1:1/frame.jpg',
    queryFingerprint: FINGERPRINT,
  },
};

function saveBoth(): void {
  useStore.getState().updateDeviceProfile({ cameraModel: overhead, otherCameraModels: [builtIn] });
}

function forgetButtons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.textContent === 'Forget',
  );
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  useCameraStore.setState({
    sourceState: { kind: 'idle' },
    cameras: [{ deviceId: 'overhead-cam', label: 'Overhead 4K' }],
  });
});

afterEach(() => {
  useCameraStore.setState({ sourceState: { kind: 'idle' }, cameras: [] });
});

describe('the model in use follows the running camera', () => {
  it('uses each camera’s own calibration', () => {
    saveBoth();
    const { device } = useStore.getState().project;
    expect(activeCameraModel(device, falconLive)).toBe(builtIn);
    expect(activeCameraModel(device, usbLive('overhead-cam'))).toBe(overhead);
    expect(activeCameraModel(device, { kind: 'idle' })).toBe(overhead);
  });

  it('reports no calibration of its own for an uncalibrated camera', () => {
    saveBoth();
    const { device } = useStore.getState().project;
    expect(ownCameraModel(device, usbLive('laptop-lid'))).toBeUndefined();
    // Consumers still get the newest, which then says it belongs to another camera.
    expect(activeCameraModel(device, usbLive('laptop-lid'))).toBe(overhead);
  });
});

describe('SavedCamerasSection', () => {
  it('lists every calibrated camera and marks the one running', async () => {
    saveBoth();
    useCameraStore.setState({ sourceState: falconLive });
    const host = await mountControl(<SavedCamerasSection />);
    const items = [...host.querySelectorAll('li')].map((item) => item.textContent);
    expect(items[0]).toContain('Overhead 4K');
    expect(items[0]).not.toContain('in use');
    expect(items[1]).toContain('Machine camera at 192.168.10.1:8080 · in use');
    expect(host.textContent).toContain('Start any of these cameras');
  });

  it('forgets one calibration as one undo step', async () => {
    saveBoth();
    const host = await mountControl(<SavedCamerasSection />);
    await clickElement(forgetButtons(host)[0] ?? null);
    expect(useStore.getState().project.device.cameraModel).toBe(builtIn);
    expect(useStore.getState().project.device.otherCameraModels).toBeUndefined();
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.device.cameraModel).toBe(overhead);
    expect(useStore.getState().project.device.otherCameraModels).toEqual([builtIn]);
  });

  it('stays hidden with one calibration of the running camera', async () => {
    useStore.getState().updateDeviceProfile({ cameraModel: builtIn });
    useCameraStore.setState({ sourceState: falconLive });
    const host = await mountControl(<SavedCamerasSection />);
    expect(host.textContent).toBe('');
  });

  it('names a phone camera’s calibration as the phone’s (ADR-448)', async () => {
    savePhoneCamera({ app: 'ip-webcam', address: '192.168.1.50' });
    const phone = savedCameraModel(binding('machine-jpeg', 'http://192.168.1.50:8080/shot.jpg'));
    useStore.getState().updateDeviceProfile({ cameraModel: phone, otherCameraModels: [builtIn] });
    const host = await mountControl(<SavedCamerasSection />);
    expect(host.textContent).toContain('Phone camera at 192.168.1.50:8080');
    expect(host.textContent).toContain('Machine camera at 192.168.10.1:8080');
  });

  it('explains a running camera that is not the calibrated one', async () => {
    useStore.getState().updateDeviceProfile({ cameraModel: builtIn });
    useCameraStore.setState({ sourceState: usbLive('overhead-cam') });
    const host = await mountControl(<SavedCamerasSection />);
    expect(host.textContent).toContain('Machine camera at 192.168.10.1:8080');
    expect(host.textContent).toContain('The running camera has no calibration of its own yet.');
  });

  it('keeps phone credentials out of saved calibration labels and titles', async () => {
    const address = 'http://operator:first@secret-tail@192.168.1.50/frame?token=secret#private';
    savePhoneCamera({ app: 'other', address });
    const phone = savedCameraModel(
      binding('machine-jpeg', cameraSourceIdWithoutCredentials(address)),
    );
    useStore.getState().updateDeviceProfile({ cameraModel: phone, otherCameraModels: [builtIn] });
    const host = await mountControl(<SavedCamerasSection />);
    expect(host.textContent).toContain('Phone camera at 192.168.1.50');
    expect(host.innerHTML).not.toMatch(/operator|secret|token|private/);
  });
});
