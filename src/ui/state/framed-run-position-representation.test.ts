import { describe, expect, it } from 'vitest';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import {
  createFramedRunPermit,
  FRAME_CONTROLLER_CHANGED_MESSAGE,
  FRAME_RETURN_POSITION_CHANGED_MESSAGE,
  FRAME_START_ORIGIN_CHANGED_MESSAGE,
  FRAME_START_POSITION_CHANGED_MESSAGE,
  FRAME_START_REPORT_UNITS_CHANGED_MESSAGE,
  framedRunCompletionIssue,
  framedRunControllerSnapshot,
  framedRunStartHandoffIssue,
  type FramedRunCandidate,
  type FramedRunControllerSource,
} from './framed-run';

const ZERO = { x: 0, y: 0, z: 0 };
const samples = [
  {
    units: 'mm',
    reportInches: false,
    offset: { x: 10.002, y: 20.002, z: -4.002 },
    machine: '<Idle|MPos:20.005,40.006,-1.005>',
    work: '<Idle|WPos:10.002,20.003,2.996>',
    movedWork: '<Idle|WPos:10.001,20.003,2.996>',
    movedMachine: '<Idle|MPos:20.007,40.006,-1.005>',
  },
  {
    units: 'inch',
    reportInches: true,
    offset: { x: 0.5002, y: 0.7002, z: -0.2002 },
    machine: '<Idle|MPos:1.0005,1.4006,-0.1005>',
    work: '<Idle|WPos:0.5002,0.7003,0.0996>',
    movedWork: '<Idle|WPos:0.5001,0.7003,0.0996>',
    movedMachine: '<Idle|MPos:1.0006,1.4006,-0.1005>',
  },
];

function source(
  wire: string,
  patch: Partial<FramedRunControllerSource> = {},
): FramedRunControllerSource {
  return {
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: { reportInches: false },
    controllerSettingsObservation: null,
    controllerBuildInfo: null,
    controllerBuildInfoObservation: null,
    statusReport: parseStatusReport(wire),
    statusSequence: 19,
    wcoCache: ZERO,
    workOriginActive: true,
    workOriginSource: 'g92',
    trustedPositionEpoch: 0,
    workZReferenceEpoch: 0,
    workZZeroEvidence: null,
    ...patch,
  };
}

function candidateFor(before: FramedRunControllerSource): FramedRunCandidate {
  return { controllerBeforeFrame: framedRunControllerSnapshot(before) } as FramedRunCandidate;
}

const phases = [
  {
    name: 'Frame completion',
    positionMessage: FRAME_RETURN_POSITION_CHANGED_MESSAGE,
    originMessage: FRAME_CONTROLLER_CHANGED_MESSAGE,
    unitsMessage: FRAME_CONTROLLER_CHANGED_MESSAGE,
    check: (before: FramedRunControllerSource, after: FramedRunControllerSource) =>
      framedRunCompletionIssue(candidateFor(before), after),
  },
  {
    name: 'final Start handoff',
    positionMessage: FRAME_START_POSITION_CHANGED_MESSAGE,
    originMessage: FRAME_START_ORIGIN_CHANGED_MESSAGE,
    unitsMessage: FRAME_START_REPORT_UNITS_CHANGED_MESSAGE,
    check: (before: FramedRunControllerSource, after: FramedRunControllerSource) =>
      framedRunStartHandoffIssue(createFramedRunPermit(candidateFor(before), before), after),
  },
];

describe.each(phases)(
  '$name position reports',
  ({ check, positionMessage, originMessage, unitsMessage }) => {
    it.each(samples)('accepts rounded $units MPos/WPos in both directions', (sample) => {
      const before = source(sample.machine, {
        controllerSettings: { reportInches: sample.reportInches },
        wcoCache: sample.offset,
      });
      const after = { ...before, statusReport: parseStatusReport(sample.work) };
      expect(check(before, after)).toBeNull();
      expect(check(after, before)).toBeNull();
    });

    it.each(samples)('rejects $units movement beyond one conversion tick', (sample) => {
      const before = source(sample.machine, {
        controllerSettings: { reportInches: sample.reportInches },
        wcoCache: sample.offset,
      });
      const after = { ...before, statusReport: parseStatusReport(sample.movedWork) };
      expect(check(before, after)).toBe(positionMessage);
      expect(check(after, before)).toBe(positionMessage);
    });

    it.each(samples)('keeps direct MPos evidence when a $units WPos field is added', (sample) => {
      const before = source(sample.machine, {
        controllerSettings: { reportInches: sample.reportInches },
        wcoCache: sample.offset,
      });
      const after = {
        ...before,
        statusReport: {
          ...parseStatusReport(sample.machine)!,
          wPos: parseStatusReport(sample.work)!.wPos,
        },
      };
      expect(check(before, after)).toBeNull();
      expect(check(after, before)).toBeNull();
      const moved = {
        ...after,
        statusReport: { ...after.statusReport, mPos: parseStatusReport(sample.movedMachine)!.mPos },
      };
      expect(check(before, moved)).toBe(positionMessage);
      expect(check(moved, before)).toBe(positionMessage);
    });

    it.each(['MPos', 'WPos'])('retains the existing 0.001 mm direct %s tolerance', (field) => {
      const before = source(`<Idle|${field}:0,0,0>`);
      expect(
        check(before, { ...before, statusReport: parseStatusReport(`<Idle|${field}:0.0005,0,0>`) }),
      ).toBeNull();
      expect(
        check(before, { ...before, statusReport: parseStatusReport(`<Idle|${field}:0.0011,0,0>`) }),
      ).toBe(positionMessage);
      const inches = { ...before, controllerSettings: { reportInches: true } };
      expect(
        check(inches, {
          ...inches,
          statusReport: parseStatusReport(`<Idle|${field}:0.0001,0,0>`),
        }),
      ).toBe(positionMessage);
    });

    it('does not grant inch conversion tolerance on zero-offset axes', () => {
      const before = source('<Idle|MPos:1,2,3>', {
        controllerSettings: { reportInches: true },
        wcoCache: { x: 0, y: 1, z: 0 },
      });
      for (const work of ['1.0001,1,3', '1,1,3.0001']) {
        expect(
          check(before, { ...before, statusReport: parseStatusReport(`<Idle|WPos:${work}>`) }),
        ).toBe(positionMessage);
      }
    });

    it('keeps exact offset and origin provenance at both boundaries', () => {
      const before = source('<Idle|MPos:1,2,3>');
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(check(before, { ...before, wcoCache: { ...ZERO, [axis]: 0.0001 } })).toBe(
          originMessage,
        );
      }
      for (const patch of [
        { workOriginActive: false },
        { workOriginSource: 'unknown' as const },
        { trustedPositionEpoch: 1 },
      ]) {
        expect(check(before, { ...before, ...patch })).toBe(originMessage);
      }
      const unknown = {
        ...before,
        wcoCache: null,
        workOriginActive: false,
        workOriginSource: 'none' as const,
      };
      expect(check(unknown, { ...unknown, wcoCache: ZERO })).toBe(originMessage);
    });

    it('refuses missing coordinates or an unresolved offset needed for MPos', () => {
      const before = source('<Idle|MPos:1,2,3>');
      for (const statusReport of [null, parseStatusReport('<Idle>')]) {
        expect(check(before, { ...before, statusReport })).toBe(positionMessage);
      }
      const unknown = { ...before, wcoCache: null };
      expect(check(unknown, unknown)).toBe(positionMessage);
      const workOnly = { ...unknown, statusReport: parseStatusReport('<Idle|WPos:1,2,3>') };
      expect(check(workOnly, workOnly)).toBeNull();
    });

    it('binds report-unit interpretation even when every coordinate is zero', () => {
      for (const reportInches of [false, true]) {
        const before = source('<Idle|WPos:0,0,0>', { controllerSettings: { reportInches } });
        expect(
          check(before, { ...before, controllerSettings: { reportInches: !reportInches } }),
        ).toBe(unitsMessage);
      }
    });
  },
);
