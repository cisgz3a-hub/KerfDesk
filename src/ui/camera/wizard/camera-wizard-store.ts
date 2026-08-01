// Camera lens-calibration wizard state (ADR-108 v2.e). A thin Zustand shell
// around the PURE calibration session: captures accumulate as
// BoardObservations, the solve runs through the focal sweep, and the review
// step holds the A/B raw/rectified frames. Ephemeral like the camera store —
// closing the wizard discards everything except an applied calibration (which
// the Apply action persists onto the device profile from the component layer).

import { create } from 'zustand';
import {
  addCapture,
  type CalibrationSession,
  type CheckerboardSpec,
  detectCheckerboard,
  emptySession,
  type RgbaImage,
  rectifyImage,
  solveSession,
  toBoardObservation,
  toGrayImage,
} from '../../../core/camera';
import {
  cameraBindingCompatibility,
  type CameraCaptureBinding,
} from '../../../core/camera/camera-capture-binding';

export type WizardStep = 'setup' | 'capture' | 'review';

export type CaptureRejection = 'not-found' | 'resolution-changed' | 'source-changed';

export type CameraWizardStore = {
  readonly open: boolean;
  // Collapsed to a small non-modal panel so the operator can watch the camera
  // and reach the machine while capturing (F-CAM2 fixed-camera workflow).
  readonly minimized: boolean;
  readonly step: WizardStep;
  readonly spec: CheckerboardSpec;
  readonly spacingMm: number;
  readonly autoCapture: boolean;
  readonly session: CalibrationSession;
  // Frame size every capture must share; set by the first capture.
  readonly frameWidth: number;
  readonly frameHeight: number;
  // Source identity and pixel geometry of the first accepted capture. Every
  // later capture and the persisted calibration must use this exact binding.
  readonly captureBinding: CameraCaptureBinding | null;
  // The most recent full-res capture and its rectified counterpart (review A/B).
  readonly lastFrame: RgbaImage | null;
  readonly rectifiedFrame: RgbaImage | null;
  readonly abMode: 'raw' | 'rectified';
  readonly solving: boolean;
  readonly lastRejection: CaptureRejection | null;

  readonly openWizard: () => void;
  readonly closeWizard: () => void;
  readonly toggleMinimized: () => void;
  readonly setSpec: (spec: CheckerboardSpec) => void;
  readonly setSpacingMm: (mm: number) => void;
  readonly setAutoCapture: (on: boolean) => void;
  readonly setStep: (step: WizardStep) => void;
  readonly setAbMode: (mode: 'raw' | 'rectified') => void;
  // Full-resolution capture: re-detects on the supplied frame and appends a
  // BoardObservation, or records why the frame was rejected.
  readonly addCaptureFrame: (frame: RgbaImage, capture: CameraCaptureBinding) => void;
  readonly invalidateCaptureSource: (capture: CameraCaptureBinding) => void;
  readonly beginSolve: () => void;
  // The actual solve; the component defers this one tick so "Solving…" paints.
  readonly completeSolve: () => void;
  readonly resetSession: () => void;
};

// Default printable board: 9×6 inner corners, 10 mm squares (any checkerboard
// works — the operator enters the true square size).
const DEFAULT_SPEC: CheckerboardSpec = { rows: 6, cols: 9 };
const DEFAULT_SPACING_MM = 10;
// Generous budget per the ADR-108 v2.b note: realistic solves end on the
// iteration cap while micro-improving; hundreds of iterations cost seconds.
const SOLVE_MAX_ITERATIONS = 600;

function clearedCaptureState(lastRejection: CaptureRejection | null) {
  return {
    session: emptySession(),
    frameWidth: 0,
    frameHeight: 0,
    captureBinding: null,
    lastFrame: null,
    rectifiedFrame: null,
    solving: false,
    lastRejection,
  };
}

const INITIAL = {
  open: false,
  minimized: false,
  step: 'setup' as WizardStep,
  spec: DEFAULT_SPEC,
  spacingMm: DEFAULT_SPACING_MM,
  autoCapture: true,
  ...clearedCaptureState(null),
  abMode: 'rectified' as const,
};

export const useCameraWizardStore = create<CameraWizardStore>((set, get) => ({
  ...INITIAL,

  openWizard: () => set({ ...INITIAL, open: true }),
  closeWizard: () => set({ open: false, minimized: false }),
  toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
  setSpec: (spec) => set({ spec, ...clearedCaptureState(null) }),
  setSpacingMm: (mm) => set({ spacingMm: mm }),
  setAutoCapture: (on) => set({ autoCapture: on }),
  setStep: (step) => set({ step }),
  setAbMode: (mode) => set({ abMode: mode }),

  addCaptureFrame: (frame, capture) => {
    const state = get();
    if (capture.width !== frame.width || capture.height !== frame.height) {
      set({ lastRejection: 'resolution-changed' });
      return;
    }
    if (state.captureBinding !== null) {
      const compatibility = cameraBindingCompatibility(state.captureBinding, capture);
      if (compatibility === 'source-mismatch') {
        set({ ...clearedCaptureState('source-changed'), step: 'capture' });
        return;
      }
      if (compatibility === 'geometry-mismatch') {
        set({ lastRejection: 'resolution-changed' });
        return;
      }
    }
    if (
      state.frameWidth !== 0 &&
      (frame.width !== state.frameWidth || frame.height !== state.frameHeight)
    ) {
      // The stream resolution changed mid-session; older captures are in a
      // different pixel basis, so they cannot be mixed with this one.
      set({ lastRejection: 'resolution-changed' });
      return;
    }
    const detection = detectCheckerboard(toGrayImage(frame), state.spec);
    if (detection.kind !== 'ok') {
      set({ lastRejection: 'not-found' });
      return;
    }
    set({
      session: addCapture(
        state.session,
        toBoardObservation(detection, state.spec, state.spacingMm),
      ),
      frameWidth: frame.width,
      frameHeight: frame.height,
      captureBinding: state.captureBinding ?? capture,
      lastFrame: frame,
      lastRejection: null,
    });
  },

  invalidateCaptureSource: (capture) => {
    const saved = get().captureBinding;
    if (saved === null || cameraBindingCompatibility(saved, capture) === 'match') return;
    set({ ...clearedCaptureState('source-changed'), step: 'capture' });
  },

  beginSolve: () => set({ solving: true, step: 'review' }),

  completeSolve: () => {
    const state = get();
    const session = solveSession(state.session, {
      initialGuess: { imageWidth: state.frameWidth, imageHeight: state.frameHeight },
      distortionModel: 'k1k2',
      maxIterations: SOLVE_MAX_ITERATIONS,
    });
    const rectifiedFrame =
      session.kind === 'solved' && state.lastFrame !== null
        ? rectifyImage(state.lastFrame, {
            width: state.lastFrame.width,
            height: state.lastFrame.height,
            outputK: session.result.intrinsics,
            sourceK: session.result.intrinsics,
            distortion: session.result.distortion,
          })
        : null;
    set({ session, rectifiedFrame, solving: false });
  },

  resetSession: () => set({ ...clearedCaptureState(null), step: 'capture' }),
}));
