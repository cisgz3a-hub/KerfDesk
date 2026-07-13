import { create } from 'zustand';
import { solveTwoPointRegistration, type SimilarityTransform } from '../../core/registration';
import type { PrintAndCutDesignTargets, Project, Vec2 } from '../../core/scene';

type CapturedPoint = { readonly point: Vec2; readonly epoch: number };

type PrintCutSessionState = {
  readonly first: CapturedPoint | null;
  readonly second: CapturedPoint | null;
  readonly capture: (which: 'first' | 'second', point: Vec2, epoch: number) => void;
  readonly clear: () => void;
};

export const usePrintCutSessionStore = create<PrintCutSessionState>((set) => ({
  first: null,
  second: null,
  capture: (which, point, epoch) => set({ [which]: { point, epoch } }),
  clear: () => set({ first: null, second: null }),
}));

export type PrintCutRegistrationState =
  | { readonly kind: 'inactive' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'valid'; readonly transform: SimilarityTransform };

export function resolvePrintCutRegistration(
  project: Project,
  epoch: number,
  session: Pick<PrintCutSessionState, 'first' | 'second'>,
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
  return solveRegistration(targets, session.first.point, session.second.point);
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
