// The calibration wizard's screens (ADR-441): the setup can engrave or skip,
// the engrave step waits for its own job, the photo step reports what went
// wrong, and a result is always saveable, rough or not (ADR-228).

import { act } from 'react';
import type * as CalibrationActions from './calibration-actions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { engraveCalibrationTarget, photographTarget } from './calibration-actions';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
  type CalibrationResult,
} from './camera-calibration-store';

vi.mock('./calibration-actions', async (original) => ({
  ...(await original<typeof CalibrationActions>()),
  engraveCalibrationTarget: vi.fn(),
  photographTarget: vi.fn(),
}));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));

const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'overhead',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};

function result(overrides: Partial<CalibrationResult> = {}): CalibrationResult {
  return {
    record: savedCameraModel(),
    markErrors: [{ x: 45, y: 45, dxMm: 0.05, dyMm: -0.02, rejected: false }],
    bedImage: null,
    cameraHeightSigmaMm: 2,
    usedMeasuredHeight: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
  vi.mocked(engraveCalibrationTarget).mockReset();
  vi.mocked(photographTarget).mockReset();
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraCalibrationStore.getState().openWizard();
  useCameraStore.setState({ sourceState: { kind: 'idle' }, sourceEpoch: 0, overlayVisible: false });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
});

describe('camera calibration wizard', () => {
  it('needs a connection to engrave but can go straight to the photo', async () => {
    await mountControl(<CameraCalibrationWizard />);
    expect(document.body.textContent).toContain('100 small rings');
    expect(control(document.body, 'Engrave target').disabled).toBe(true);
    await clickControl(document.body, 'Target already engraved');
    expect(useCameraCalibrationStore.getState().step).toEqual({
      kind: 'photo',
      status: { kind: 'idle' },
    });
    expect(control(document.body, 'Take photo').disabled).toBe(true);
  });

  it('waits for the target job to start and finish before the photo', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } });
    // A finished earlier job must not count as the target.
    const earlierJob = { status: 'done', total: 1, completed: 1 } as never;
    useLaserStore.setState({ streamer: earlierJob });
    let start!: (started: boolean) => void;
    vi.mocked(engraveCalibrationTarget).mockReturnValue(
      new Promise((resolve) => (start = resolve)),
    );
    await mountControl(<CameraCalibrationWizard />);
    await clickControl(document.body, 'Engrave target');
    expect(useCameraCalibrationStore.getState().step).toEqual({
      kind: 'engraving',
      started: false,
      earlierJob,
    });
    await act(async () => start(true));
    expect(useCameraCalibrationStore.getState().step).toEqual({
      kind: 'engraving',
      started: true,
      earlierJob,
    });
    await act(async () =>
      useLaserStore.setState({ streamer: { status: 'running', total: 4, completed: 1 } as never }),
    );
    expect(document.body.textContent).toContain('Engraving the target 25%');
    await act(async () =>
      useLaserStore.setState({ streamer: { status: 'done', total: 4, completed: 4 } as never }),
    );
    expect(useCameraCalibrationStore.getState().step.kind).toBe('photo');
  });

  it('returns to setup when the target job does not start or stops', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } });
    vi.mocked(engraveCalibrationTarget).mockResolvedValue(false);
    await mountControl(<CameraCalibrationWizard />);
    await clickControl(document.body, 'Engrave target');
    expect(document.body.textContent).toContain('The target was not engraved.');

    vi.mocked(engraveCalibrationTarget).mockResolvedValue(true);
    await clickControl(document.body, 'Engrave target');
    await act(async () =>
      useLaserStore.setState({
        streamer: { status: 'cancelled', total: 4, completed: 2 } as never,
      }),
    );
    expect(document.body.textContent).toContain('did not finish engraving (cancelled)');
  });

  it('shows why a photo failed and lets the operator try again', async () => {
    useCameraStore.setState({ sourceState: { kind: 'live', source } });
    vi.mocked(photographTarget).mockResolvedValue({
      kind: 'failed',
      message: 'No rings were found.',
    });
    useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } });
    await mountControl(<CameraCalibrationWizard />);
    await clickControl(document.body, 'Take photo');
    expect(document.body.textContent).toContain('No rings were found.');
    expect(control(document.body, 'Take photo').disabled).toBe(false);
  });

  it('saves the fitted camera to the machine profile and shows it on the canvas', async () => {
    useCameraStore.setState({ sourceState: { kind: 'live', source } });
    vi.mocked(photographTarget).mockResolvedValue({ kind: 'ok', result: result() });
    useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } });
    await mountControl(<CameraCalibrationWizard />);
    await clickControl(document.body, 'Take photo');
    expect(document.body.textContent).toContain('Accurate enough for placing artwork by eye.');
    expect(document.body.textContent).toContain('96 of 100');
    await clickControl(document.body, 'Save calibration');
    expect(useStore.getState().project.device.cameraModel).toEqual(savedCameraModel());
    expect(useCameraStore.getState().overlayVisible).toBe(true);
    expect(useCameraCalibrationStore.getState().open).toBe(false);
  });

  it('keeps a rough result saveable and asks for the camera height when the photo could not tell it', async () => {
    const rough = savedCameraModel();
    useCameraStore.setState({ sourceState: { kind: 'live', source } });
    vi.mocked(photographTarget).mockResolvedValue({
      kind: 'ok',
      result: result({
        record: { ...rough, accuracy: { ...rough.accuracy, rmsErrorMm: 1.4 } },
        cameraHeightSigmaMm: 60,
      }),
    });
    useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } });
    await mountControl(<CameraCalibrationWizard />);
    await clickControl(document.body, 'Take photo');
    expect(document.body.textContent).toContain('disagree by more than half a millimetre');
    expect(document.body.textContent).toContain('Measure the lens height above the bed');
    expect(control(document.body, 'Save calibration').disabled).toBe(false);
    await clickControl(document.body, 'Save calibration');
    expect(useStore.getState().project.device.cameraModel?.accuracy.rmsErrorMm).toBe(1.4);
  });

  it('keeps a field being retyped instead of snapping back, and treats an empty camera height as not measured', async () => {
    await mountControl(<CameraCalibrationWizard />);
    const thickness = document.body.querySelector<HTMLInputElement>('input[title^="Thickness"]')!;
    const height = document.body.querySelector<HTMLInputElement>('input[placeholder="optional"]')!;
    await typeInto(thickness, '');
    expect(thickness.value).toBe('');
    expect(useCameraCalibrationStore.getState().settings.sheetThicknessMm).toBe(3);
    await typeInto(thickness, '6');
    expect(useCameraCalibrationStore.getState().settings.sheetThicknessMm).toBe(6);
    await typeInto(height, '410');
    expect(useCameraCalibrationStore.getState().settings.cameraHeightMm).toBe(410);
    await typeInto(height, '');
    expect(useCameraCalibrationStore.getState().settings.cameraHeightMm).toBeNull();
  });
});

describe('camera calibration photo ownership', () => {
  it.each(['document', 'profile', 'source', 'source-round-trip', 'settings'] as const)(
    'retires a pending photo when its %s changes',
    async (change) => {
      const pending = await takePendingPhoto();
      await act(async () => changePhotoContext(change));
      const before = useStore.getState();
      expect(pending.signal.aborted).toBe(true);
      expect(useCameraCalibrationStore.getState().step).toEqual({
        kind: 'photo',
        status: { kind: 'idle' },
      });
      await pending.finish();
      expect(useCameraCalibrationStore.getState().step.kind).toBe('photo');
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useCameraStore.getState().overlayVisible).toBe(false);
    },
  );

  it('does not save an old result after the profile changes, even before React updates the button', async () => {
    const pending = await takePendingPhoto();
    await pending.finish();
    const save = control(document.body, 'Save calibration');
    let afterChange = useStore.getState();
    await act(async () => {
      useStore.getState().updateDeviceProfile({ bedWidth: 800, bedHeight: 600 });
      afterChange = useStore.getState();
      save.click();
    });
    expect(useStore.getState().project).toBe(afterChange.project);
    expect(useStore.getState().undoStack).toBe(afterChange.undoStack);
    expect(useStore.getState().project.device.cameraModel).toBeUndefined();
    expect(useCameraStore.getState().overlayVisible).toBe(false);
    expect(useCameraCalibrationStore.getState().open).toBe(true);
    expect(useCameraCalibrationStore.getState().step.kind).toBe('photo');
  });

  it('keeps the same pending photo across minimize and expand, then saves it', async () => {
    const pending = await takePendingPhoto();
    await clickControl(document.body, 'Minimize');
    expect(pending.signal.aborted).toBe(false);
    await clickControl(document.body, 'Expand');
    expect(pending.signal.aborted).toBe(false);
    await pending.finish();
    await clickControl(document.body, 'Save calibration');
    expect(useStore.getState().project.device.cameraModel).toEqual(savedCameraModel());
    expect(photographTarget).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'close'] as const)(
    'drops a delayed result after %s and keeps the newer review',
    async (action) => {
      const old = await takePendingPhoto();
      await clickControl(document.body, action === 'cancel' ? 'Cancel' : 'Close Calibrate camera');
      if (action === 'close') {
        await act(async () => useCameraCalibrationStore.getState().openWizard());
        await clickControl(document.body, 'Target already engraved');
      }
      vi.mocked(photographTarget).mockResolvedValueOnce({ kind: 'ok', result: result() });
      await clickControl(document.body, 'Take photo');
      const newer = useCameraCalibrationStore.getState().step;
      expect(newer.kind).toBe('result');
      await old.finish();
      expect(old.signal.aborted).toBe(true);
      expect(useCameraCalibrationStore.getState().step).toBe(newer);
      await clickControl(document.body, 'Save calibration');
      expect(useStore.getState().project.device.cameraModel).toEqual(savedCameraModel());
    },
  );
});

async function takePendingPhoto() {
  let resolve!: (outcome: Awaited<ReturnType<typeof photographTarget>>) => void;
  vi.mocked(photographTarget).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  useCameraStore.setState({ sourceState: { kind: 'live', source } });
  useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } });
  await mountControl(<CameraCalibrationWizard />);
  await clickControl(document.body, 'Take photo');
  return {
    signal: vi.mocked(photographTarget).mock.calls[0]![0].signal!,
    finish: async () => {
      await act(async () => resolve({ kind: 'ok', result: result() }));
    },
  };
}

function changePhotoContext(
  change: 'document' | 'profile' | 'source' | 'source-round-trip' | 'settings',
): void {
  if (change === 'document') useStore.getState().newProject();
  if (change === 'profile')
    useStore.getState().updateDeviceProfile({ bedWidth: 800, bedHeight: 600 });
  if (change === 'source')
    useCameraStore.setState({ sourceEpoch: 1, sourceState: { kind: 'idle' } });
  if (change === 'source-round-trip') {
    const original = useCameraStore.getState().sourceState;
    useCameraStore.setState({ sourceState: { kind: 'idle' } });
    useCameraStore.setState({ sourceState: original });
  }
  if (change === 'settings')
    useCameraCalibrationStore.getState().updateSettings({ sheetThicknessMm: 10 });
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
