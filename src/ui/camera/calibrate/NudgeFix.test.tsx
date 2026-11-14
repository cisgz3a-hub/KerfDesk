// The quick nudge fix (ADR-663 Amendment 2): a ring burned in the middle of
// the bed, found in a photo, moves the saved camera picture onto it in one
// undo step. A large offset asks for a new calibration instead, a tiny one
// changes nothing, and a head camera is never offered the fix.

import { act } from 'react';
import type * as NudgeActions from './nudge-actions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cameraBedFrameNote,
  UNVERIFIED_FRAME_NOTE,
} from '../../../core/camera/model/camera-bed-frame';
import { pixelToBed } from '../../../core/camera/model/camera-model';
import {
  overheadPose,
  savedCameraModel,
  wideLens,
} from '../../../core/camera/model/model-fixtures';
import { renderTargetScene } from '../../../core/camera/target/target-render-fixtures';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { CalibrateCameraControls } from './CalibrateCameraControls';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import {
  DEFAULT_CALIBRATION_SETTINGS,
  useCameraCalibrationStore,
} from './camera-calibration-store';
import { engraveNudgeRing, photographNudgeRing } from './nudge-actions';
import { HOME_BEFORE_NUDGE_NOTE, NO_HOMING_NUDGE_NOTE, RING_BED_UNKNOWN_NOTE } from './NudgeSteps';

vi.mock('./nudge-actions', async (original) => ({
  ...(await original<typeof NudgeActions>()),
  engraveNudgeRing: vi.fn(),
  photographNudgeRing: vi.fn(),
}));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));

const machine = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid/frame',
  frameUrl: 'http://bridge.invalid/frame',
};
const initialCamera = useCameraStore.getState();

beforeEach(() => {
  resetStore();
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, bedWidth: 400, bedHeight: 400, cameraModel: savedCameraModel() },
    },
  });
  vi.mocked(engraveNudgeRing).mockReset();
  vi.mocked(photographNudgeRing).mockReset();
  useCameraCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS });
  useCameraStore.setState({ ...initialCamera, sourceState: { kind: 'live', source: machine } });
  useLaserStore.setState({ connection: { kind: 'disconnected' }, streamer: null });
});

afterEach(async () => {
  await act(async () => useCameraCalibrationStore.getState().closeWizard());
  useCameraStore.setState(initialCamera);
});

async function openNudge(): Promise<void> {
  await mountControl(
    <>
      <CalibrateCameraControls />
      <CameraCalibrationWizard />
    </>,
  );
  await clickControl(document.body, 'Fix a small offset…');
}

async function photoWithOffset(x: number, y: number): Promise<void> {
  vi.mocked(photographNudgeRing).mockResolvedValue({ kind: 'ok', offsetMm: { x, y } });
  await openNudge();
  await clickControl(document.body, 'Ring already burned');
  await clickControl(document.body, 'Take photo');
}

describe('the quick nudge fix', () => {
  it.each([false, true])('ignores a stale burn completion (started: %s)', async (started) => {
    let finish!: (value: boolean) => void;
    useLaserStore.setState({ connection: { kind: 'connected' } });
    vi.mocked(engraveNudgeRing).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openNudge();
    await clickControl(document.body, 'Burn the ring');
    await act(async () => {
      useCameraCalibrationStore.getState().closeWizard();
      useCameraCalibrationStore.getState().openNudge();
    });
    const reopened = useCameraCalibrationStore.getState().step;
    await act(async () => finish(started));
    expect(useCameraCalibrationStore.getState().step).toBe(reopened);
  });

  it('burns one ring through the job path and goes on to the photo when it finishes', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } });
    vi.mocked(engraveNudgeRing).mockResolvedValue(true);
    await openNudge();
    expect(useCameraCalibrationStore.getState()).toMatchObject({
      mode: 'nudge',
      step: { kind: 'nudge-setup' },
    });
    expect(document.body.textContent).toContain('Fix camera offset');
    expect(document.body.textContent).toContain('(200, 200 mm)');
    await clickControl(document.body, 'Burn the ring');
    expect(engraveNudgeRing).toHaveBeenCalledTimes(1);
    await act(async () =>
      useLaserStore.setState({ streamer: { status: 'done', total: 2, completed: 2 } as never }),
    );
    expect(useCameraCalibrationStore.getState().step).toEqual({
      kind: 'nudge-photo',
      status: { kind: 'idle' },
    });
  });

  it('moves the saved picture onto the burned ring as one undo step', async () => {
    const before = useStore.getState().project.device.cameraModel;
    await photoWithOffset(1.5, 0.5);
    expect(document.body.textContent).toContain(
      'The picture is 1.6 mm off: the ring shows 1.5 mm to the left of and 0.5 mm above where it burned.',
    );
    await clickControl(document.body, 'Fix');
    const after = useStore.getState().project.device.cameraModel;
    if (before === undefined || after === undefined) throw new Error('calibration missing');
    const pixel = { x: 640, y: 360 };
    const was = pixelToBed(before.lens, before.pose, pixel, 3);
    const now = pixelToBed(after.lens, after.pose, pixel, 3);
    expect((now?.x ?? 0) - (was?.x ?? 0)).toBeCloseTo(1.5, 6);
    expect((now?.y ?? 0) - (was?.y ?? 0)).toBeCloseTo(0.5, 6);
    expect(useCameraCalibrationStore.getState().open).toBe(false);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.device.cameraModel).toEqual(before);
  });

  it('asks for a new calibration instead of hiding a large move', async () => {
    await photoWithOffset(12, 0);
    expect(document.body.textContent).toContain('more than a small offset');
    expect(control(document.body, 'Recalibrate…')).toBeTruthy();
    expect(() => control(document.body, 'Fix')).toThrow();
  });

  it('changes nothing when the picture already lines up', async () => {
    const before = useStore.getState().project.device.cameraModel;
    await photoWithOffset(0.1, -0.05);
    expect(document.body.textContent).toContain('Nothing to fix there.');
    await clickControl(document.body, 'Done');
    expect(useStore.getState().project.device.cameraModel).toBe(before);
  });

  it('says why the photo found no ring and lets the operator take it again', async () => {
    vi.mocked(photographNudgeRing).mockResolvedValue({ kind: 'failed', message: 'No ring.' });
    await openNudge();
    await clickControl(document.body, 'Ring already burned');
    await clickControl(document.body, 'Take photo');
    expect(document.body.textContent).toContain('No ring.');
    expect(control(document.body, 'Take photo').disabled).toBe(false);
  });

  it('is not offered for a camera on the laser head', async () => {
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: {
          ...project.device,
          cameraModel: {
            ...savedCameraModel(),
            mount: { kind: 'head', headAtCalibrationMm: { x: 200, y: 200 } },
          },
        },
      },
    });
    await mountControl(<CalibrateCameraControls />);
    expect(() => control(document.body, 'Fix a small offset…')).toThrow();
  });

  it('ignores a late photo after closing and reopening the nudge wizard', async () => {
    let finish!: (outcome: NudgeActions.NudgePhotoOutcome) => void;
    vi.mocked(photographNudgeRing).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openNudge();
    await clickControl(document.body, 'Ring already burned');
    await clickControl(document.body, 'Take photo');
    await act(async () => {
      useCameraCalibrationStore.getState().closeWizard();
      useCameraCalibrationStore.getState().openNudge();
    });
    await act(async () => finish({ kind: 'ok', offsetMm: { x: 2, y: 0 } }));
    expect(useCameraCalibrationStore.getState().step.kind).toBe('nudge-setup');
  });

  it.each(['document', 'profile', 'camera', 'settings'] as const)(
    'retires a result when its %s changes, even if the old context returns',
    async (change) => {
      await photoWithOffset(2, 0);
      const app = useStore.getState();
      const camera = useCameraStore.getState();
      const wizard = useCameraCalibrationStore.getState();
      await act(async () => {
        if (change === 'document') {
          useStore.setState({ projectDocumentEpoch: app.projectDocumentEpoch + 1 });
        } else if (change === 'profile') {
          useStore.setState({ project: { ...app.project, device: { ...app.project.device } } });
          useStore.setState({ project: app.project });
        } else if (change === 'camera') {
          useCameraStore.setState({ sourceState: { kind: 'idle' } });
          useCameraStore.setState({ sourceState: camera.sourceState });
        } else {
          wizard.updateSettings({ sheetThicknessMm: wizard.settings.sheetThicknessMm + 1 });
          useCameraCalibrationStore.setState({ settings: wizard.settings });
        }
      });
      expect(() => control(document.body, 'Fix')).toThrow();
      expect(useStore.getState().project.device.cameraModel).toBe(app.project.device.cameraModel);
      expect(useCameraCalibrationStore.getState().step).toMatchObject({ kind: 'nudge-photo' });
    },
  );

  // Rolling audit v3 G6-P3-3 (ADR-440 Amendment 5): the ring is an Absolute
  // burn a camera fit is measured on, like the target, but had none of the
  // target step's home-first advice.
  it('asks for Home before the ring on an unhomed machine, without blocking it', async () => {
    const withHoming = (enabled: boolean): void => {
      const { project } = useStore.getState();
      useStore.setState({
        project: {
          ...project,
          device: { ...project.device, homing: { ...project.device.homing, enabled } },
        },
      });
    };
    withHoming(true);
    useLaserStore.setState({ connection: { kind: 'connected' }, homingState: 'unknown' });
    await openNudge();
    expect(document.body.textContent).toContain(HOME_BEFORE_NUDGE_NOTE);
    expect(control(document.body, 'Burn the ring').disabled).toBe(false);

    await act(async () => useLaserStore.setState({ homingState: 'confirmed' }));
    expect(document.body.textContent).not.toContain(HOME_BEFORE_NUDGE_NOTE);

    await act(async () => withHoming(false));
    expect(document.body.textContent).toContain(NO_HOMING_NUDGE_NOTE);
  });

  it('remembers the bed frame the ring was burned in and measures with it', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' }, homingState: 'unknown' });
    vi.mocked(engraveNudgeRing).mockResolvedValue(true);
    vi.mocked(photographNudgeRing).mockResolvedValue({ kind: 'ok', offsetMm: { x: 2, y: 0 } });
    await openNudge();
    await clickControl(document.body, 'Burn the ring');
    const unhomed = { origin: 'front-left', bedWidthMm: 400, bedHeightMm: 400 };
    expect(useCameraCalibrationStore.getState().nudgeRingBedFrame).toEqual(unhomed);
    await act(async () =>
      useLaserStore.setState({ streamer: { status: 'done', total: 2, completed: 2 } as never }),
    );
    await clickControl(document.body, 'Take photo');
    expect(photographNudgeRing).toHaveBeenCalledWith(
      expect.objectContaining({ ringBedFrame: unhomed }),
    );
  });

  it('flags a fix measured on a ring burned before the bed position was known', async () => {
    // Calibrated homed: the record knows where native (0, 0) sits on the bed.
    const homedFrame = {
      origin: 'front-left' as const,
      bedWidthMm: 400,
      bedHeightMm: 400,
      nativeToBedOffsetMm: { x: 0, y: 0 },
    };
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, cameraModel: { ...savedCameraModel(), bedFrame: homedFrame } },
      },
    });
    vi.mocked(photographNudgeRing).mockResolvedValue({
      kind: 'ok',
      offsetMm: { x: 4, y: 0 },
      ringBedUnknown: true,
    });
    await openNudge();
    await clickControl(document.body, 'Ring already burned');
    await clickControl(document.body, 'Take photo');
    expect(document.body.textContent).toContain(RING_BED_UNKNOWN_NOTE);
    await clickControl(document.body, 'Fix');
    const fixed = useStore.getState().project.device.cameraModel;
    if (fixed === undefined) throw new Error('calibration missing');
    expect(fixed.bedFrame).toEqual({ origin: 'front-left', bedWidthMm: 400, bedHeightMm: 400 });
    // Once homed, the Camera panel says what the audit found missing.
    expect(cameraBedFrameNote(fixed, homedFrame)?.message).toBe(UNVERIFIED_FRAME_NOTE);
  });

  it('keeps a pending photo and its result through minimize and expand', async () => {
    let finish!: (outcome: NudgeActions.NudgePhotoOutcome) => void;
    vi.mocked(photographNudgeRing).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openNudge();
    await clickControl(document.body, 'Ring already burned');
    await clickControl(document.body, 'Take photo');
    await clickControl(document.body, 'Minimize');
    await act(async () => finish({ kind: 'ok', offsetMm: { x: 2, y: 0 } }));
    await clickControl(document.body, 'Expand');
    await clickControl(document.body, 'Fix');
    expect(useCameraCalibrationStore.getState().open).toBe(false);
  });
});

describe('finding the burned ring in a photo', () => {
  it.each([false, true])(
    'measures against the bed captured at request time (bed changes: %s)',
    async (changeBed) => {
      const { photographNudgeRing: photograph } =
        await vi.importActual<typeof NudgeActions>('./nudge-actions');
      // The saved camera places the ring 1.5 mm left of and 0.5 mm above the burn
      // in the middle of the 400 × 400 mm bed.
      const gray = renderTargetScene({
        lens: wideLens(),
        pose: overheadPose(),
        layout: {
          marks: [{ col: 0, row: 0, x: 198.5, y: 199.5, anchor: false }],
          spacingMm: 40,
          ringDiameterMm: 10,
          ringWidthMm: 1.8,
        },
        sheet: { x: 150, y: 150, width: 100, height: 100 },
        sheetThicknessMm: 3,
        noise: 2,
      });
      const rgba = new Uint8ClampedArray(gray.width * gray.height * 4);
      for (let index = 0; index < gray.width * gray.height; index += 1) {
        const value = gray.data[index] ?? 0;
        rgba.set([value, value, value, 255], index * 4);
      }
      const frame = { width: gray.width, height: gray.height, data: rgba };
      const outcome = await photograph({
        source: machine,
        sheetThicknessMm: 3,
        capture: async () => {
          if (changeBed) useStore.getState().updateDeviceProfile({ bedWidth: 800 });
          return frame;
        },
      });
      expect(outcome.kind).toBe('ok');
      if (outcome.kind !== 'ok') return;
      // One ring about 14 px across, seen in perspective: a tenth of a millimetre.
      expect(Math.abs(outcome.offsetMm.x - 1.5)).toBeLessThan(0.15);
      expect(Math.abs(outcome.offsetMm.y - 0.5)).toBeLessThan(0.15);
    },
    30_000,
  );
});
