// Camera audit v2 K1-P1-2 (ADR-663 Amendment 7). A camera that tipped 1°
// read 8.7 mm at the middle ring, so Fix a small offset was offered; after it
// the bed was still up to 6.8 mm off, and the Fix renewed the moved check's
// reference and marked the camera steady. A rolled camera was told "Nothing to
// fix". The moved check's measured corners now decide what one offset may fix.

import { act } from 'react';
import type * as NudgeActions from './nudge-actions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { useCameraMovedStore, type CameraMovedState } from '../helpers/moved-check';
import { CalibrateCameraControls } from './CalibrateCameraControls';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
} from './camera-calibration-store';
import { applyNudge, photographNudgeRing } from './nudge-actions';
import { MIDDLE_ONLY_NOTE, nudgeMoveCheck } from './nudge-move-check';

vi.mock('./nudge-actions', async (original) => ({
  ...(await original<typeof NudgeActions>()),
  engraveNudgeRing: vi.fn(),
  photographNudgeRing: vi.fn(),
}));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));
vi.mock('../helpers/refresh-picture', () => ({
  refreshCameraPicture: vi.fn(async () => 'refreshed'),
}));

const machine = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid/frame',
  frameUrl: 'http://bridge.invalid/frame',
};
const record = savedCameraModel();
const initialCamera = useCameraStore.getState();
const still = { width: 64, height: 36, data: new Uint8ClampedArray(64 * 36 * 4).fill(128) };

// The moved check's measurement: the middle, then the four corners.
function moved(middle: number, corners: ReadonlyArray<number>): CameraMovedState {
  return {
    kind: 'moved',
    mm: Math.max(middle, ...corners),
    displacementsMm: [{ x: middle, y: 0 }, ...corners.map((x) => ({ x, y: 0 }))],
    calibratedAt: record.calibratedAt,
  };
}

beforeEach(() => {
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, bedWidth: 400, bedHeight: 400, cameraModel: record },
    },
  });
  vi.mocked(photographNudgeRing).mockReset();
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraStore.setState({
    ...initialCamera,
    sourceState: { kind: 'live', source: machine },
    overlayStill: still,
  });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
  useCameraMovedStore.setState({ state: { kind: 'unknown' }, dismissedFor: null, weakChecks: 0 });
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
  useCameraStore.setState(initialCamera);
});

async function photoWithOffset(x: number): Promise<void> {
  vi.mocked(photographNudgeRing).mockResolvedValue({ kind: 'ok', offsetMm: { x, y: 0 } });
  await mountControl(
    <>
      <CalibrateCameraControls />
      <CameraCalibrationWizard />
    </>,
  );
  await clickControl(document.body, 'Fix a small offset…');
  await clickControl(document.body, 'Ring already burned');
  await clickControl(document.body, 'Take photo');
}

describe('nudgeMoveCheck', () => {
  it('calls a move whose corners differ from the middle by a millimetre or more a turn', () => {
    const tipped = nudgeMoveCheck(moved(8.7, [3, 15, 4, 14]), record.calibratedAt);
    expect(tipped.kind).toBe('turned');
    expect(tipped.kind === 'turned' ? tipped.cornersMm : 0).toBeCloseTo(6.3, 6);
    expect(nudgeMoveCheck(moved(2, [2.3, 1.8, 2.1, 2.4]), record.calibratedAt)).toEqual({
      kind: 'open',
    });
  });

  it('keeps a view that no longer matches, and ignores another calibration', () => {
    const changed: CameraMovedState = { kind: 'changed', calibratedAt: record.calibratedAt };
    expect(nudgeMoveCheck(changed, record.calibratedAt)).toEqual({ kind: 'changed' });
    expect(nudgeMoveCheck(moved(8.7, [3, 15, 4, 14]), 'another')).toEqual({ kind: 'open' });
    expect(nudgeMoveCheck({ kind: 'unknown' }, record.calibratedAt)).toEqual({ kind: 'open' });
  });
});

describe('Fix a small offset on a turned camera', () => {
  it('refuses one offset for a tipped camera and sends it to a new calibration', async () => {
    useCameraMovedStore.setState({ state: moved(8.7, [3, 15, 4, 14]) });
    await photoWithOffset(8.7);
    expect(document.body.textContent).toContain('One offset cannot fix this camera.');
    expect(document.body.textContent).toContain('up to about 6.3 mm');
    expect(control(document.body, 'Recalibrate…')).toBeTruthy();
    expect(() => control(document.body, 'Fix')).toThrow();
    expect(applyNudge({ x: 8.7, y: 0 })).toBe(false);
    expect(useStore.getState().project.device.cameraModel).toBe(record);
  });

  it('does not say "nothing to fix" for a rolled camera whose middle did not move', async () => {
    useCameraMovedStore.setState({ state: moved(0.05, [3.9, -3.9, 3.8, -3.8]) });
    await photoWithOffset(0.05);
    expect(document.body.textContent).toContain('One offset cannot fix this camera.');
    expect(document.body.textContent).not.toContain('Nothing to fix');
  });

  it('says a fix lines up the middle only, and one ring cannot see a turn', async () => {
    await photoWithOffset(2);
    expect(document.body.textContent).toContain(MIDDLE_ONLY_NOTE);
    useCameraCalibrationStore.getState().closeWizard();
    await photoWithOffset(0.05);
    expect(document.body.textContent).toContain('One ring cannot show a camera that tipped');
  });
});

describe('what a fix tells the moved check', () => {
  it('marks a measured slide steady once fixed', async () => {
    useCameraMovedStore.setState({ state: moved(2, [2.3, 1.8, 2.1, 2.4]) });
    expect(applyNudge({ x: 2, y: 0 })).toBe(true);
    await vi.waitFor(() =>
      expect(useCameraMovedStore.getState().state).toEqual({ kind: 'steady' }),
    );
  });

  it('keeps the warning of a view that no longer matched', async () => {
    const changed: CameraMovedState = { kind: 'changed', calibratedAt: record.calibratedAt };
    useCameraMovedStore.setState({ state: changed });
    expect(applyNudge({ x: 2, y: 0 })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useCameraMovedStore.getState().state).toEqual(changed);
  });
});
