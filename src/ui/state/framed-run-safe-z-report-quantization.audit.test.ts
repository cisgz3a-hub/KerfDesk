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

type Representation = 'machine' | 'work';

function sourceAt(
  workZMm: number,
  representation: Representation,
  inches: boolean,
  offsetZMm = 0,
): FramedRunControllerSource {
  // GRBL's stock printFloat_CoordValue uses 3 mm or 4 inch decimals.
  const coordinate = (mm: number): number =>
    Number((mm / (inches ? 25.4 : 1)).toFixed(inches ? 4 : 3));
  const offset = { x: 0, y: 0, z: coordinate(offsetZMm) };
  const statusReport: StatusReport = {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: coordinate(workZMm + offsetZMm) },
    wPos: representation === 'work' ? { x: 0, y: 0, z: coordinate(workZMm) } : null,
    wco: offset,
    feed: 0,
    spindle: 0,
  };
  return {
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: { reportInches: inches, stepsPerMmZ: 1000 },
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
  physicalReturnZMm: number,
  beforeRepresentation: Representation,
  afterRepresentation: Representation,
  inches: boolean,
  offsetZMm = 0,
): {
  candidate: FramedRunCandidate;
  completed: FramedRunControllerSource;
} {
  const before = sourceAt(-2, beforeRepresentation, inches, offsetZMm);
  const after = sourceAt(physicalReturnZMm, afterRepresentation, inches, offsetZMm);
  const completed = { ...before, statusReport: after.statusReport };
  return {
    candidate: {
      controllerBeforeFrame: framedRunControllerSnapshot(before),
      returnToWorkPosition: { x: 0, y: 0 },
    } as FramedRunCandidate,
    completed,
  };
}

describe('CNC safe-Z completion with independently rounded controller reports', () => {
  it.each([
    { inches: false, safeZMm: 5 },
    { inches: true, safeZMm: 3.81 },
  ])('accepts the exact-report control $inches/$safeZMm', ({ inches, safeZMm }) => {
    const { candidate, completed } = completion(safeZMm, 'machine', 'work', inches);
    expect(framedRunCompletionIssue(candidate, completed, safeZMm)).toBeNull();
  });

  it.each<[Representation, Representation]>([
    ['machine', 'machine'],
    ['work', 'work'],
    ['machine', 'work'],
    ['work', 'machine'],
  ])('accepts commanded Z5 reported in inches, %s -> %s', (before, after) => {
    const { candidate, completed } = completion(5, before, after, true);
    expect(completed.statusReport!.mPos!.z).toBe(0.1969);
    expect(framedRunCompletionIssue(candidate, completed, 5)).toBeNull();
  });

  it.each<[Representation, Representation]>([
    ['machine', 'machine'],
    ['machine', 'work'],
    ['work', 'machine'],
  ])('accepts independently rounded inch MPos/WCO, %s -> %s', (before, after) => {
    const { candidate, completed } = completion(3.8, before, after, true, 1.99);
    expect(completed.statusReport!.mPos!.z).toBe(0.228);
    expect(completed.wcoCache!.z).toBe(0.0783);
    expect(framedRunCompletionIssue(candidate, completed, 3.8)).toBeNull();
  });

  it.each([
    { inches: false, representation: 'machine' as const },
    { inches: false, representation: 'work' as const },
    { inches: true, representation: 'machine' as const },
    { inches: true, representation: 'work' as const },
  ])('accepts the driver-rounded target $inches/$representation', ({ inches, representation }) => {
    const motion = buildCncFrameMotion({
      perimeter: [],
      safeZMm: 3.80149,
      preFrameWorkZMm: -2,
      hasCurrentWorkZEvidence: true,
      buildRetract: buildGrblFrameRetract,
      zFeed: 300,
      cncJobsSupported: true,
    });
    expect(motion.kind).toBe('ready');
    if (motion.kind !== 'ready') throw new Error(motion.message);
    expect(motion.lines).toEqual(['$J=G90 G21 Z3.801 F300\n']);
    // Physical motion follows the dispatched bytes, not the unrounded setting.
    const { candidate, completed } = completion(3.801, representation, representation, inches);
    expect(framedRunCompletionIssue(candidate, completed, motion.expectedReturnWorkZMm)).toBeNull();
  });

  it.each([
    { direction: -1, representation: 'machine' as const, offsetZMm: 0 },
    { direction: 1, representation: 'machine' as const, offsetZMm: 0 },
    { direction: -1, representation: 'work' as const, offsetZMm: 0 },
    { direction: 1, representation: 'work' as const, offsetZMm: 0 },
    { direction: -1, representation: 'machine' as const, offsetZMm: 1.99 },
    { direction: 1, representation: 'machine' as const, offsetZMm: 1.99 },
    { direction: -1, representation: 'work' as const, offsetZMm: 1.99 },
    { direction: 1, representation: 'work' as const, offsetZMm: 1.99 },
  ])(
    'interprets a $direction inch report tick at an exact-grid Z target, $representation/WCO$offsetZMm',
    ({ direction, representation, offsetZMm }) => {
      // 3.81 mm is exactly 0.1500 inch. Direct WPos distinguishes a whole
      // report-tick displacement. Independently printed MPos/WCO cannot:
      // GRBL's float32 half-ties can also produce a full-tick difference at
      // the correct target (framed-run-grbl-float32-return.audit.test.ts).
      const physicalZ = 3.81 + direction * 0.0001 * 25.4;
      const { candidate, completed } = completion(
        physicalZ,
        representation,
        representation,
        true,
        offsetZMm,
      );
      expect(framedRunCompletionIssue(candidate, completed, 3.81)).toBe(
        representation === 'work' ? FRAME_RETURN_POSITION_CHANGED_MESSAGE : null,
      );
    },
  );

  it.each([
    { direction: -1, offsetZMm: 0 },
    { direction: 1, offsetZMm: 0 },
    { direction: -1, offsetZMm: 1.99 },
    { direction: 1, offsetZMm: 1.99 },
  ])(
    'refuses two MPos/WCO inch report ticks, $direction/WCO$offsetZMm',
    ({ direction, offsetZMm }) => {
      const { candidate, completed } = completion(
        3.81 + direction * 0.0002 * 25.4,
        'machine',
        'machine',
        true,
        offsetZMm,
      );
      expect(framedRunCompletionIssue(candidate, completed, 3.81)).toBe(
        FRAME_RETURN_POSITION_CHANGED_MESSAGE,
      );
    },
  );

  it.each([-1, 1])(
    'refuses a machine-only report tick when no WCO subtraction is needed, %s',
    (direction) => {
      const { candidate, completed } = completion(
        3.81 + direction * 0.0001 * 25.4,
        'machine',
        'machine',
        true,
      );
      const withoutOffset = (source: FramedRunControllerSource): FramedRunControllerSource => ({
        ...source,
        wcoCache: null,
        workOriginActive: false,
        workOriginSource: 'none',
      });
      const before = withoutOffset({
        ...completed,
        statusReport: sourceAt(-2, 'machine', true).statusReport,
      });
      const unoffsetCandidate = {
        ...candidate,
        controllerBeforeFrame: framedRunControllerSnapshot(before),
      };
      expect(framedRunCompletionIssue(unoffsetCandidate, withoutOffset(completed), 3.81)).toBe(
        FRAME_RETURN_POSITION_CHANGED_MESSAGE,
      );
    },
  );

  it.each([-1, 1])('still refuses an unexpected %s0.1 mm Z displacement', (direction) => {
    const { candidate, completed } = completion(5 + direction * 0.1, 'machine', 'work', true);
    expect(framedRunCompletionIssue(candidate, completed, 5)).toBe(
      FRAME_RETURN_POSITION_CHANGED_MESSAGE,
    );
  });

  it.each([
    { axis: 'x' as const, direction: -1 },
    { axis: 'x' as const, direction: 1 },
    { axis: 'y' as const, direction: -1 },
    { axis: 'y' as const, direction: 1 },
  ])('does not excuse an owned-return $axis/$direction report tick', ({ axis, direction }) => {
    const { candidate, completed } = completion(3.81, 'machine', 'work', true);
    const moved: FramedRunControllerSource = {
      ...completed,
      statusReport: {
        ...completed.statusReport!,
        mPos: { ...completed.statusReport!.mPos!, [axis]: direction * 0.0001 },
        wPos: { ...completed.statusReport!.wPos!, [axis]: direction * 0.0001 },
      },
    };
    expect(framedRunCompletionIssue(candidate, moved, 3.81)).toBe(
      FRAME_RETURN_POSITION_CHANGED_MESSAGE,
    );
  });

  it.each([
    { axis: 'x' as const, direction: -1 },
    { axis: 'x' as const, direction: 1 },
    { axis: 'y' as const, direction: -1 },
    { axis: 'y' as const, direction: 1 },
    { axis: 'z' as const, direction: -1 },
    { axis: 'z' as const, direction: 1 },
  ])('keeps later Start strict on $axis/$direction report tick', ({ axis, direction }) => {
    const { candidate, completed } = completion(5, 'machine', 'work', true, 1.99);
    const permit = createFramedRunPermit(candidate, completed);
    const moved: FramedRunControllerSource = {
      ...completed,
      statusReport: {
        ...completed.statusReport!,
        mPos: {
          ...completed.statusReport!.mPos!,
          [axis]: completed.statusReport!.mPos![axis] + direction * 0.0001,
        },
        wPos: {
          ...completed.statusReport!.wPos!,
          [axis]: completed.statusReport!.wPos![axis] + direction * 0.0001,
        },
      },
    };
    expect(framedRunStartHandoffIssue(permit, completed)).toBeNull();
    expect(framedRunStartHandoffIssue(permit, moved)).toBe(FRAME_START_POSITION_CHANGED_MESSAGE);
  });
});
