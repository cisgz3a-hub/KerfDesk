// What the "camera moved?" check last concluded (ADR-663 Amendments 3 and 5),
// and whether the operator dismissed it. A warning stays until the view is
// confirmed where it was (a confident steady match, a calibration saved, a
// nudge or check kept) or is dismissed: a later weak or failed match never
// withdraws it (rolling audit v13 Y1-P2-2).

import { create } from 'zustand';
import type { Vec2 } from '../../../core/camera/model/camera-model';
import { MOVED_MM } from '../../../core/camera/model/view-shift';

export type CameraMovedState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'steady' }
  | {
      readonly kind: 'moved';
      /** The worst of {@link displacementsMm}, mm. */
      readonly mm: number;
      /**
       * For the bed's centre and four corners: where the bed point the
       * calibration now draws there truly is, less that point (the opposite of
       * where it now shows). Only sizes and differences are used.
       */
      readonly displacementsMm: ReadonlyArray<Vec2>;
      readonly calibratedAt: string;
    }
  | {
      /** The view around the bed no longer matches at all, check after check. */
      readonly kind: 'changed';
      readonly calibratedAt: string;
    };

/** The warning the operator dismissed: its calibration, and the shift it showed
 * (none for a view that no longer matched). */
export type CameraMovedDismissal = {
  readonly calibratedAt: string;
  readonly displacementsMm: ReadonlyArray<Vec2> | null;
};

type CameraMovedStore = {
  readonly state: CameraMovedState;
  readonly dismissedFor: CameraMovedDismissal | null;
  /** Weak or failed matches in a row, since the last measured result. */
  readonly weakChecks: number;
  readonly dismiss: () => void;
};

export const useCameraMovedStore = create<CameraMovedStore>((set, get) => ({
  state: { kind: 'unknown' },
  dismissedFor: null,
  weakChecks: 0,
  dismiss: () => {
    const { state } = get();
    set({
      dismissedFor:
        state.kind === 'moved'
          ? { calibratedAt: state.calibratedAt, displacementsMm: state.displacementsMm }
          : state.kind === 'changed'
            ? { calibratedAt: state.calibratedAt, displacementsMm: null }
            : null,
    });
  },
}));

/** A dismissed warning stays quiet while the camera stays where it was then:
 * the same calibration, and no point of the bed moved a further millimetre or
 * more. A view confirmed steady since (a nudge fix, a kept check) ends the
 * dismissal, so the next move warns again. */
export function cameraMovedWarningDismissed(
  state: CameraMovedState,
  dismissedFor: CameraMovedDismissal | null,
): boolean {
  if (dismissedFor === null) return false;
  if (state.kind === 'changed') {
    return (
      dismissedFor.calibratedAt === state.calibratedAt && dismissedFor.displacementsMm === null
    );
  }
  return (
    state.kind === 'moved' &&
    dismissedFor.calibratedAt === state.calibratedAt &&
    dismissedFor.displacementsMm !== null &&
    furthestChangeMm(state.displacementsMm, dismissedFor.displacementsMm) < MOVED_MM
  );
}

/** The largest change, over the bed's sample points, between two measured shifts. */
export function furthestChangeMm(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  return a.reduce((worst, p, i) => {
    const q = b[i];
    return q === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
  }, 0);
}

/** The warning showing for the camera calibrated at `calibratedAt`, if any. */
export function shownCameraMovedWarning(
  state: CameraMovedState,
  dismissedFor: CameraMovedDismissal | null,
  calibratedAt: string | undefined,
): Extract<CameraMovedState, { kind: 'moved' | 'changed' }> | null {
  if (state.kind !== 'moved' && state.kind !== 'changed') return null;
  if (calibratedAt === undefined || state.calibratedAt !== calibratedAt) return null;
  return cameraMovedWarningDismissed(state, dismissedFor) ? null : state;
}

/** True when the bed's corners moved differently from its centre: a turn or a
 * tip, which a single offset (Fix a small offset) cannot put right. */
export function cameraMovedTurned(state: Extract<CameraMovedState, { kind: 'moved' }>): boolean {
  const [centre, ...corners] = state.displacementsMm;
  if (centre === undefined) return false;
  return corners.some((d) => Math.hypot(d.x - centre.x, d.y - centre.y) >= MOVED_MM);
}

/** What Job Review says while a move warning shows and artwork is placed on the camera picture. */
export function cameraMovedJobWarning(
  shown: Extract<CameraMovedState, { kind: 'moved' | 'changed' }>,
): string {
  if (shown.kind === 'changed') {
    return 'Camera placement is on, but the camera may have moved: what it sees around the bed no longer matches its calibration, so artwork placed on the camera picture may not burn where it shows. Use Check camera in the Camera panel, or calibrate again, and watch the Frame.';
  }
  const fix = cameraMovedTurned(shown)
    ? 'Use Check camera in the Camera panel, or calibrate again: the camera turned, which Fix a small offset cannot put right'
    : 'Use Fix a small offset or Check camera in the Camera panel';
  return `Camera placement is on, but the camera may have moved: parts of the bed may show up to about ${shown.mm.toFixed(1)} mm from where they burn, so artwork placed on the camera picture may burn that far off. ${fix}, and watch the Frame.`;
}
