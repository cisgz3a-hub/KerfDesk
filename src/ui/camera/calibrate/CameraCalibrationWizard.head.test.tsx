// The calibration wizard for a camera on the laser head (ADR-449): a small
// square target in the middle of the bed, guidance to bring the head over
// it, and the head position handed to the photo.

import { act } from 'react';
import type * as CalibrationActions from './calibration-actions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickElement, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { photographTarget } from './calibration-actions';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
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
vi.mock('../head/head-position', () => ({
  headPositionNow: () => ({ x: 210, y: 140 }),
  useHeadPositionOnBed: () => ({ x: 210, y: 140 }),
}));

const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'head-cam',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};

beforeEach(() => {
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, bedWidth: 400, bedHeight: 300 } },
  });
  vi.mocked(photographTarget).mockReset();
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraCalibrationStore.getState().openWizard();
  useCameraStore.setState({ sourceState: { kind: 'idle' }, sourceEpoch: 0, overlayVisible: false });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
});

describe('calibrating a camera on the laser head', () => {
  it('engraves a small square in the middle of the bed instead of covering it', async () => {
    await mountControl(<CameraCalibrationWizard />);
    expect(document.body.textContent).toContain('Margin (mm)');
    const onHead = headCheckbox();
    await clickElement(onHead);
    expect(useCameraCalibrationStore.getState().settings.headCamera).toBe(true);
    expect(document.body.textContent).toContain('Target size (mm)');
    expect(document.body.textContent).not.toContain('Margin (mm)');
    expect(document.body.textContent).toContain('across 40 × 40 mm');
    expect(document.body.textContent).toContain(
      'move the head until the camera sees the whole square',
    );
  });

  it('asks to bring the head over the target and photographs it with the head position', async () => {
    useCameraCalibrationStore.getState().updateSettings({ headCamera: true });
    useCameraStore.setState({ sourceState: { kind: 'live', source } });
    vi.mocked(photographTarget).mockResolvedValue({ kind: 'failed', message: 'No rings.' });
    useCameraCalibrationStore.getState().setStep({ kind: 'photo', status: { kind: 'idle' } });
    await mountControl(<CameraCalibrationWizard />);
    expect(document.body.textContent).toContain('Jog the head, with the laser off');
    expect(document.body.textContent).not.toContain('Move the laser head to a corner');
    const take = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Take photo',
    );
    await clickElement(take ?? null);
    expect(photographTarget).toHaveBeenCalledWith(
      expect.objectContaining({ headMm: { x: 210, y: 140 } }),
    );
  });
});

function headCheckbox(): HTMLInputElement | null {
  const label = [...document.body.querySelectorAll('label')].find((element) =>
    element.textContent?.includes('Camera rides on the laser head'),
  );
  return label?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}
