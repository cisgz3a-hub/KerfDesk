// An opened program's Frame covers its XZ and YZ arcs (audit 26-K1 / WA-4,
// ADR-630 Amendment 2). Each case runs the Run dialog's own chain: normalize
// the file, inspect the sent bytes from where the head stands with
// boundsFromStart, review them with Program Health's findings, prepare the
// run, and build the Frame's GRBL jogs from its envelope. Every point GRBL
// visits, from an independent reading of gcode.c and mc_arc, must lie inside
// the rectangle those jogs trace. Before the fix the arcs added nothing, so
// these Frames stopped 10 to 30 mm short, or half a raster wide.

import { describe, expect, it } from 'vitest';
import { buildGrblFrameJogLines } from '../../core/controllers/grbl/frame-lines';
import {
  normalizeExternalProgram,
  reviewExternalProgram,
  type ExternalProgramEnvelope,
} from '../../core/external-program';
import {
  grblExecutedPoints,
  type ExecutedPoint,
} from '../../core/gcode-view/grbl-arc-reference.test-support';
import { inspectGcodeText } from './gcode-inspector-parse';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';
import { prepareExternalRun } from './prepare-external-run';

const HEAD = { x: 0, y: 0, z: 10 };
// The jogs carry three decimals.
const JOG_MM = 0.0005;

function prepare(file: string) {
  const normalized = normalizeExternalProgram(file);
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  const inspected = inspectGcodeText(normalized.program.gcode, {
    machineKind: 'cnc',
    boundsFromStart: true,
    initialPositionMm: HEAD,
  });
  if (!hasGcodeInspectorAnalysis(inspected)) throw new Error(inspected.parsed.reason);
  const prepared = prepareExternalRun('part.nc', normalized.program, HEAD, (gcode) =>
    reviewExternalProgram(
      gcode,
      inspected.parsed.model,
      { machineKind: 'cnc', laserMaxPowerS: 1000, start: HEAD },
      inspected.analysis.findings,
    ),
  );
  if (prepared.kind !== 'ready') throw new Error(prepared.reasons.join('\n'));
  return prepared;
}

/** The rectangle the Frame's jogs trace. */
function tracedOutline(envelope: ExternalProgramEnvelope): ExternalProgramEnvelope {
  const corners = buildGrblFrameJogLines(envelope, 1000).map((line) => ({
    x: Number(/X(-?[\d.]+)/.exec(line)?.[1]),
    y: Number(/Y(-?[\d.]+)/.exec(line)?.[1]),
  }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function outside(points: ReadonlyArray<ExecutedPoint>, outline: ExternalProgramEnvelope) {
  return points.filter(
    (point) =>
      point.x < outline.minX - JOG_MM ||
      point.x > outline.maxX + JOG_MM ||
      point.y < outline.minY - JOG_MM ||
      point.y > outline.maxY + JOG_MM,
  );
}

// The traced outline holds every executed point, and is no larger than the
// motion: the Frame shows where the part is, not a padded box.
function expectFrameCoversRun(file: string): ExternalProgramEnvelope {
  const prepared = prepare(file);
  const outline = tracedOutline(prepared.run.envelope);
  const executed = grblExecutedPoints(prepared.run.gcode, HEAD);
  expect(outside(executed, outline)).toEqual([]);
  expect(outline.minX).toBeCloseTo(Math.min(...executed.map((point) => point.x)), 2);
  expect(outline.maxX).toBeCloseTo(Math.max(...executed.map((point) => point.x)), 2);
  expect(outline.minY).toBeCloseTo(Math.min(...executed.map((point) => point.y)), 2);
  expect(outline.maxY).toBeCloseTo(Math.max(...executed.map((point) => point.y)), 2);
  const warnings = prepared.review.warnings.join('\n');
  expect(warnings).not.toContain('could not');
  expect(warnings).not.toContain('does not interpret K');
  return outline;
}

const plunge = 'G21 G90\nG0 X0 Y0 Z5\nM3 S12000\nG1 Z-1 F100\nG1 X10 F600\n';
const finish = 'G0 Z5\nG17\nG0 X0 Y0\nM5\nM30\n';

describe('the external-run Frame covers G18 and G19 arcs (ADR-630 Amendment 2)', () => {
  it.each([
    ['I/K', 'G18 G2 X20 Z-1 I5 K0'],
    ['R', 'G18 G2 X20 Z-1 R5'],
  ])('frames a G18 arc in %s form to the X it reaches', (_form, arc) => {
    // Before: X 0..10, while GRBL moves to X20.
    expect(expectFrameCoversRun(`${plunge}${arc}\n${finish}`)).toMatchObject({ minX: 0, maxX: 20 });
  });

  it('frames a raster of G18 arcs across the whole part', () => {
    const passes = [-20, -10, 0, 10, 20].map((y, index) =>
      index % 2 === 0 ? `G1 Y${y}\nG3 X25 Z0 I25 K0` : `G1 Y${y}\nG2 X-25 Z0 R25`,
    );
    const file = `G21 G90\nG0 X-25 Y-20 Z5\nM3 S12000\nG1 Z0 F300\nG18\n${passes.join('\n')}\n${finish}`;
    // Before: X -25..0, half the part.
    expect(expectFrameCoversRun(file)).toMatchObject({ minX: -25, maxX: 25, minY: -20, maxY: 20 });
  });

  it.each([
    ['J/K and I/K', 'G19 G3 Y0 Z-1 J30 K0', 'G18 G2 X50 Z29 I0 K30'],
    ['R', 'G19 G3 Y0 Z-1 R30', 'G18 G2 X50 Z29 R30'],
  ])(
    'frames Fusion-style vertical lead-in and lead-out arcs in %s form',
    (_form, leadIn, leadOut) => {
      const file = [
        '%',
        '(1001)',
        '(T1  D=6.35 CR=0. - ZMIN=-1. - flat end mill)',
        'G90 G94 G17',
        'G21',
        '(2D Contour1)',
        'M3 S12000',
        'G0 X0 Y-30 Z15',
        'G1 Z29 F1000',
        `${leadIn} F800`,
        'G1 Y10',
        'G1 X20',
        leadOut,
        'G0 Z40',
        'G17',
        'M5',
        'M30',
        '%',
      ].join('\n');
      // Before: X 0..20, 30 mm short of the lead-out.
      expect(expectFrameCoversRun(file)).toMatchObject({ minX: 0, maxX: 50, minY: -30, maxY: 10 });
    },
  );

  it('frames the shorter Fusion G19 lead-out the audit measured', () => {
    // Before: Y 0..10, while GRBL moves to Y40.
    const file = `G21 G90\nG0 X0 Y0 Z5\nG1 Z-1 F100\nG1 Y10 F800\nG19 G3 Y40 Z29 J0 K30\n${finish}`;
    expect(expectFrameCoversRun(file)).toMatchObject({ minY: 0, maxY: 40 });
  });
});

describe('a move the Frame cannot place is named (ADR-630 Amendment 2)', () => {
  it.each([
    ['I/K', 'G18 G2 X20 Z-1 I4 K0', 'arc radius mismatch'],
    ['R', 'G18 G2 X30 Z-1 R5', 'arc radius too small'],
  ])(
    'warns that an unreadable %s arc is not in the Frame outline, without refusing',
    (_form, arc, reason) => {
      const prepared = prepare(`${plunge}${arc}\n${finish}`);
      const warnings = prepared.review.warnings.join('\n');
      expect(warnings).toContain('not in the Frame outline');
      // The baseline line goes first, so the file's sixth line is the seventh sent.
      expect(warnings).toContain('line 7 of the sent program');
      expect(warnings).toContain(reason);
      // Program Health's notice is replaced, not repeated.
      expect(warnings).not.toContain('Some moves could not be drawn');
    },
  );
});
