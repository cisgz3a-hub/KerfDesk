import { describe, expect, it } from 'vitest';
import { buildProgramTime } from '../../core/gcode-time';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { droRows, statsRows } from './inspector-readouts';
import { inspectorProgramTime } from './inspector-model';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

const PROGRAM = ['G21 G90', 'M3 S600', 'G0 X10 Y0', 'G1 Z-2 F200', 'G1 X30 Y0 F800', 'G0 Z5'].join(
  '\n',
);

describe('droRows', () => {
  it('reports the final modal position, feed, power, and 1-based line', () => {
    const rows = droRows(model(PROGRAM));
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get('X')).toBe('30 mm');
    expect(byLabel.get('Z')).toBe('5 mm');
    expect(byLabel.get('S')).toBe('600');
    expect(byLabel.get('Line')).toBe('6');
  });

  it('renders placeholders for a motionless program', () => {
    const rows = droRows(model('G21 G90\nM3 S0\nM5'));
    expect(rows.every((row) => row.value === '—')).toBe(true);
  });
});

// Legend moved to lenses.ts (ADR-255 stage 9); covered by lenses.test.ts.

describe('statsRows', () => {
  it('summarizes size, distances, ranges, and Z levels', () => {
    const rows = statsRows(model(PROGRAM));
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get('Cut')).toBe('20 mm');
    expect(byLabel.get('Traversal')).toBe('10 mm');
    expect(byLabel.get('Plunge')).toBe('2 mm');
    expect(byLabel.get('Feed range')).toBe('200–800 mm/min');
    expect(byLabel.get('Power range')).toBe('600');
    expect(byLabel.get('Z levels')).toBe('1 (deepest -2 mm)');
    expect(byLabel.get('Segments')).toBe('4');
  });

  // ADR-255 amendment 2: the rapid in from the assumed 0,0 is drawn but not
  // measured, so X spans the 10 to 30 mm the program cuts, not 0 to 30.
  it('measures Size from where the program goes, not from the assumed start', () => {
    const size = statsRows(model(PROGRAM)).find((row) => row.label === 'Size')?.value;
    expect(size).toBe('20 × 0 × 7 mm');
  });

  it('says whose limits the estimated time assumes (ADR-425)', () => {
    const parsed = model(PROGRAM);
    const time = inspectorProgramTime(
      parsed,
      buildProgramTime(parsed, {
        accelMmPerSec2: 500,
        junctionDeviationMm: 0.01,
        maxFeedMmPerMin: 6000,
      }),
    );
    const timedFor = (name: string | null): string | undefined =>
      statsRows(parsed, time, name).find((row) => row.label === 'Timed for')?.value;
    expect(timedFor('Shop laser')).toBe('Shop laser');
    expect(timedFor(null)).toBe('Stock GRBL limits');
    expect(statsRows(parsed).some((row) => row.label === 'Timed for')).toBe(false);
  });
});

// Findings moved to core/gcode-view/program-findings (ADR-255 stage 6) and
// are covered by program-findings.test.ts.
