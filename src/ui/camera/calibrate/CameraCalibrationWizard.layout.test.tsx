// Which target "Target already engraved" looks for (ADR-441 Amendment 4): the
// one engraved from this computer, even after a restart resets the wizard's
// settings; the layout it assumes is always shown; and a photo that looks
// like a target engraved with other settings never suggests saving over the
// saved calibration.

import { act } from 'react';
import type * as CalibrationActions from './calibration-actions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { bedTargetLayout } from '../../../core/camera/target/bed-target';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { photographTarget } from './calibration-actions';
import { CalibrateCameraControls } from './CalibrateCameraControls';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
  type CalibrationResult,
} from './camera-calibration-store';
import { rememberEngravedTarget } from './engraved-target-memory';

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
const ENGRAVED_AREA = { x: 20, y: 20, width: 360, height: 360 };

beforeEach(() => {
  localStorage.clear();
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, bedWidth: 400, bedHeight: 400 } },
  });
  vi.mocked(photographTarget).mockReset();
  vi.mocked(photographTarget).mockResolvedValue({ kind: 'failed', message: 'No rings.' });
  // As after a restart: the wizard's settings are back to their defaults.
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraCalibrationStore.getState().closeWizard();
  useCameraStore.setState({ sourceState: { kind: 'live', source }, sourceEpoch: 0 });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
});

describe('Target already engraved', () => {
  it('looks for the target engraved from this computer after a restart', async () => {
    rememberEngravedTarget(useStore.getState().project.device, false, {
      area: ENGRAVED_AREA,
      bedWidthMm: 400,
      bedHeightMm: 400,
      layoutMm: 20,
      engravedAt: '2026-09-29T08:00:00.000Z',
    });
    await mountControl(<CalibrateCameraControls />);
    await clickControl(document.body, 'Calibrate camera…');
    expect(useCameraCalibrationStore.getState().settings.marginMm).toBe(20);
    expect(document.body.textContent).toContain(
      'Target already engraved looks for the target engraved from this computer on',
    );
    expect(document.body.textContent).toContain('360 × 360 mm with a 20 mm margin');
    await clickControl(document.body, 'Target already engraved');
    expect(document.body.textContent).toContain(
      'Looking for the target engraved from this computer',
    );
    await clickControl(document.body, 'Take photo');
    expect(photographTarget).toHaveBeenCalledWith(expect.objectContaining({ area: ENGRAVED_AREA }));
  });

  it('shows the layout the settings describe when nothing was engraved here, and follows a new margin', async () => {
    await mountControl(<CalibrateCameraControls />);
    await clickControl(document.body, 'Calibrate camera…');
    expect(document.body.textContent).toContain(
      'Target already engraved looks for a target laid out by these settings: 390 × 390 mm with a 5 mm margin on a 400 × 400 mm bed. If it was engraved with another margin, enter that margin first.',
    );
    await act(async () => useCameraCalibrationStore.getState().updateSettings({ marginMm: 20 }));
    expect(document.body.textContent).toContain('360 × 360 mm with a 20 mm margin');
    await clickControl(document.body, 'Target already engraved');
    await clickControl(document.body, 'Take photo');
    expect(photographTarget).toHaveBeenCalledWith(expect.objectContaining({ area: ENGRAVED_AREA }));
  });
});

describe('a photo that looks like a target engraved with other settings', () => {
  it('suggests keeping the saved calibration instead of saving over it', async () => {
    const saved = savedCameraModel();
    await act(async () => useStore.getState().updateDeviceProfile({ cameraModel: saved }));
    // Matched to a 10 × 10 layout, the rings fill only 9 × 9 of it, and the
    // camera sees where the missing column and row would be.
    const area = { x: 5, y: 5, width: 390, height: 390 };
    const layout = bedTargetLayout({ area });
    const lastCol = Math.max(...layout.marks.map((m) => m.col));
    const lastRow = Math.max(...layout.marks.map((m) => m.row));
    const marks = layout.marks
      .filter((m) => m.col !== lastCol && m.row !== lastRow)
      .map((m) => ({ x: m.x, y: m.y, dxMm: 0.02, dyMm: -0.01 }));
    const record = {
      ...saved,
      accuracy: { ...saved.accuracy, foundMarks: 81, targetArea: area, marks },
    };
    const drift = { rmsMm: 28.3, maxMm: 28.5, meanDxMm: 20, meanDyMm: 20, marks: 81 };
    const result: CalibrationResult = {
      record,
      markErrors: [],
      bedImage: null,
      cameraHeightSigmaMm: 2,
      usedMeasuredHeight: false,
      savedCheck: { kind: 'measured', drift, saved },
    };
    vi.mocked(photographTarget).mockResolvedValue({ kind: 'ok', result });
    await act(async () => useCameraCalibrationStore.getState().openWizard());
    useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } });
    await mountControl(<CameraCalibrationWizard />);
    await clickControl(document.body, 'Take photo');
    const text = document.body.textContent ?? '';
    expect(text).toContain('These rings look like a target engraved with other settings.');
    expect(text).toContain('This photo and the saved calibration disagree by about 28.3 mm.');
    expect(text).not.toContain('save the new calibration to correct the overlay');
    expect(control(document.body, 'Keep saved calibration').className).toContain('lf-btn--primary');
    expect(control(document.body, 'Save new calibration').className).not.toContain(
      'lf-btn--primary',
    );
  });
});
