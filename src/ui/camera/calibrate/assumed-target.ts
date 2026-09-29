// Which engraved target a photo is matched against (ADR-441 Amendment 4), and
// how to say so. The rings are labelled from this layout, so a wrong one
// shifts the whole calibration while every figure still looks perfect; the
// wizard therefore always shows the layout it assumes, where the operator can
// still correct it.

import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { DeviceProfile } from '../../../core/devices';
import { useStore } from '../../state';
import { calibrationTargetArea } from './calibration-actions';
import { useCameraCalibrationStore, type CalibrationSettings } from './camera-calibration-store';
import { rememberedEngravedTarget, type EngravedTarget } from './engraved-target-memory';

export type AssumedTarget = {
  readonly area: BedArea;
  /** Where the layout comes from. */
  readonly source: 'saved-calibration' | 'engraved' | 'settings';
  /** The layout in words, to follow "looks for". */
  readonly description: string;
};

type LayoutSettings = Pick<CalibrationSettings, 'marginMm' | 'headCamera' | 'headTargetSizeMm'>;
type Machine = Pick<DeviceProfile, 'profileId' | 'name' | 'bedWidth' | 'bedHeight'>;

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
  readonly knownArea: BedArea | null;
  readonly remembered: EngravedTarget | null;
}): AssumedTarget {
  const { settings, remembered } = args;
  if (args.knownArea !== null) {
    const { width, height } = args.knownArea;
    return {
      area: args.knownArea,
      source: 'saved-calibration',
      description: `the target of the saved calibration, ${size(width, height)}`,
    };
  }
  const bedNow = size(args.bedWidthMm, args.bedHeightMm);
  if (remembered !== null && remembered.layoutMm === layoutSetting(settings)) {
    const bedThen = size(remembered.bedWidthMm, remembered.bedHeightMm);
    const changed = bedThen === bedNow ? '' : ` (the bed is now ${bedNow})`;
    const date = new Date(remembered.engravedAt).toLocaleDateString();
    return {
      area: remembered.area,
      source: 'engraved',
      description: `the target engraved from this computer on ${date}: ${layoutWords(settings, remembered.area, bedThen)}${changed}`,
    };
  }
  const area = calibrationTargetArea(args.bedWidthMm, args.bedHeightMm, settings);
  return {
    area,
    source: 'settings',
    description: `a target laid out by these settings: ${layoutWords(settings, area, bedNow)}`,
  };
}

/** {@link assumedTarget} for the open wizard and the machine now. */
export function currentAssumedTarget(): AssumedTarget {
  const { settings, targetArea } = useCameraCalibrationStore.getState();
  return assumedTargetFor(useStore.getState().project.device, settings, targetArea);
}

export function useAssumedTarget(): AssumedTarget {
  const settings = useCameraCalibrationStore((s) => s.settings);
  const targetArea = useCameraCalibrationStore((s) => s.targetArea);
  const device = useStore((s) => s.project.device);
  return assumedTargetFor(device, settings, targetArea);
}

function assumedTargetFor(
  device: Machine,
  settings: CalibrationSettings,
  targetArea: BedArea | null,
): AssumedTarget {
  return assumedTarget({
    settings,
    bedWidthMm: device.bedWidth,
    bedHeightMm: device.bedHeight,
    knownArea: targetArea,
    remembered: rememberedEngravedTarget(device, settings.headCamera),
  });
}

function layoutSetting(settings: LayoutSettings): number {
  return settings.headCamera ? settings.headTargetSizeMm : settings.marginMm;
}

function layoutWords(settings: LayoutSettings, area: BedArea, bed: string): string {
  if (settings.headCamera) {
    return `a ${size(area.width, area.height)} square in the middle of a ${bed} bed`;
  }
  return `${size(area.width, area.height)} with a ${round(settings.marginMm)} mm margin on a ${bed} bed`;
}

function size(width: number, height: number): string {
  return `${round(width)} × ${round(height)} mm`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
