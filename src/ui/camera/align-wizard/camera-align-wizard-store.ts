// camera-align-wizard-store — state machine for the bed-alignment wizard
// (F-CAM9): burn the five-marker pattern as a real job (or skip if already
// burned), clear the bed, then detect and solve. Ephemeral like the lens
// wizard's store; the solved alignment persists on the device profile.

import { create } from 'zustand';

export type AlignWizardStep =
  // Choose engrave power/speed and burn the pattern, or skip to detect.
  | { readonly kind: 'setup'; readonly note: string | null }
  // The marker job is streaming; the wizard watches it finish.
  | { readonly kind: 'burning' }
  // Burn done: everything except the burned markers must leave the bed.
  | { readonly kind: 'clear-bed' }
  // Capture + detect + solve (runAutoAlign).
  | { readonly kind: 'detect'; readonly status: DetectStatus }
  | { readonly kind: 'done'; readonly basis: 'raw' | 'rectified' };

export type DetectStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'failed'; readonly message: string };

export type CameraAlignWizardStore = {
  readonly open: boolean;
  // Collapsed to a small non-modal panel so the operator can watch the
  // machine burn and reach the bed while the wizard stays live (F-CAM9).
  readonly minimized: boolean;
  readonly step: AlignWizardStep;
  // Engrave settings for the marker burn; editable in setup, clamped sane.
  readonly powerPercent: number;
  readonly speedMmPerMin: number;
  // Height of the burned marker surface above the machine bed. A sheet used
  // for alignment is itself a plane, so its thickness is part of calibration.
  readonly planeHeightMm: number;

  readonly openWizard: () => void;
  readonly closeWizard: () => void;
  readonly toggleMinimized: () => void;
  readonly setPowerPercent: (value: number) => void;
  readonly setSpeedMmPerMin: (value: number) => void;
  readonly setPlaneHeightMm: (value: number) => void;
  readonly setStep: (step: AlignWizardStep) => void;
};

const MIN_POWER_PERCENT = 1;
const MAX_POWER_PERCENT = 100;
const MIN_SPEED_MM_PER_MIN = 100;
const MAX_SPEED_MM_PER_MIN = 20000;
// Match the pattern generator's conservative engrave defaults.
const DEFAULT_POWER_PERCENT = 35;
const DEFAULT_SPEED_MM_PER_MIN = 3000;
const MAX_PLANE_HEIGHT_MM = 500;

const INITIAL_STEP: AlignWizardStep = { kind: 'setup', note: null };

export const useCameraAlignWizardStore = create<CameraAlignWizardStore>((set) => ({
  open: false,
  minimized: false,
  step: INITIAL_STEP,
  powerPercent: DEFAULT_POWER_PERCENT,
  speedMmPerMin: DEFAULT_SPEED_MM_PER_MIN,
  planeHeightMm: 0,

  openWizard: () => set({ open: true, minimized: false, step: INITIAL_STEP }),
  closeWizard: () => set({ open: false, minimized: false, step: INITIAL_STEP }),
  toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
  setPowerPercent: (value) =>
    set({ powerPercent: clamp(value, MIN_POWER_PERCENT, MAX_POWER_PERCENT) }),
  setSpeedMmPerMin: (value) =>
    set({ speedMmPerMin: clamp(value, MIN_SPEED_MM_PER_MIN, MAX_SPEED_MM_PER_MIN) }),
  setPlaneHeightMm: (value) => set({ planeHeightMm: clamp(value, 0, MAX_PLANE_HEIGHT_MM) }),
  setStep: (step) => set({ step }),
}));

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
