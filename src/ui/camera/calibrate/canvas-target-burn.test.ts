// Rolling audit v3 G6-P2-1 (ADR-440 Amendment 5): "Add target to canvas"
// remembered the bed frame at the click, while its rings burn later through
// an ordinary Start. In the refuter's repro a front-left 400 × 400 machine got
// the A4 target, Machine Setup was corrected to 400 × 410 before the burn, and
// the calibration drew every mark 10 mm from where artwork placed on it burns,
// while the Camera panel said its picture was moved to match. The frame is now
// taken at the Start that streams the rings; a target whose burn KerfDesk did
// not see is refused once the frame has changed.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FrameSource from '../frame-source';
import {
  cameraBedFrameNote,
  cameraModelInBedFrame,
  UNVERIFIED_FRAME_NOTE,
  type CameraBedFrame,
} from '../../../core/camera/model/camera-bed-frame';
import {
  bedMapper,
  bedPoint,
  projectWorldPoint,
  type Vec2,
} from '../../../core/camera/model/camera-model';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import {
  overheadPose,
  savedCameraModel,
  wideLens,
} from '../../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { bedTargetLayout, type BedTargetArea } from '../../../core/camera/target/bed-target';
import { renderTargetScene } from '../../../core/camera/target/target-render-fixtures';
import {
  DEFAULT_DEVICE_PROFILE,
  toMachineCoords,
  toSceneCoords,
  type DeviceProfile,
} from '../../../core/devices';
import { createProject, DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { useStore } from '../../state';
import type { CompletedFrameRunOwner } from '../../state/completed-frame-run';
import { useLaserStore } from '../../state/laser-store';
import type { NativeBedEvidence } from '../../state/native-bed-frame';
import { resetStore } from '../../state/test-helpers';
import { captureSourceFrame, type ActiveCameraSource } from '../frame-source';
import {
  CANVAS_TARGET_BURN_NOT_SEEN,
  CANVAS_TARGET_FRAME_CHANGED,
  canvasTargetBurnedOffAbsolute,
  currentAssumedTarget,
} from './assumed-target';
import { addCalibrationTargetToCanvas, photographTarget } from './calibration-actions';
import { DEFAULT_CALIBRATION_SETTINGS } from './camera-calibration-store';
import {
  stampCanvasTargetBurn,
  watchCanvasTargetBurns,
  type StartedJob,
} from './canvas-target-burn';
import { rememberedEngravedTarget } from './engraved-target-memory';

vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: vi.fn(),
}));

// The default A4 sheet in the middle of the bed, as in the refuter's repro.
const SETTINGS = { ...DEFAULT_CALIBRATION_SETTINGS, sheetThicknessMm: 3 };
const MACHINE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'front-left',
  bedWidth: 400,
  bedHeight: 400,
};
const FRAME_400: CameraBedFrame = { origin: 'front-left', bedWidthMm: 400, bedHeightMm: 400 };
const FRAME_410: CameraBedFrame = { ...FRAME_400, bedHeightMm: 410 };
const UNHOMED: NativeBedEvidence = {};
const source: ActiveCameraSource = {
  kind: 'usb',
  stream: {
    stream: {} as MediaStream,
    sourceId: 'overhead',
    resizeMode: 'none',
    stop: () => undefined,
  },
};

function useMachine(device: DeviceProfile): void {
  resetStore();
  useStore.setState({ project: createProject(device) });
}

// The open project as an Absolute Start streams it.
function started(overrides: Partial<StartedJob> = {}): StartedJob {
  return {
    project: useStore.getState().project,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    preparedStart: {},
    ...overrides,
  };
}

// A photo of the target's rings at `area`, in the scene mm of a 400 × 400
// front-left bed: the frame the overhead camera fixture is posed in.
function photoOfRings(area: BedTargetArea): RgbaImage {
  const gray = renderTargetScene({
    lens: wideLens(960),
    pose: overheadPose(),
    layout: bedTargetLayout({ area }),
    sheet: area,
    sheetThicknessMm: SETTINGS.sheetThicknessMm,
    noise: 3,
    honeycombPitchMm: 6,
  });
  const data = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0; i < gray.width * gray.height; i += 1) {
    const value = gray.data[i] ?? 0;
    data.set([value, value, value, 255], i * 4);
  }
  return { data, width: gray.width, height: gray.height };
}

// Where artwork placed on `mark` (machine mm, seen by the overhead camera at
// the sheet's top) burns, once `record` is in use on the 400 × 410 bed.
function burnsWhereDrawn(record: CameraModelRecord, mark: Vec2): Vec2 {
  const placed = cameraModelInBedFrame(record, FRAME_410);
  if (placed.kind !== 'ok') throw new Error('expected a usable model');
  const seen = toSceneCoords(mark, MACHINE);
  const pixel = projectWorldPoint(
    wideLens(960),
    overheadPose(),
    bedPoint(seen.x, seen.y, SETTINGS.sheetThicknessMm),
  );
  const drawn =
    pixel === null
      ? null
      : bedMapper(placed.model.lens, placed.model.pose)(pixel, SETTINGS.sheetThicknessMm);
  if (drawn === null) throw new Error('mark out of view');
  return toMachineCoords(drawn, { ...MACHINE, bedHeight: 410 });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(captureSourceFrame).mockReset();
  useLaserStore.setState({ completedFrameRunOwner: null });
});

describe('a calibration target added to the canvas', () => {
  it('is fitted in the frame of the Start that burned it, so marks burn where they are drawn', async () => {
    useMachine(MACHINE);
    addCalibrationTargetToCanvas(SETTINGS);
    // Machine Setup is corrected before the burn. The locked rings keep their
    // scene places, which now burn 10 mm further from the front.
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    expect(stampCanvasTargetBurn(started(), UNHOMED)).toBe(true);

    const assumed = currentAssumedTarget();
    expect(assumed).toMatchObject({ source: 'engraved', bedFrame: FRAME_410 });
    expect(assumed.refusal).toBeUndefined();
    expect(assumed.description).toContain('added to the canvas and engraved');
    // Ring corner scene (55, 105) burns at machine (55, 305): in the old 400
    // mm frame, where the camera fixture is posed, that is scene (55, 95).
    expect(assumed.area).toMatchObject({ x: 55, y: 105 });
    expect(toMachineCoords({ x: 55, y: 105 }, { ...MACHINE, bedHeight: 410 })).toEqual({
      x: 55,
      y: 305,
    });
    const photo = photoOfRings({ ...assumed.area, y: assumed.area.y - 10 });
    vi.mocked(captureSourceFrame).mockResolvedValue(photo);
    const outcome = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: 400,
      bedHeightMm: 410,
      area: assumed.area,
      bedFrame: assumed.bedFrame,
    });
    if (outcome.kind !== 'ok') throw new Error(`fit failed: ${JSON.stringify(outcome)}`);
    const { record } = outcome.result;
    expect(record.bedFrame).toEqual(FRAME_410);
    expect(record.accuracy.rmsErrorMm).toBeLessThan(0.25);
    // No "KerfDesk moves its picture 10 mm" note: the record is in today's frame.
    expect(cameraBedFrameNote(record, FRAME_410)).toBeNull();
    // The refuter's marks: before this fix they burned 10 mm nearer the front.
    for (const mark of [
      { x: 200, y: 210 },
      { x: 60, y: 70 },
      { x: 340, y: 300 },
    ]) {
      const burns = burnsWhereDrawn(record, mark);
      expect(Math.abs(burns.x - mark.x)).toBeLessThan(0.5);
      expect(Math.abs(burns.y - mark.y)).toBeLessThan(0.5);
    }

    // Control: the same photo fitted in the frame at the add reproduces the finding.
    const stale = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: 400,
      bedHeightMm: 410,
      area: assumed.area,
      bedFrame: FRAME_400,
    });
    if (stale.kind !== 'ok') throw new Error('control fit failed');
    expect(cameraBedFrameNote(stale.result.record, FRAME_410)?.message).toContain(
      'KerfDesk moves its picture 10 mm',
    );
    const off = burnsWhereDrawn(stale.result.record, { x: 200, y: 210 });
    expect(Math.abs(off.y - 200)).toBeLessThan(0.5);
  }, 30_000);

  it('is refused, not fitted 10 mm off, when Machine Setup changed and no Start was seen', () => {
    useMachine(MACHINE);
    addCalibrationTargetToCanvas(SETTINGS);
    // Unchanged: the frame at the add still says where the rings are, but no
    // Start has burned them at Absolute yet (ADR-441 Amendment 10).
    expect(currentAssumedTarget()).toMatchObject({ source: 'engraved', bedFrame: FRAME_400 });
    expect(currentAssumedTarget().refusal).toBe(CANVAS_TARGET_BURN_NOT_SEEN);
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    const assumed = currentAssumedTarget();
    expect(assumed.bedFrame).toEqual(FRAME_400);
    expect(assumed.refusal).toBe(CANVAS_TARGET_FRAME_CHANGED);
  });

  it('records the native offset of a homed burn after an offline add, so no false "not homed" note', () => {
    // The Falcon A1 Pro's vendor contract puts native (0, 0) at the bed corner once homed.
    const falcon: DeviceProfile = {
      ...MACHINE,
      controllerCommandSet: 'creality-falcon-a1-pro',
      homing: { ...MACHINE.homing, enabled: true },
    };
    const homed: NativeBedEvidence = {
      homingState: 'confirmed',
      activeControllerCommandSet: 'creality-falcon-a1-pro',
      activeControllerKind: 'grblhal',
      detectedControllerKind: null,
    };
    const homedFrame: CameraBedFrame = { ...FRAME_400, nativeToBedOffsetMm: { x: 0, y: 0 } };
    useMachine(falcon);
    addCalibrationTargetToCanvas(SETTINGS);
    const added = rememberedEngravedTarget(falcon, false)?.bedFrame;
    expect(added).toEqual(FRAME_400);
    // Calibrated from the frame at the add, the homed machine would be told it was not homed.
    const fromAdd = { ...savedCameraModel(), bedFrame: FRAME_400 };
    expect(cameraBedFrameNote(fromAdd, homedFrame)?.message).toBe(UNVERIFIED_FRAME_NOTE);

    expect(stampCanvasTargetBurn(started(), homed)).toBe(true);
    const assumed = currentAssumedTarget();
    expect(assumed.bedFrame).toEqual(homedFrame);
    const fromBurn = { ...savedCameraModel(), bedFrame: assumed.bedFrame };
    expect(cameraBedFrameNote(fromBurn, homedFrame)).toBeNull();
  });

  it('is not stamped by a Start that does not burn its rings where it put them', () => {
    useMachine(MACHINE);
    addCalibrationTargetToCanvas(SETTINGS);
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    const relative = started({
      preparedStart: { jobOrigin: { startFrom: 'user-origin', anchor: 'center' } },
    });
    expect(stampCanvasTargetBurn(relative, UNHOMED)).toBe(false);
    const otherArtwork = started({
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['x'],
      },
    });
    expect(stampCanvasTargetBurn(otherArtwork, UNHOMED)).toBe(false);
    const { project } = useStore.getState();
    const [first, ...rest] = project.scene.objects;
    if (first === undefined) throw new Error('expected rings');
    const moved = started({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: [
            { ...first, transform: { ...first.transform, x: first.transform.x + 1 } },
            ...rest,
          ],
        },
      },
    });
    expect(stampCanvasTargetBurn(moved, UNHOMED)).toBe(false);
    // The User Origin burn is remembered, so the photo step names it (Y3-P1-2).
    expect(currentAssumedTarget().refusal).toBe(canvasTargetBurnedOffAbsolute('user-origin'));
  });

  // Rolling audit v13 Y3-P1-2: rings burned from Current Position or User
  // Origin calibrated as if they burned where the target put them.
  it.each(['current-position', 'user-origin'] as const)(
    'refuses the photo of rings burned from %s, until a Start burns them at Absolute',
    (startFrom) => {
      useMachine(MACHINE);
      addCalibrationTargetToCanvas(SETTINGS);
      const relative = started({
        preparedStart: {
          jobOrigin:
            startFrom === 'user-origin'
              ? { startFrom, anchor: 'front-left' }
              : { startFrom, anchor: 'center', currentPosition: { x: 300, y: 80 } },
        },
      });
      expect(stampCanvasTargetBurn(relative, UNHOMED)).toBe(false);
      expect(rememberedEngravedTarget(MACHINE, false)?.burnedFrom).toBe(startFrom);
      expect(currentAssumedTarget().refusal).toBe(canvasTargetBurnedOffAbsolute(startFrom));
      expect(stampCanvasTargetBurn(started({}), UNHOMED)).toBe(true);
      expect(rememberedEngravedTarget(MACHINE, false)).toMatchObject({ burnSeen: true });
      expect(rememberedEngravedTarget(MACHINE, false)?.burnedFrom).toBeUndefined();
      expect(currentAssumedTarget().refusal).toBeUndefined();
    },
  );

  it('is stamped by the Start the laser store records, once', () => {
    useMachine(MACHINE);
    addCalibrationTargetToCanvas(SETTINGS);
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    const stop = watchCanvasTargetBurns();
    const owner = {
      frame: { candidate: started() },
      streamerEpoch: 1,
      runId: null,
    } as unknown as CompletedFrameRunOwner;
    useLaserStore.setState({ completedFrameRunOwner: owner });
    stop();
    expect(rememberedEngravedTarget(useStore.getState().project.device, false)).toMatchObject({
      onCanvas: true,
      burnSeen: true,
      bedFrame: FRAME_410,
    });
    expect(currentAssumedTarget().refusal).toBeUndefined();
  });
});
