import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CalibrationActions from './calibration-actions';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { clickControl, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { CalibrateCameraControls } from './CalibrateCameraControls';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import { engraveCalibrationTarget, photographTarget } from './calibration-actions';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
} from './camera-calibration-store';

vi.mock('./calibration-actions', async (original) => ({
  ...(await original<typeof CalibrationActions>()),
  engraveCalibrationTarget: vi.fn(),
  photographTarget: vi.fn(),
}));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));

beforeEach(() => {
  resetStore();
  vi.mocked(engraveCalibrationTarget).mockReset();
  vi.mocked(photographTarget).mockReset();
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraCalibrationStore.getState().closeWizard();
  useCameraStore.setState({
    sourceState: {
      kind: 'live',
      source: {
        kind: 'usb',
        stream: {
          stream: {} as MediaStream,
          sourceId: 'overhead',
          resizeMode: 'none',
          stop: vi.fn(),
        },
      },
    },
    sourceEpoch: 0,
    overlayVisible: true,
    placementActive: true,
  });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
  useCameraStore.setState({ overlayVisible: false, placementActive: false });
});

describe('Check camera without a saved target layout', () => {
  it('asks for the original layout or a new target without replacing a valid calibration', async () => {
    const saved = savedCameraModel();
    useStore.getState().updateDeviceProfile({ cameraModel: saved });
    const before = useStore.getState();
    await mountControl(
      <>
        <CalibrateCameraControls />
        <CameraCalibrationWizard />
      </>,
    );
    await clickControl(document.body, 'Check camera…');

    expect(useCameraCalibrationStore.getState()).toMatchObject({
      mode: 'calibrate',
      step: { kind: 'setup' },
      targetArea: null,
    });
    expect(document.body.textContent).toContain('target layout was not saved');
    expect(document.body.textContent).toContain('exact original margins');
    expect(
      [...document.body.querySelectorAll('button')].some((b) => b.textContent === 'Take photo'),
    ).toBe(false);
    expect(photographTarget).not.toHaveBeenCalled();
    expect(engraveCalibrationTarget).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().dirty).toBe(before.dirty);
    expect(useStore.getState().project.device.cameraModel).toBe(saved);
    expect(useCameraStore.getState()).toMatchObject({
      overlayVisible: true,
      placementActive: true,
    });
  });
});
