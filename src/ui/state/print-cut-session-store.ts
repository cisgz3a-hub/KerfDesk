import { create } from 'zustand';
import { solveTwoPointRegistration, type SimilarityTransform } from '../../core/registration';
import type { PrintAndCutDesignTargets, Project, Vec2 } from '../../core/scene';

/** Where a registration point came from: the head jogged onto the mark, or the camera (ADR-443). */
export type CaptureSource = 'head' | 'camera';
/** Physical bed scene coordinates, or the legacy unverified controller-relative frame. */
export type CaptureCoordinateBasis = 'bed' | 'controller-relative';

type CapturedPoint = {
  readonly point: Vec2;
  readonly epoch: number;
  readonly coordinateFrameKey?: string;
  readonly source?: CaptureSource;
  readonly coordinateBasis?: CaptureCoordinateBasis;
};

type PrintCutSessionState = {
  readonly first: CapturedPoint | null;
  readonly second: CapturedPoint | null;
  readonly capture: (
    which: 'first' | 'second',
    point: Vec2,
    epoch: number,
    coordinateFrameKey?: string,
    source?: CaptureSource,
    coordinateBasis?: CaptureCoordinateBasis,
  ) => void;
  readonly clear: () => void;
};

export const usePrintCutSessionStore = create<PrintCutSessionState>((set) => ({
  first: null,
  second: null,
  capture: (which, point, epoch, coordinateFrameKey, source, coordinateBasis) =>
    set({
      [which]: {
        point,
        epoch,
        ...(coordinateFrameKey === undefined ? {} : { coordinateFrameKey }),
        ...(source === undefined ? {} : { source }),
        ...(coordinateBasis === undefined ? {} : { coordinateBasis }),
      },
    }),
  clear: () => set({ first: null, second: null }),
}));

export type PrintCutRegistrationState =
  | { readonly kind: 'inactive' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'valid'; readonly transform: SimilarityTransform };

/** A shared profile key does not prove camera and unverified head points share a basis. */
export function capturedBasisError(
  first: CapturedPoint | null,
  second: CapturedPoint | null,
): string | null {
  if (first === null || second === null) return null;
  const basis = (capture: CapturedPoint): CaptureCoordinateBasis =>
    capture.coordinateBasis ?? (capture.source === 'camera' ? 'bed' : 'controller-relative');
  return basis(first) === basis(second)
    ? null
    : 'The camera and head captures use different coordinate bases. Capture both points with the same source, or establish the controller-to-bed mapping before mixing sources.';
}

export function resolvePrintCutRegistration(
  project: Project,
  epoch: number,
  session: Pick<PrintCutSessionState, 'first' | 'second'>,
  coordinateFrameKey?: string,
): PrintCutRegistrationState {
  const targets = project.printAndCutTargets;
  if (targets === undefined) return { kind: 'inactive' };
  if (session.first === null || session.second === null) {
    return { kind: 'invalid', reason: 'Capture both machine registration points.' };
  }
  if (session.first.epoch !== epoch || session.second.epoch !== epoch) {
    return {
      kind: 'invalid',
      reason: 'Machine position trust changed. Capture both points again.',
    };
  }
  if (
    session.first.coordinateFrameKey !== session.second.coordinateFrameKey ||
    (coordinateFrameKey !== undefined &&
      (session.first.coordinateFrameKey !== coordinateFrameKey ||
        session.second.coordinateFrameKey !== coordinateFrameKey))
  ) {
    return {
      kind: 'invalid',
      reason: 'The registration coordinate frame changed. Capture both points again.',
    };
  }
  const basisError = capturedBasisError(session.first, session.second);
  return basisError === null
    ? solveRegistration(targets, session.first.point, session.second.point)
    : { kind: 'invalid', reason: basisError };
}

function solveRegistration(
  targets: PrintAndCutDesignTargets,
  first: Vec2,
  second: Vec2,
): PrintCutRegistrationState {
  const solved = solveTwoPointRegistration({
    design: [targets.first, targets.second],
    machine: [first, second],
  });
  return solved.ok
    ? { kind: 'valid', transform: solved.transform }
    : { kind: 'invalid', reason: solved.reason };
}
