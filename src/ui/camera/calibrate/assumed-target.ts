// Which engraved target a photo is matched against (ADR-441 Amendment 4), and
// how to say so. The rings are labelled from this layout, so a wrong one
// shifts the whole calibration while every figure still looks perfect; the
// wizard therefore always shows the layout it assumes, where the operator can
// still correct it. The layout's bed frame goes with it, so the calibration
// records the frame its rings were placed in (rolling audit 12-P2-2).

import { sameBedPlaces, type CameraBedFrame } from '../../../core/camera/model/camera-bed-frame';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import { DEFAULT_RING_DIAMETER_MM } from '../../../core/camera/target/bed-target';
import type { DeviceProfile } from '../../../core/devices';
import { useStore } from '../../state';
import { cameraBedFrameNow, useCameraBedFrame } from '../camera-bed-frame-now';
import { calibrationTargetArea } from './calibration-actions';
import { useCameraCalibrationStore, type CalibrationSettings } from './camera-calibration-store';
import {
  engravedTargetBedFrame,
  rememberedEngravedTarget,
  type EngravedTarget,
} from './engraved-target-memory';

export type AssumedTarget = {
  readonly area: BedArea;
  /** Where the layout comes from. */
  readonly source: 'saved-calibration' | 'engraved' | 'settings';
  /** The layout in words, to follow "looks for". */
  readonly description: string;
  /** The bed frame the layout's rings were placed in. */
  readonly bedFrame: CameraBedFrame;
  /** Why no photo may be fitted to this layout; absent when it may. */
  readonly refusal?: string;
};

type LayoutSettings = Pick<CalibrationSettings, 'marginMm' | 'headCamera' | 'headTargetSizeMm'> &
  Partial<Pick<CalibrationSettings, 'ringDiameterMm' | 'sheetWidthMm' | 'sheetHeightMm'>>;
type Machine = Pick<DeviceProfile, 'profileId' | 'name' | 'bedWidth' | 'bedHeight'>;

/** The saved calibration's target during a check, with the frame its rings were placed in. */
export type KnownTarget = { readonly area: BedArea; readonly bedFrame: CameraBedFrame };

/**
 * The saved calibration's own target during a check; otherwise the target
 * last engraved on this machine while the settings still describe it (the
 * operator corrects a wrong one by entering another margin or size); otherwise
 * the layout the settings describe, as before.
 */
export function assumedTarget(args: {
  readonly settings: LayoutSettings;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  /**
   * Only with its frame: a saved target read in today's frame would label the
   * rings wrongly after a bed change (meta audit M2-P3-3).
   */
  readonly known: KnownTarget | null;
  readonly remembered: EngravedTarget | null;
  /** The bed frame the machine is set up with now. */
  readonly frameNow: CameraBedFrame;
}): AssumedTarget {
  const { settings, remembered, frameNow, known } = args;
  if (known !== null) {
    const { width, height } = known.area;
    return {
      area: known.area,
      source: 'saved-calibration',
      description: `the target of the saved calibration, ${size(width, height)}`,
      bedFrame: known.bedFrame,
    };
  }
  const bedNow = size(args.bedWidthMm, args.bedHeightMm);
  if (
    remembered !== null &&
    describesRemembered(settings, remembered) &&
    (remembered.ringDiameterMm ?? DEFAULT_RING_DIAMETER_MM) === ringSetting(settings)
  ) {
    const bedThen = size(remembered.bedWidthMm, remembered.bedHeightMm);
    const changed = bedThen === bedNow ? '' : ` (the bed is now ${bedNow})`;
    const date = new Date(remembered.engravedAt).toLocaleDateString();
    const bedFrame = engravedTargetBedFrame(remembered, frameNow);
    return {
      area: remembered.area,
      source: 'engraved',
      description: `the target ${howPlaced(remembered)} from this computer on ${date}: ${layoutWords(settings, remembered.area, bedThen)}${changed}`,
      bedFrame,
      ...(unseenBurnAfterChange(remembered, bedFrame, frameNow)
        ? { refusal: CANVAS_TARGET_FRAME_CHANGED }
        : {}),
    };
  }
  const area = calibrationTargetArea(args.bedWidthMm, args.bedHeightMm, settings);
  return {
    area,
    source: 'settings',
    description: `a target laid out by these settings: ${layoutWords(settings, area, bedNow)}`,
    bedFrame: frameNow,
  };
}

/** {@link assumedTarget} for the open wizard and the machine now. */
export function currentAssumedTarget(): AssumedTarget {
  const { settings, targetArea, targetBedFrame } = useCameraCalibrationStore.getState();
  return assumedTargetFor(useStore.getState().project.device, settings, {
    area: targetArea,
    bedFrame: targetBedFrame,
    frameNow: cameraBedFrameNow(),
  });
}

export function useAssumedTarget(): AssumedTarget {
  const settings = useCameraCalibrationStore((s) => s.settings);
  const targetArea = useCameraCalibrationStore((s) => s.targetArea);
  const targetBedFrame = useCameraCalibrationStore((s) => s.targetBedFrame);
  const device = useStore((s) => s.project.device);
  const frameNow = useCameraBedFrame();
  return assumedTargetFor(device, settings, {
    area: targetArea,
    bedFrame: targetBedFrame,
    frameNow,
  });
}

function assumedTargetFor(
  device: Machine,
  settings: CalibrationSettings,
  known: {
    readonly area: BedArea | null;
    readonly bedFrame: CameraBedFrame | null;
    readonly frameNow: CameraBedFrame;
  },
): AssumedTarget {
  return assumedTarget({
    settings,
    bedWidthMm: device.bedWidth,
    bedHeightMm: device.bedHeight,
    known:
      known.area === null || known.bedFrame === null
        ? null
        : { area: known.area, bedFrame: known.bedFrame },
    remembered: rememberedEngravedTarget(device, settings.headCamera),
    frameNow: known.frameNow,
  });
}

// A target put on the canvas is engraved by the operator, maybe later.
function howPlaced(target: EngravedTarget): string {
  if (target.onCanvas !== true) return 'engraved';
  return target.burnSeen === true ? 'added to the canvas and engraved' : 'added to the canvas';
}

export const CANVAS_TARGET_FRAME_CHANGED =
  'This target was added to the canvas while the machine was set up differently (bed size, origin or machine travel), and KerfDesk has not seen a Start burn its rings since, so it cannot tell where on the bed they are. Add the target to the canvas again and Start it, or use Engrave target.';

// A target put on the canvas whose burn was not seen keeps the frame from when
// it was added. That frame says where its rings are only while Machine Setup
// still places the bed the same way (ADR-440 Amendment 5).
function unseenBurnAfterChange(
  target: EngravedTarget,
  addedIn: CameraBedFrame,
  now: CameraBedFrame,
): boolean {
  return target.onCanvas === true && target.burnSeen !== true && !sameBedPlaces(addedIn, now);
}

// The settings still describe the remembered target when they lay out the
// same area on the bed it was engraved on: margin, sheet size and head-target
// size all included (ADR-441 Amendment 8).
function describesRemembered(settings: LayoutSettings, remembered: EngravedTarget): boolean {
  const area = calibrationTargetArea(remembered.bedWidthMm, remembered.bedHeightMm, settings);
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  return (
    same(area.x, remembered.area.x) &&
    same(area.y, remembered.area.y) &&
    same(area.width, remembered.area.width) &&
    same(area.height, remembered.area.height)
  );
}

function ringSetting(settings: LayoutSettings): number {
  return settings.ringDiameterMm ?? DEFAULT_RING_DIAMETER_MM;
}

function layoutWords(settings: LayoutSettings, area: BedArea, bed: string): string {
  const ring = ringSetting(settings);
  const rings = ring === DEFAULT_RING_DIAMETER_MM ? '' : `, ${round(ring)} mm rings`;
  if (settings.headCamera) {
    return `a ${size(area.width, area.height)} square in the middle of a ${bed} bed${rings}`;
  }
  const sheet = size(area.width + 2 * settings.marginMm, area.height + 2 * settings.marginMm);
  return `${size(area.width, area.height)} with a ${round(settings.marginMm)} mm margin on a ${sheet} sheet in the middle of a ${bed} bed${rings}`;
}

function size(width: number, height: number): string {
  return `${round(width)} × ${round(height)} mm`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
