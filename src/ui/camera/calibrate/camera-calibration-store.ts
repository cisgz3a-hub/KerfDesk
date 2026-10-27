// camera-calibration-store — the one-photo camera calibration wizard
// (ADR-441): engrave the ring target as a temporary job, take one photo, fit
// the camera, review the result in millimetres, save it to the machine
// profile. Ephemeral like the camera store; only the saved model persists,
// and the layout of the last target engraved (engraved-target-memory.ts).

import { create } from 'zustand';
import type { CameraBedFrame } from '../../../core/camera/model/camera-bed-frame';
import type { BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { Vec2 } from '../../../core/camera/model/camera-model';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { MarkError } from '../../../core/camera/target/bed-calibration';
import { DEFAULT_RING_DIAMETER_MM } from '../../../core/camera/target/bed-target';
import type { ViewThumbnail } from '../../../core/camera/model/view-shift';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import type { StreamerState } from '../../../core/controllers/grbl';
import { useStore } from '../../state';
import { rememberedLayoutSettings } from './engraved-target-memory';
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
  /** The part of the bed that picture shows, mm; absent means the whole bed. */
  readonly bedImageRegion?: BedArea;
  /** Camera height the photo alone could not pin down to within this, mm. */
  readonly cameraHeightSigmaMm: number;
  readonly usedMeasuredHeight: boolean;
  /** The calibration saved before this photo, measured on it; null when there was none. */
  readonly savedCheck: SavedCalibrationCheck | null;
  /** The camera's whole view in this photo, for the "camera moved?" check (ADR-663 Amendment 3). */
  readonly viewReference?: ViewThumbnail;
};

export type CalibrationStep =
  // The guided setup's first screens (ADR-663): which camera, where it is
  // mounted, and a look at its picture, before the target is engraved.
  | { readonly kind: 'camera' }
  | { readonly kind: 'mount' }
  | { readonly kind: 'picture' }
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
  | { readonly kind: 'result'; readonly result: CalibrationResult }
  // The quick nudge fix (ADR-663 Amendment 2): burn one ring, photograph it,
  // move the saved camera onto it.
  | { readonly kind: 'nudge-setup'; readonly note: string | null }
  | { readonly kind: 'nudge-photo'; readonly status: PhotoStatus }
  | {
      readonly kind: 'nudge-result';
      readonly offsetMm: Vec2;
      /** The ring was burned before the machine's bed position was known (ADR-440 Amendment 5). */
      readonly ringBedUnknown?: true;
    };

export type CalibrationSettings = {
  /** Thickness of the sheet the target is engraved on, mm. */
  readonly sheetThicknessMm: number;
  /** Tape-measure height of the camera lens above the bed, mm; null if not measured. */
  readonly cameraHeightMm: number | null;
  readonly powerPercent: number;
  readonly speedMmPerMin: number;
  /** Margin kept clear around the target on every side of the sheet, mm. */
  readonly marginMm: number;
  /**
   * The sheet the target is engraved on, laid in the middle of the bed, mm
   * (ADR-441 Amendment 8). Larger than the bed means the whole bed.
   */
  readonly sheetWidthMm: number;
  readonly sheetHeightMm: number;
  /** The camera rides on the laser head (ADR-449): a small target it sees whole. */
  readonly headCamera: boolean;
  /** Side of the head camera's square target, mm. */
  readonly headTargetSizeMm: number;
  /**
   * Outer diameter of the target's rings, mm; the grid step is four of them.
   * Larger rings for a camera that sees each ring as only a few pixels
   * (ADR-441 Amendment 7).
   */
  readonly ringDiameterMm: number;
};

// 'check' starts at the photo of a target already engraved, to see whether
// the saved calibration still holds (ADR-441 Amendment 1).
// 'nudge' lines a calibrated camera's picture up with one burned ring
// (ADR-663 Amendment 2).
export type CalibrationMode = 'calibrate' | 'check' | 'nudge';

// The margin and square size of the targets last engraved on this machine
// (ADR-441 Amendment 4), filled in when the wizard opens.
type RememberedLayout = Partial<
  Pick<
    CalibrationSettings,
    'marginMm' | 'headTargetSizeMm' | 'ringDiameterMm' | 'sheetWidthMm' | 'sheetHeightMm'
  >
>;

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
  // The bed frame that area was engraved in, read only with targetArea; null
  // when the saved calibration did not keep it (rolling audit 12-P2-2).
  readonly targetBedFrame: CameraBedFrame | null;
  // The bed frame as this nudge's ring started burning; null for a ring
  // burned earlier, which is judged by the frame at the photo.
  readonly nudgeRingBedFrame: CameraBedFrame | null;
  /** The guided setup from its first screen, choosing the camera (ADR-663). */
  readonly openSetup: () => void;
  /** The quick nudge fix for a calibrated camera fixed above the bed. */
  readonly openNudge: () => void;
  /** Straight to the target, for a camera already chosen and placed. */
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
  // About A4: a sheet most workshops have. Measured, it keeps the picture
  // within 0.2 mm on the sheet and 1.3 mm across a 400 mm bed (Amendment 8).
  sheetWidthMm: 300,
  sheetHeightMm: 200,
  headCamera: false,
  headTargetSizeMm: 40,
  ringDiameterMm: DEFAULT_RING_DIAMETER_MM,
};

const INITIAL_STEP: CalibrationStep = { kind: 'setup', note: null };
const MISSING_TARGET_LAYOUT_NOTE =
  "This calibration's target layout was not saved, so it cannot be checked against the old target. " +
  'Recalibrate with a new engraved target, or confirm the original bed size and enter the exact original margins ' +
  'and sheet thickness before choosing Target already engraved. Your saved calibration is unchanged.';
const UNRECORDED_TARGET_FRAME_NOTE =
  'This calibration was saved before KerfDesk recorded the bed it was calibrated on, so Check camera cannot tell ' +
  'where its target lies on the bed now. If Machine Setup is unchanged since the calibration, choose Confirm bed and origin in ' +
  'the Camera panel and check again; otherwise recalibrate with a new engraved target. Your saved calibration is unchanged.';

// A newly opened wizard knows no engraved target or burned ring yet.
const NO_KNOWN_TARGET = {
  targetArea: null,
  targetBedFrame: null,
  nudgeRingBedFrame: null,
} as const;

export const useCameraCalibrationStore = create<CameraCalibrationStore>((set) => ({
  open: false,
  mode: 'calibrate',
  minimized: false,
  step: INITIAL_STEP,
  settings: DEFAULT_CALIBRATION_SETTINGS,
  ...NO_KNOWN_TARGET,
  openSetup: () =>
    set((s) => ({
      open: true,
      mode: 'calibrate',
      minimized: false,
      step: { kind: 'camera' },
      ...NO_KNOWN_TARGET,
      settings: withRemembered(s.settings),
    })),
  openNudge: () =>
    set((s) => ({
      open: true,
      mode: 'nudge',
      minimized: false,
      step: { kind: 'nudge-setup', note: null },
      ...NO_KNOWN_TARGET,
      settings: withRemembered(s.settings),
    })),
  openWizard: () =>
    set((s) => ({
      open: true,
      mode: 'calibrate',
      minimized: false,
      step: INITIAL_STEP,
      ...NO_KNOWN_TARGET,
      settings: withRemembered(s.settings),
    })),
  // Check needs the target that was actually engraved, in the bed frame it was
  // engraved in. Current bed/margin settings cannot stand in for the layout,
  // nor today's frame for a frame that was never saved: labelling the rings in
  // today's frame reports no drift after a bed change, and saving that refit
  // would record the wrong frame for good (meta audit M2-P3-3).
  openCheck: (saved) =>
    set((s) => {
      const area = saved.accuracy.targetArea;
      const frame = saved.bedFrame;
      const checkable = area !== undefined && frame !== undefined;
      return {
        open: true,
        mode: checkable ? 'check' : 'calibrate',
        minimized: false,
        step: checkable
          ? { kind: 'photo', status: { kind: 'idle' } }
          : {
              kind: 'setup',
              note: area === undefined ? MISSING_TARGET_LAYOUT_NOTE : UNRECORDED_TARGET_FRAME_NOTE,
            },
        settings: {
          ...withRemembered(s.settings),
          sheetThicknessMm: saved.accuracy.targetHeightMm,
          headCamera: saved.mount?.kind === 'head',
          ringDiameterMm: saved.accuracy.targetRingDiameterMm ?? DEFAULT_RING_DIAMETER_MM,
        },
        targetArea: checkable ? area : null,
        targetBedFrame: checkable ? frame : null,
      };
    }),
  closeWizard: () => set({ open: false, minimized: false, step: INITIAL_STEP }),
  toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
  // A new margin or target size describes a new target, so a known area no longer applies.
  updateSettings: (patch) =>
    set((s) => ({
      settings: sanitized({ ...s.settings, ...patch }),
      ...(patch.marginMm === undefined &&
      patch.sheetWidthMm === undefined &&
      patch.sheetHeightMm === undefined &&
      patch.headCamera === undefined &&
      patch.headTargetSizeMm === undefined &&
      patch.ringDiameterMm === undefined
        ? {}
        : { targetArea: null }),
    })),
  setStep: (step) => set({ step }),
}));

// The wizard starts from the layout of the last target engraved on the open
// project's machine, so "Target already engraved" finds that target after a
// restart.
function withRemembered(settings: CalibrationSettings): CalibrationSettings {
  const remembered: RememberedLayout = rememberedLayoutSettings(useStore.getState().project.device);
  return Object.keys(remembered).length === 0
    ? settings
    : sanitized({ ...settings, ...remembered });
}

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
    sheetWidthMm: positiveOr(settings.sheetWidthMm, d.sheetWidthMm),
    sheetHeightMm: positiveOr(settings.sheetHeightMm, d.sheetHeightMm),
    headCamera: settings.headCamera,
    headTargetSizeMm:
      settings.headTargetSizeMm > 0 && Number.isFinite(settings.headTargetSizeMm)
        ? settings.headTargetSizeMm
        : d.headTargetSizeMm,
    ringDiameterMm:
      settings.ringDiameterMm > 0 && Number.isFinite(settings.ringDiameterMm)
        ? settings.ringDiameterMm
        : d.ringDiameterMm,
  };
}

function positiveOr(value: number, fallback: number): number {
  return value > 0 && Number.isFinite(value) ? value : fallback;
}

function atLeast(value: number, min: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, value);
}
