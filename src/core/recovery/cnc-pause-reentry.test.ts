import { describe, expect, it } from 'vitest';
import { createStreamer } from '../controllers/grbl';
import {
  cncPauseLiftLine,
  cncReentrySteps,
  planCncPauseReentry,
  type CncPauseReentryInput,
  type CncPauseReentryPlan,
} from './cnc-pause-reentry';

// The shape KerfDesk's CNC emitter writes: preamble, retract, spin-up with a
// dwell, coolant, a plunge and two depth passes round a square.
const PROGRAM = [
  'G21',
  'G90',
  'G54',
  'G94',
  'G17',
  'G0 Z5',
  'M3 S18000',
  'G4 P2.5',
  'M8',
  'G0 X0 Y0',
  'G1 Z-1 F150',
  'G1 X20 Y0 F900',
  'G1 X20 Y20',
  'G1 X0 Y20',
  'G1 X0 Y0',
  'G1 Z-2 F150',
  'G1 X20 Y0 F900',
  'G1 X20 Y20',
  'G1 X0 Y20',
  'G1 X0 Y0',
  'G0 Z5',
  'M5',
  'M9',
].join('\n');

const LINES = createStreamer(PROGRAM).queued;
const index = (line: string, from = 0): number => LINES.indexOf(`${line}\n`, from);

function plan(overrides: Partial<CncPauseReentryInput>): ReturnType<typeof planCncPauseReentry> {
  return planCncPauseReentry({
    lines: LINES,
    ackedLines: LINES.length,
    stopPoint: { x: 0, y: 0, z: 0 },
    controllerKind: 'grbl-v1.1',
    ...overrides,
  });
}

function expectPlan(result: ReturnType<typeof planCncPauseReentry>): CncPauseReentryPlan {
  if (result.kind !== 'plan') throw new Error(`expected a plan, got: ${result.reason}`);
  return result.plan;
}

describe('planCncPauseReentry', () => {
  it('re-enters a straight cut at the stop point with the program spin-up, coolant and feeds', () => {
    const secondPassFirstSide = index('G1 X20 Y0 F900', index('G1 Z-2 F150'));
    const result = expectPlan(
      plan({ ackedLines: secondPassFirstSide + 3, stopPoint: { x: 12.5, y: 0, z: -2 } }),
    );
    expect(result).toEqual({
      resumeLineIndex: secondPassFirstSide,
      entry: { x: 12.5, y: 0, z: -2 },
      safeZMm: 5,
      spindle: 'M3',
      spindleRpm: 18000,
      spinupSec: 2.5,
      mist: false,
      flood: true,
      plungeFeedMmPerMin: 150,
      motion: 1,
      feedMmPerMin: 150,
    });
  });

  it('takes the earliest line through the stop point, so a replay only ever recuts', () => {
    // (0,0,-2) ends the plunge to -2, starts the second pass and ends it.
    const result = expectPlan(plan({ stopPoint: { x: 0, y: 0, z: -2 } }));
    expect(result.resumeLineIndex).toBe(index('G1 Z-2 F150'));
    expect(result.entry).toEqual({ x: 0, y: 0, z: -2 });
  });

  it('only searches lines the planner may still have been running', () => {
    // (20,10,-1) is on the first pass only. The reserve floor (32 lines)
    // covers this short program, so it matches...
    const firstPassSide = index('G1 X20 Y20');
    expect(expectPlan(plan({ stopPoint: { x: 20, y: 10, z: -1 } })).resumeLineIndex).toBe(
      firstPassSide,
    );
    // ...but not once 40 more acknowledged lines stand between it and the pause.
    const secondPass = index('G1 Z-2 F150');
    const lines = [
      ...LINES.slice(0, secondPass),
      ...Array.from({ length: 40 }, () => 'G4 P0.001\n'),
      ...LINES.slice(secondPass),
    ];
    const far = planCncPauseReentry({
      lines,
      ackedLines: lines.length,
      stopPoint: { x: 20, y: 10, z: -1 },
      controllerKind: 'grbl-v1.1',
    });
    expect(far.kind).toBe('no-lift');
  });

  it('never looks behind an acknowledged tool change', () => {
    const lines = [
      ...LINES.slice(0, index('G1 Z-2 F150')),
      'M0\n',
      ...LINES.slice(index('G1 Z-2 F150')),
    ];
    const result = planCncPauseReentry({
      lines,
      ackedLines: lines.length,
      stopPoint: { x: 20, y: 10, z: -1 },
      controllerKind: 'grbl-v1.1',
    });
    expect(result).toEqual({
      kind: 'no-lift',
      reason: 'The stop point is not on any line the controller may have been running.',
    });
  });

  it('re-enters an arc at its start', () => {
    const arcProgram = [
      'G21',
      'G90',
      'G0 Z5',
      'M3 S12000',
      'G4 P1',
      'G0 X10 Y0',
      'G1 Z-1 F100',
      'G3 X0 Y10 I-10 J0 F600',
      'G0 Z5',
    ].join('\n');
    const lines = createStreamer(arcProgram).queued;
    const stop = { x: Math.cos(Math.PI / 4) * 10, y: Math.sin(Math.PI / 4) * 10, z: -1 };
    const result = expectPlan(
      planCncPauseReentry({
        lines,
        ackedLines: lines.length,
        stopPoint: stop,
        controllerKind: 'grblhal',
      }),
    );
    expect(result.resumeLineIndex).toBe(7);
    expect(result.entry).toEqual({ x: 10, y: 0, z: -1 });
    expect(result.plungeFeedMmPerMin).toBe(100);
  });

  it('includes the arc GRBL is still planning, which it acknowledges only once whole', () => {
    const lines = createStreamer(
      [
        'G21',
        'G90',
        'G0 Z5',
        'M3 S12000',
        'G4 P1',
        'G0 X10 Y0',
        'G1 Z-1 F100',
        'G3 X0 Y10 I-10 J0 F600',
        'G0 Z5',
      ].join('\n'),
    ).queued;
    const stop = { x: Math.cos(Math.PI / 8) * 10, y: Math.sin(Math.PI / 8) * 10, z: -1 };
    const input = { lines, ackedLines: 7, stopPoint: stop, controllerKind: 'grbl-v1.1' } as const;
    expect(planCncPauseReentry(input).kind).toBe('no-lift');
    expect(expectPlan(planCncPauseReentry({ ...input, sentLines: 9 })).resumeLineIndex).toBe(7);
  });

  it('refuses an arc line that relies on a modal G2/G3', () => {
    const lines = createStreamer(
      [
        'G21',
        'G90',
        'G0 Z5',
        'M3 S12000',
        'G4 P1',
        'G0 X10 Y0',
        'G1 Z-1 F100',
        'G3 X0 Y10 I-10 J0 F600',
        'X-10 Y0 I0 J-10',
      ].join('\n'),
    ).queued;
    const result = planCncPauseReentry({
      lines,
      ackedLines: lines.length,
      stopPoint: { x: -Math.cos(Math.PI / 4) * 10, y: Math.sin(Math.PI / 4) * 10, z: -1 },
      controllerKind: 'grbl-v1.1',
    });
    expect(result).toEqual({
      kind: 'no-lift',
      reason: 'The arc the bit stopped on does not name its own G2/G3.',
    });
  });

  it.each([
    ['G91', 'G91'],
    ['G92', 'G92 X0 Y0'],
    ['G53', 'G53 G0 Z0'],
    ['G20', 'G20'],
    ['G55', 'G55'],
    ['M6', 'M6 T2'],
  ])('refuses a program that uses %s', (_name, line) => {
    const lines = createStreamer(`${line}\n${PROGRAM}`).queued;
    const result = planCncPauseReentry({
      lines,
      ackedLines: lines.length,
      stopPoint: { x: 20, y: 10, z: -2 },
      controllerKind: 'grbl-v1.1',
    });
    expect(result.kind).toBe('no-lift');
  });

  it('needs no lift when the bit already stopped at safe height', () => {
    expect(plan({ stopPoint: { x: 0, y: 0, z: 5 } })).toMatchObject({ kind: 'no-lift' });
  });

  it('needs no lift when the spindle was off', () => {
    const lines = createStreamer(PROGRAM.replace('M3 S18000', 'M5')).queued;
    expect(
      planCncPauseReentry({
        lines,
        ackedLines: lines.length,
        stopPoint: { x: 20, y: 10, z: -2 },
        controllerKind: 'grbl-v1.1',
      }),
    ).toMatchObject({ kind: 'no-lift' });
  });

  it('refuses a program with no spin-up dwell', () => {
    const lines = createStreamer(PROGRAM.replace('G4 P2.5\n', '')).queued;
    expect(
      planCncPauseReentry({
        lines,
        ackedLines: lines.length,
        stopPoint: { x: 20, y: 10, z: -2 },
        controllerKind: 'grbl-v1.1',
      }),
    ).toEqual({
      kind: 'no-lift',
      reason: 'The program has no spin-up dwell after its spindle start.',
    });
  });

  it('refuses a stop point off the toolpath', () => {
    expect(plan({ stopPoint: { x: 10, y: 10, z: -2 } })).toMatchObject({ kind: 'no-lift' });
  });

  it('is not offered on FluidNC, whose reset at a hold is not qualified', () => {
    expect(plan({ stopPoint: { x: 20, y: 10, z: -2 }, controllerKind: 'fluidnc' })).toMatchObject({
      kind: 'no-lift',
    });
  });
});

describe('cncReentrySteps', () => {
  const base: CncPauseReentryPlan = {
    resumeLineIndex: 12,
    entry: { x: 12.5, y: 0, z: -2 },
    safeZMm: 5,
    spindle: 'M3',
    spindleRpm: 18000,
    spinupSec: 2.5,
    mist: false,
    flood: true,
    plungeFeedMmPerMin: 150,
    motion: 1,
    feedMmPerMin: 900,
  };

  it('lifts, spins up at safe height, returns, plunges, then restores the mode and feed', () => {
    expect(cncPauseLiftLine(base)).toBe('G0 Z5.000');
    expect(cncReentrySteps(base).map((step) => step.line)).toEqual([
      'G21 G90 G54 G94 G17',
      'G0 Z5.000',
      'M3 S18000',
      'G4 P2.5',
      'M8',
      'G0 X12.500 Y0.000',
      'G1 Z-2.000 F150',
      'G1 F900',
    ]);
  });

  it('restores a rapid mode without a feed it never had', () => {
    const steps = cncReentrySteps({ ...base, motion: 0, feedMmPerMin: 0, flood: false });
    expect(steps.at(-1)?.line).toBe('G0');
    expect(steps.some((step) => step.kind === 'coolant')).toBe(false);
  });
});
