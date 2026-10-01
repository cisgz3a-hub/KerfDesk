import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { buildGrblFrameRetract } from '../../core/controllers/grbl/frame-lines';
import { buildCncFrameMotion } from './cnc-frame-lines';
import {
  createFramedRunPermit,
  FRAME_RETURN_POSITION_CHANGED_MESSAGE,
  FRAME_START_POSITION_CHANGED_MESSAGE,
  framedRunCompletionIssue,
  framedRunControllerSnapshot,
  framedRunStartHandoffIssue,
  type FramedRunCandidate,
  type FramedRunControllerSource,
} from './framed-run';

type Representation = 'machine' | 'work' | 'both';

// Independent model of GRBL's float32 printFloat / printFloat_CoordValue:
// https://github.com/gnea/grbl/blob/master/grbl/print.c
// JavaScript toFixed alone misses the intermediate float32 rounding.
function grblCoordinate(mm: number, inches = false): number {
  let value = Math.fround(mm);
  // nuts_bolts.h uses this finite literal, not an exact 1 / 25.4 reciprocal.
  if (inches) value = Math.fround(value * Math.fround(0.0393701));
  const sign = value < 0 ? -1 : 1;
  value = Math.abs(value);
  const decimals = inches ? 4 : 3;
  let remaining = decimals;
  while (remaining >= 2) {
    value = Math.fround(value * 100);
    remaining -= 2;
  }
  if (remaining !== 0) value = Math.fround(value * 10);
  value = Math.fround(value + 0.5);
  return (sign * Math.trunc(value)) / 10 ** decimals;
}

function stepSource(
  machineSteps: number,
  offsetSteps: number,
  representation: Representation,
  inches = false,
  stepsPerMm = 400,
): FramedRunControllerSource {
  // GRBL reports sys_position / settings.steps_per_mm, and its direct WPos
  // subtracts the unprinted float offset before applying printFloat.
  const machineMm = Math.fround(machineSteps / stepsPerMm);
  const offsetMm = Math.fround(offsetSteps / stepsPerMm);
  const workMm = Math.fround(machineMm - offsetMm);
  const offset = { x: 0, y: 0, z: grblCoordinate(offsetMm, inches) };
  const statusReport: StatusReport = {
    state: 'Idle',
    subState: null,
    mPos: representation === 'work' ? null : { x: 0, y: 0, z: grblCoordinate(machineMm, inches) },
    wPos: representation === 'machine' ? null : { x: 0, y: 0, z: grblCoordinate(workMm, inches) },
    wco: offset,
    feed: 0,
    spindle: 0,
  };
  return {
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: { reportInches: inches, stepsPerMmZ: stepsPerMm },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    controllerBuildInfo: null,
    controllerBuildInfoObservation: null,
    statusReport,
    statusSequence: 19,
    wcoCache: offset,
    workOriginActive: true,
    workOriginSource: 'g92',
    workZReferenceEpoch: 3,
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 3 },
  } as FramedRunControllerSource;
}

function completion(
  offsetSteps: number,
  beforeRepresentation: Representation,
  afterRepresentation: Representation,
  inches = false,
): { candidate: FramedRunCandidate; completed: FramedRunControllerSource } {
  const before = stepSource(offsetSteps - 800, offsetSteps, beforeRepresentation, inches);
  const after = stepSource(offsetSteps + 2000, offsetSteps, afterRepresentation, inches);
  return {
    candidate: {
      controllerBeforeFrame: framedRunControllerSnapshot(before),
      returnToWorkPosition: { x: 0, y: 0 },
    } as FramedRunCandidate,
    completed: { ...before, statusReport: after.statusReport },
  };
}

// planner.c uses lround on the float32 absolute machine target * steps/mm.
// C's lround rounds half values away from zero, including negative targets.
function plannerTargetSteps(workZMm: number, offsetSteps: number, stepsPerMm: number): number {
  const offsetMm = Math.fround(offsetSteps / stepsPerMm);
  const machineTargetMm = Math.fround(Math.fround(workZMm) + offsetMm);
  const targetSteps = Math.fround(machineTargetMm * Math.fround(stepsPerMm));
  return Math.sign(targetSteps) * Math.floor(Math.abs(targetSteps) + 0.5);
}

describe('GRBL float32 owned safe-Z return measurements', () => {
  it('models a reachable opposing-sign half-tie and an exact physical Z5', () => {
    const source = stepSource(999, -1001, 'both');
    expect(Math.fround(Math.fround(999 / 400) - Math.fround(-1001 / 400))).toBe(5);
    expect(source.statusReport!.mPos!.z).toBe(2.498);
    expect(source.wcoCache!.z).toBe(-2.503);
    expect(source.statusReport!.wPos!.z).toBe(5);
    expect(source.statusReport!.mPos!.z - source.wcoCache!.z).toBeCloseTo(5.001, 12);
  });

  it.each([
    { name: 'opposing signs', offsetSteps: -1001 },
    { name: 'negative machine and offset', offsetSteps: -67535 },
  ])('models full-tick independent rounding with $name', ({ offsetSteps }) => {
    const source = stepSource(offsetSteps + 2000, offsetSteps, 'both');
    const machine = Math.fround((offsetSteps + 2000) / 400);
    const offset = Math.fround(offsetSteps / 400);
    expect(Math.fround(machine - offset)).toBe(5);
    expect(source.statusReport!.mPos!.z - source.wcoCache!.z).toBeCloseTo(5.001, 12);
  });

  it.each(
    [-1001, -67535].flatMap((offsetSteps) =>
      (['machine', 'work'] as const).flatMap((before) =>
        (['machine', 'work'] as const).map((after) => ({ offsetSteps, before, after })),
      ),
    ),
  )('accepts physical Z5 at offset step $offsetSteps, $before -> $after', (scenario) => {
    const { candidate, completed } = completion(
      scenario.offsetSteps,
      scenario.before,
      scenario.after,
    );
    expect(framedRunCompletionIssue(candidate, completed, 5)).toBeNull();
  });

  it('accepts an added direct WPos with independently rounded shared MPos', () => {
    const { candidate, completed } = completion(-1001, 'machine', 'both');
    expect(framedRunCompletionIssue(candidate, completed, 5)).toBeNull();
  });

  it('refuses an added WPos that hides machine Z outside the measurement interval', () => {
    const { candidate, completed } = completion(-1001, 'machine', 'both');
    const moved = {
      ...completed,
      statusReport: {
        ...completed.statusReport!,
        mPos: { ...completed.statusReport!.mPos!, z: 2.501 },
      },
    };
    expect(framedRunCompletionIssue(candidate, moved, 5)).toBe(
      FRAME_RETURN_POSITION_CHANGED_MESSAGE,
    );
  });

  it.each([false, true])(
    'accepts exact step-derived safe Z with inch reporting $inches',
    (inches) => {
      const { candidate, completed } = completion(-1001, 'machine', 'work', inches);
      expect(framedRunCompletionIssue(candidate, completed, 5)).toBeNull();
      const permit = createFramedRunPermit(candidate, completed);
      expect(framedRunStartHandoffIssue(permit, completed)).toBeNull();
    },
  );

  it.each([false, true])(
    'keeps later Start strict after float32 completion, inches=%s',
    (inches) => {
      const { candidate, completed } = completion(-1001, 'machine', 'work', inches);
      const permit = createFramedRunPermit(candidate, completed);
      const moved = {
        ...completed,
        statusReport: {
          ...completed.statusReport!,
          wPos: {
            ...completed.statusReport!.wPos!,
            z: completed.statusReport!.wPos!.z + (inches ? 0.0001 : 0.002),
          },
        },
      };
      expect(framedRunStartHandoffIssue(permit, moved)).toBe(FRAME_START_POSITION_CHANGED_MESSAGE);
    },
  );

  it.each([-1, 1])(
    'refuses a direct WPos one-tick change on an exact inch-grid target, %s',
    (direction) => {
      const before = stepSource(-20000, -19800, 'work', true, 10000);
      const after = stepSource(-19800 + 38100 + direction * 25, -19800, 'work', true, 10000);
      const candidate = {
        controllerBeforeFrame: framedRunControllerSnapshot(before),
        returnToWorkPosition: { x: 0, y: 0 },
      } as FramedRunCandidate;
      const completed = { ...before, statusReport: after.statusReport };
      expect(framedRunCompletionIssue(candidate, completed, 3.81)).toBe(
        FRAME_RETURN_POSITION_CHANGED_MESSAGE,
      );
    },
  );

  it.each(
    [400, 800].flatMap((stepsPerMm) =>
      [5, 3.8, 3.801].flatMap((targetMm) =>
        [false, true].flatMap((inches) =>
          (['machine', 'work'] as const).map((representation) => ({
            stepsPerMm,
            targetMm,
            inches,
            representation,
          })),
        ),
      ),
    ),
  )(
    'accepts the whole-step return for Z$targetMm at $stepsPerMm steps/mm, inches=$inches/$representation',
    ({ stepsPerMm, targetMm, inches, representation }) => {
      const before = stepSource(-2 * stepsPerMm, 0, representation, inches, stepsPerMm);
      const targetSteps = plannerTargetSteps(targetMm, 0, stepsPerMm);
      const after = stepSource(targetSteps, 0, representation, inches, stepsPerMm);
      const candidate = {
        controllerBeforeFrame: framedRunControllerSnapshot(before),
        returnToWorkPosition: { x: 0, y: 0 },
      } as FramedRunCandidate;
      const completed = { ...before, statusReport: after.statusReport };
      if (targetMm === 3.801) {
        expect(targetSteps).toBe(stepsPerMm === 400 ? 1520 : 3041);
      }
      expect(framedRunCompletionIssue(candidate, completed, targetMm)).toBeNull();
    },
  );

  it.each(['unobserved', 'stale-session', 'missing-Z'] as const)(
    'does not invent a physical Z tolerance from %s controller settings',
    (settingsState) => {
      const beforeBase = stepSource(-800, 0, 'work');
      const before: FramedRunControllerSource = {
        ...beforeBase,
        controllerSettings: settingsState === 'missing-Z' ? {} : { stepsPerMmZ: 100000 },
        controllerSettingsObservation:
          settingsState === 'unobserved'
            ? null
            : { sessionEpoch: settingsState === 'stale-session' ? 6 : 7, observedAt: 1 },
      };
      const after = stepSource(plannerTargetSteps(3.801, 0, 400), 0, 'work');
      const candidate = {
        controllerBeforeFrame: framedRunControllerSnapshot(before),
        returnToWorkPosition: { x: 0, y: 0 },
      } as FramedRunCandidate;
      const completed = { ...before, statusReport: after.statusReport };
      // Dispatch/settlement owns this changed Z. Unknown step resolution is
      // not an additional Frame policy gate; Start retains the actual report.
      expect(framedRunCompletionIssue(candidate, completed, 3.801)).toBeNull();
      const permit = createFramedRunPermit(candidate, completed);
      expect(framedRunStartHandoffIssue(permit, completed)).toBeNull();
    },
  );

  it.each([
    { stepsPerMm: 400, offsetSteps: -100000, restoreMm: 0.998, physicalReturnMm: 0.9975 },
    { stepsPerMm: 800, offsetSteps: -100000, restoreMm: 1.001, physicalReturnMm: 1.00125 },
  ])(
    'accepts the dispatched nonnegative restore within controller/report resolution, $stepsPerMm steps/mm',
    ({ stepsPerMm, offsetSteps, restoreMm, physicalReturnMm }) => {
      const before = stepSource(offsetSteps + stepsPerMm, offsetSteps, 'machine', true, stepsPerMm);
      const measuredBeforeMm = (before.statusReport!.mPos!.z - before.wcoCache!.z) * 25.4;
      const plan = buildCncFrameMotion({
        perimeter: [],
        safeZMm: 5,
        preFrameWorkZMm: measuredBeforeMm,
        hasCurrentWorkZEvidence: true,
        buildRetract: buildGrblFrameRetract,
        zFeed: 300,
        cncJobsSupported: true,
      });
      expect(plan.kind).toBe('ready');
      if (plan.kind !== 'ready') throw new Error(plan.message);
      expect(plan.lines).toEqual([
        '$J=G90 G21 Z5.000 F300\n',
        `$J=G90 G21 Z${restoreMm.toFixed(3)} F300\n`,
      ]);
      expect(plan.expectedReturnWorkZMm).toBe(restoreMm);
      const targetSteps = plannerTargetSteps(restoreMm, offsetSteps, stepsPerMm);
      // Rounded telemetry cannot reproduce the exact original physical Z.
      // The commanded restore changes one physical step in these examples.
      expect((targetSteps - offsetSteps) / stepsPerMm).toBe(physicalReturnMm);
      const after = stepSource(targetSteps, offsetSteps, 'machine', true, stepsPerMm);
      const candidate = {
        controllerBeforeFrame: framedRunControllerSnapshot(before),
        returnToWorkPosition: { x: 0, y: 0 },
      } as FramedRunCandidate;
      const completed = { ...before, statusReport: after.statusReport };
      expect(framedRunCompletionIssue(candidate, completed, plan.expectedReturnWorkZMm)).toBeNull();
      const permit = createFramedRunPermit(candidate, completed);
      expect(framedRunStartHandoffIssue(permit, completed)).toBeNull();
    },
  );
});
