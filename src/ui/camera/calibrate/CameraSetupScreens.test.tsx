// The guided camera setup's first screens (ADR-663): pick the camera, say
// where it is mounted, and check its picture before the target is engraved.

import { act } from 'react';
import type * as FrameSource from '../frame-source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraAdapter, CameraStream, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import {
  clickControl,
  clickElement,
  control,
  mountControl,
} from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
} from './camera-calibration-store';

const capture = vi.hoisted(() => vi.fn());
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));

const initial = useCameraStore.getState();
const machine = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid/frame',
  frameUrl: 'http://bridge.invalid/frame',
};
const found = {
  kind: 'found' as const,
  cameraUrl: machine.cameraUrl,
  proxyFrameUrl: machine.frameUrl,
};

function platform(camera?: CameraAdapter): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
    ...(camera === undefined ? {} : { camera }),
  };
}

async function mountWizard(camera?: CameraAdapter): Promise<void> {
  await mountControl(
    <PlatformProvider adapter={platform(camera)}>
      <CameraCalibrationWizard />
    </PlatformProvider>,
  );
}

function flatFrame(width: number, height: number, value: number) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(value) };
}

beforeEach(() => {
  resetStore();
  capture.mockReset();
  useCameraStore.setState(initial);
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraCalibrationStore.getState().openSetup();
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
  useCameraStore.getState().stopSource();
  useCameraStore.setState(initial);
});

describe('the camera screen', () => {
  it("uses the laser's own camera in one click and then goes on", async () => {
    useCameraStore.setState({ machineCamera: found });
    await mountWizard();
    expect(document.body.textContent).toContain('1 · Camera');
    expect(document.body.textContent).toContain('Found on your laser.');
    expect(control(document.body, 'Next').disabled).toBe(true);
    await clickControl(document.body, 'Use this camera');
    expect(useCameraStore.getState().sourceState).toEqual({ kind: 'live', source: machine });
    expect(document.body.textContent).toContain('In use');
    expect(document.body.textContent).toContain("In use: Laser's built-in camera");
    await clickControl(document.body, 'Next');
    expect(useCameraCalibrationStore.getState().step).toEqual({ kind: 'mount' });
  });

  it('says how to bring a laser camera that was not found, and looks again', async () => {
    useCameraStore.setState({ machineCamera: { kind: 'not-found' } });
    const detect = vi.spyOn(useCameraStore.getState(), 'detectMachineCamera');
    await mountWizard();
    expect(document.body.textContent).toContain('Connect the laser by USB, power it on');
    await clickControl(document.body, 'Look again');
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('lists each USB camera by name and starts the one picked', async () => {
    const stream: CameraStream = {
      stream: {} as MediaStream,
      sourceId: 'side',
      resizeMode: 'none',
      stop: vi.fn(),
    };
    const openStream = vi.fn<CameraAdapter['openStream']>().mockResolvedValue(stream);
    const camera: CameraAdapter = {
      isSupported: () => true,
      listCameras: async () => [
        { deviceId: 'lid', label: 'Laptop camera' },
        { deviceId: 'side', label: 'Overhead webcam' },
      ],
      openStream,
      discoverNetworkCamera: async () => null,
    };
    useCameraStore.setState({ isSupported: true, machineCamera: { kind: 'not-found' } });
    await mountWizard(camera);
    expect(document.body.textContent).toContain('Laptop camera');
    expect(document.body.textContent).toContain('Overhead webcam');
    const overhead = [...document.body.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Use this camera',
    )[1];
    await clickElement(overhead ?? null);
    expect(useCameraStore.getState().selectedDeviceId).toBe('side');
    expect(openStream).toHaveBeenCalledWith('side');
    expect(useCameraStore.getState().sourceState).toMatchObject({ kind: 'live' });
    expect(control(document.body, 'Next').disabled).toBe(false);
  });
});

describe('the picture screen', () => {
  beforeEach(() => {
    const project = useStore.getState().project;
    useStore.setState({
      project: { ...project, device: { ...project.device, bedWidth: 400, bedHeight: 400 } },
    });
    useCameraStore.setState({ sourceState: { kind: 'live', source: machine } });
    useCameraCalibrationStore.getState().setStep({ kind: 'picture' });
  });

  it('measures the running camera and says what to fix in a dark picture', async () => {
    capture.mockResolvedValue(flatFrame(64, 48, 20));
    await mountWizard();
    expect(capture).toHaveBeenCalledWith(machine);
    expect(document.body.textContent).toContain('The picture is dark.');
    expect(document.body.textContent).toContain('Nothing washed out.');
    // 400 mm over 64 px: a coarse picture, with the advice to choose a larger size.
    expect(document.body.textContent).toContain('64 × 48 picture');
    expect(document.body.textContent).toContain('A larger picture size');
  });

  it('passes a good picture and always lets the operator go on', async () => {
    capture.mockResolvedValue(flatFrame(1600, 1200, 140));
    await mountWizard();
    expect(document.body.textContent).toContain('Bright enough.');
    expect(document.body.textContent).toContain('at least 0.33 mm');
    expect(document.body.textContent).not.toContain('A larger picture size');
    await clickControl(document.body, 'Next');
    expect(useCameraCalibrationStore.getState().step).toEqual({ kind: 'setup', note: null });
  });

  it('keeps Next when no frame can be read', async () => {
    capture.mockResolvedValue(null);
    await mountWizard();
    expect(document.body.textContent).not.toContain('Bright enough.');
    expect(control(document.body, 'Next').disabled).toBe(false);
  });
});

describe('the mount screen', () => {
  it('sets a head camera from its picture card and goes back to the camera', async () => {
    useCameraCalibrationStore.getState().setStep({ kind: 'mount' });
    await mountWizard();
    const cards = document.body.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Where the camera is mounted"] button',
    );
    expect(cards[0]?.getAttribute('aria-pressed')).toBe('true');
    await clickElement(cards[1] ?? null);
    expect(useCameraCalibrationStore.getState().settings.headCamera).toBe(true);
    await clickControl(document.body, 'Back');
    expect(useCameraCalibrationStore.getState().step).toEqual({ kind: 'camera' });
  });
});
