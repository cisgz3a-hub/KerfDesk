// The wizard's photo step end to end (ADR-441): a rendered photo of the
// engraved target, captured through the active source, becomes a saved
// camera model whose accuracy is reported in bed millimetres, and whose
// bed picture is ready for review. The engrave step hands the target to the
// temporary-job path over the operator's project.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as FrameSource from '../frame-source';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import {
  overheadPose,
  savedCameraModel,
  wideLens,
} from '../../../core/camera/model/model-fixtures';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import { bedTargetLayout } from '../../../core/camera/target/bed-target';
import { renderTargetScene } from '../../../core/camera/target/target-render-fixtures';
import { DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../../core/scene';
import { useStore } from '../../state';
import { captureSourceFrame, type ActiveCameraSource } from '../frame-source';
import {
  addCalibrationTargetToCanvas,
  CAMERA_TARGET_ROTARY_MESSAGE,
  engraveCalibrationTarget,
  photographTarget,
  targetAreaForBed,
} from './calibration-actions';
import { DEFAULT_CALIBRATION_SETTINGS } from './camera-calibration-store';
import { rememberedEngravedTarget } from './engraved-target-memory';

vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: vi.fn(),
}));

const BED = 400;
// A sheet covering the whole 400 mm bed, as the rendered photo shows.
const SETTINGS = {
  ...DEFAULT_CALIBRATION_SETTINGS,
  sheetThicknessMm: 3,
  marginMm: 5,
  sheetWidthMm: BED,
  sheetHeightMm: BED,
};
const source: ActiveCameraSource = {
  kind: 'usb',
  stream: {
    stream: {} as MediaStream,
    sourceId: 'overhead',
    resizeMode: 'none',
    stop: () => undefined,
  },
};

let photo: RgbaImage;

beforeAll(() => {
  const lens = wideLens(960);
  const area = targetAreaForBed(BED, BED, SETTINGS.marginMm);
  const gray = renderTargetScene({
    lens,
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
  photo = { data, width: gray.width, height: gray.height };
});

describe('targetAreaForBed', () => {
  it('keeps the margin on every side and never lets it swallow the bed', () => {
    expect(targetAreaForBed(400, 300, 5)).toEqual({ x: 5, y: 5, width: 390, height: 290 });
    expect(targetAreaForBed(100, 100, 80)).toEqual({ x: 25, y: 25, width: 50, height: 50 });
    expect(targetAreaForBed(100, 100, -4)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('photographTarget', () => {
  it('turns one photo of the target into a camera model accurate to a fraction of a millimetre', async () => {
    vi.mocked(captureSourceFrame).mockResolvedValueOnce(photo);
    const outcome = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: BED,
      bedHeightMm: BED,
      now: () => new Date('2026-09-26T12:00:00Z'),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const { record, bedImage } = outcome.result;
    expect(record.accuracy.foundMarks).toBeGreaterThanOrEqual(80);
    expect(record.accuracy.rmsErrorMm).toBeLessThan(0.25);
    expect(record.accuracy.targetHeightMm).toBe(3);
    expect(record.calibratedAt).toBe('2026-09-26T12:00:00.000Z');
    expect(record.capture).toMatchObject<Partial<CameraCaptureBinding>>({
      sourceKind: 'usb',
      sourceId: 'overhead',
      width: photo.width,
      height: photo.height,
    });
    expect(bedImage).toMatchObject({ width: BED, height: BED });
    expect(outcome.result.bedImageRegion).toEqual({ x: 0, y: 0, width: BED, height: BED });
    expect(outcome.result.usedMeasuredHeight).toBe(false);
    expect(outcome.result.savedCheck).toBeNull();
    expect(record.accuracy.targetArea).toEqual(targetAreaForBed(BED, BED, SETTINGS.marginMm));
    expect(record.accuracy.marks?.length).toBe(record.accuracy.foundMarks);
  }, 20_000);

  it('measures the saved calibration on the same photo', async () => {
    vi.mocked(captureSourceFrame).mockResolvedValueOnce(photo);
    // The saved model is the camera that rendered the photo, at another size.
    const outcome = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: BED,
      bedHeightMm: BED,
      saved: savedCameraModel(),
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const check = outcome.result.savedCheck;
    expect(check?.kind).toBe('measured');
    if (check?.kind !== 'measured') return;
    expect(check.drift.marks).toBeGreaterThanOrEqual(80);
    expect(check.drift.rmsMm).toBeLessThan(0.3);
  }, 20_000);

  it('says what to check when the photo shows no target', async () => {
    vi.mocked(captureSourceFrame).mockResolvedValueOnce({
      data: new Uint8ClampedArray(64 * 48 * 4).fill(210),
      width: 64,
      height: 48,
    });
    const outcome = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: BED,
      bedHeightMm: BED,
    });
    expect(outcome).toEqual({ kind: 'failed', message: expect.stringContaining('No rings') });
  });

  it('says so when the camera gives no picture', async () => {
    vi.mocked(captureSourceFrame).mockResolvedValueOnce(null);
    const outcome = await photographTarget({
      source,
      settings: SETTINGS,
      bedWidthMm: BED,
      bedHeightMm: BED,
    });
    expect(outcome).toEqual({
      kind: 'failed',
      message: expect.stringContaining('Could not take a photo'),
    });
  });
});

describe('addCalibrationTargetToCanvas', () => {
  it('replaces the artwork with locked rings, runs them at Absolute, and remembers them', () => {
    localStorage.clear();
    const before = useStore.getState().project;
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
    const settings = { ...SETTINGS, marginMm: 12 };
    addCalibrationTargetToCanvas(settings);
    const { project, jobPlacement, undoStack } = useStore.getState();
    const { device } = project;
    const area = targetAreaForBed(device.bedWidth, device.bedHeight, 12);
    expect(project.scene.layers).toEqual([
      expect.objectContaining({ id: 'camera-bed-target', power: 35, speed: 3000 }),
    ]);
    expect(project.scene.objects).toHaveLength(bedTargetLayout({ area }).marks.length);
    expect(project.scene.objects.every((object) => object.locked === true)).toBe(true);
    expect(undoStack.at(-1)).toBe(before);
    expect(jobPlacement).toEqual({ startFrom: 'absolute', anchor: 'center' });
    expect(rememberedEngravedTarget(device, false)).toMatchObject({ area, layoutMm: 12 });
    useStore.setState({ project: before });
  });

  it('puts the artwork and Start from back in one Undo step (ADR-654 Amendment 2)', () => {
    const before = useStore.getState().project;
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'center' } });
    addCalibrationTargetToCanvas(SETTINGS);
    const target = useStore.getState().project;

    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().jobPlacement).toEqual({
      startFrom: 'user-origin',
      anchor: 'center',
    });

    useStore.getState().redo();
    expect(useStore.getState().project).toBe(target);
    expect(useStore.getState().project.jobSetup.placement.startFrom).toBe('absolute');
    expect(useStore.getState().jobPlacement).toEqual({ startFrom: 'absolute', anchor: 'center' });
    useStore.setState({ project: before });
  });
});

describe('engraveCalibrationTarget', () => {
  // ADR-228 Amendment 3 (rolling audit v13 Y3): the rings belong on the flat
  // bed; with the rotary on they would be wrapped round a part or rebased.
  it.each(['Y', 'A', 'Z'] as const)(
    'refuses with the rotary on (turned by %s), and says to switch it off',
    async (axis) => {
      const before = useStore.getState().project;
      useStore.setState({
        project: {
          ...before,
          device: {
            ...before.device,
            rotary: {
              enabled: true,
              type: 'chuck',
              mmPerRotation: 360,
              objectDiameterMm: 60,
              axis,
            },
          },
        },
      });
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      const start = vi.fn(async () => true);
      try {
        expect(await engraveCalibrationTarget(SETTINGS, start)).toBe(false);
        expect(start).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith(CAMERA_TARGET_ROTARY_MESSAGE);
      } finally {
        alert.mockRestore();
        useStore.setState({ project: before });
      }
    },
  );

  it('streams the target in place of the scene without touching the open project', async () => {
    const before = useStore.getState().project;
    let streamed: Project | null = null;
    const started = await engraveCalibrationTarget(SETTINGS, async (project) => {
      streamed = project;
      return true;
    });
    expect(started).toBe(true);
    expect(useStore.getState().project).toBe(before);
    const scene = (streamed as Project | null)?.scene;
    expect(scene?.layers).toEqual([
      expect.objectContaining({ id: 'camera-bed-target', power: 35, speed: 3000 }),
    ]);
    expect(scene?.objects.length).toBeGreaterThan(0);
  });

  it('remembers where the target went once its job starts, and not before', async () => {
    localStorage.clear();
    const { device } = useStore.getState().project;
    const settings = { ...SETTINGS, marginMm: 20 };
    await engraveCalibrationTarget(settings, async () => false);
    expect(rememberedEngravedTarget(device, false)).toBeNull();
    await engraveCalibrationTarget(settings, async () => true);
    expect(rememberedEngravedTarget(device, false)).toMatchObject({
      area: targetAreaForBed(device.bedWidth, device.bedHeight, 20),
      bedWidthMm: device.bedWidth,
      bedHeightMm: device.bedHeight,
      layoutMm: 20,
    });
    expect(rememberedEngravedTarget(device, true)).toBeNull();
  });

  it('engraves the target with the laser while the canvas is in CNC mode', async () => {
    const before = useStore.getState().project;
    useStore.setState({ project: { ...before, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    let streamed: Project | null = null;
    await engraveCalibrationTarget(SETTINGS, async (project) => {
      streamed = project;
      return true;
    });
    useStore.setState({ project: before });
    expect((streamed as Project | null)?.machine).toEqual({ kind: 'laser' });
  });
});
