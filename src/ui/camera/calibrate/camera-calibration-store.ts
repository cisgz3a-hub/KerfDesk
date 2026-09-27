// camera-calibration-store — the one-photo camera calibration wizard
// (ADR-441): engrave the ring target as a temporary job, take one photo, fit
// the camera, review the result in millimetres, save it to the machine
// profile. Ephemeral like the camera store; only the saved model persists.

import { create } from 'zustand';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { MarkError } from '../../../core/camera/target/bed-calibration';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import type { StreamerState } from '../../../core/controllers/grbl';
import type { SavedCalibrationCheck } from './saved-calibration-check';

export type PhotoStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'failed'; readonly message: string };

export type CalibrationResult = {
  readonly record: CameraModelRecord;
  readonly markErrors: ReadonlyArray<MarkError>;
  /** The photo flattened onto the bed at the target's height, for review. */
  readonly bedImage: RgbaImage | null;
  /** Camera height the photo alone could not pin down to within this, mm. */
  readonly cameraHeightSigmaMm: number;
  readonly usedMeasuredHeight: boolean;
  /** The calibration saved before this photo, measured on it; null when there was none. */
  readonly savedCheck: SavedCalibrationCheck | null;
};

export type CalibrationStep =
  | { readonly kind: 'setup'; readonly note: string | null }
  // `started` turns true once the target job is streaming; before that the
  // machine is framing. `earlierJob` is whatever job the streamer held when
  // the target was requested: a finished earlier job is not the target.
  | {
      readonly kind: 'engraving';
      readonly started: boolean;
      readonly earlierJob: StreamerState | null;
    }
  | { readonly kind: 'photo'; readonly status: PhotoStatus }
  | { readonly kind: 'result'; readonly result: CalibrationResult };

export type CalibrationSettings = {
  /** Thickness of the sheet the target is engraved on, mm. */
  readonly sheetThicknessMm: number;
  /** Tape-measure height of the camera lens above the bed, mm; null if not measured. */
  readonly cameraHeightMm: number | null;
  readonly powerPercent: number;
  readonly speedMmPerMin: number;
  /** Margin kept clear around the target on every side of the bed, mm. */
  readonly marginMm: number;
};

// 'check' starts at the photo of a target already engraved, to see whether
// the saved calibration still holds (ADR-441 Amendment 1).
export type CalibrationMode = 'calibrate' | 'check';

export type CameraCalibrationStore = {
  readonly open: boolean;
  readonly mode: CalibrationMode;
  // Collapsed to a small non-modal panel so the operator can watch the
  // machine engrave and reach the bed while the wizard stays live.
  readonly minimized: boolean;
  readonly step: CalibrationStep;
  readonly settings: CalibrationSettings;
  // The engraved target's area when it is known (a check of the saved
  // calibration); null derives it from the bed and the margin.
  readonly targetArea: BedArea | null;
  readonly openWizard: () => void;
  readonly openCheck: (saved: CameraModelRecord) => void;
  readonly closeWizard: () => void;
  readonly toggleMinimized: () => void;
  readonly updateSettings: (patch: Partial<CalibrationSettings>) => void;
  readonly setStep: (step: CalibrationStep) => void;
};

export const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = {
  sheetThicknessMm: 3,
  cameraHeightMm: null,
  powerPercent: 35,
  speedMmPerMin: 3000,
  marginMm: 5,
};

const INITIAL_STEP: CalibrationStep = { kind: 'setup', note: null };
const MISSING_TARGET_LAYOUT_NOTE =
  "This calibration's target layout was not saved, so it cannot be checked against the old target. " +
  'Recalibrate with a new engraved target, or confirm the original bed size and enter the exact original margins ' +
  'and sheet thickness before choosing Target already engraved. Your saved calibration is unchanged.';

export const useCameraCalibrationStore = create<CameraCalibrationStore>((set) => ({
  open: false,
  mode: 'calibrate',
  minimized: false,
  step: INITIAL_STEP,
  settings: DEFAULT_CALIBRATION_SETTINGS,
  targetArea: null,
  openWizard: () =>
    set({ open: true, mode: 'calibrate', minimized: false, step: INITIAL_STEP, targetArea: null }),
  // Check needs the target that was actually engraved. Older records remain
  // usable, but current bed/margin settings cannot stand in for their layout.
  openCheck: (saved) =>
    set((s) => ({
      open: true,
      mode: saved.accuracy.targetArea === undefined ? 'calibrate' : 'check',
      minimized: false,
      step:
        saved.accuracy.targetArea === undefined
          ? { kind: 'setup', note: MISSING_TARGET_LAYOUT_NOTE }
          : { kind: 'photo', status: { kind: 'idle' } },
      settings: { ...s.settings, sheetThicknessMm: saved.accuracy.targetHeightMm },
      targetArea: saved.accuracy.targetArea ?? null,
    })),
  closeWizard: () => set({ open: false, minimized: false, step: INITIAL_STEP }),
  toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
  // A new margin describes a new target, so a known area no longer applies.
  updateSettings: (patch) =>
    set((s) => ({
      settings: sanitized({ ...s.settings, ...patch }),
      ...(patch.marginMm === undefined ? {} : { targetArea: null }),
    })),
  setStep: (step) => set({ step }),
}));

// Inputs arrive from number fields: a blank or non-numeric entry keeps the
// previous meaning instead of becoming NaN. Nothing the machine can do is
// narrowed; only physically meaningless values (negative thickness, zero
// speed, more than 100 %) are brought back to the nearest meaningful one.
function sanitized(settings: CalibrationSettings): CalibrationSettings {
  const d = DEFAULT_CALIBRATION_SETTINGS;
  return {
    sheetThicknessMm: atLeast(settings.sheetThicknessMm, 0, d.sheetThicknessMm),
    cameraHeightMm:
      settings.cameraHeightMm === null || !(settings.cameraHeightMm > 0)
        ? null
        : settings.cameraHeightMm,
    powerPercent: Math.min(100, atLeast(settings.powerPercent, 0, d.powerPercent)),
    speedMmPerMin: settings.speedMmPerMin > 0 ? settings.speedMmPerMin : d.speedMmPerMin,
    marginMm: atLeast(settings.marginMm, 0, d.marginMm),
  };
}

function atLeast(value: number, min: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, value);
}
