import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dTheme } from '../viewer3d';
import { droRows, findingsSummary, legendEntries, statsRows } from './inspector-readouts';

const THEME: Viewer3dTheme = {
  background: 0x000000,
  gridMinor: 0x111111,
  gridMajor: 0x222222,
  travel: 0xcc4444,
  cut: 0x4fa3ff,
  plunge: 0xffb84d,
  retract: 0x9a7fd4,
};

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

describe('legendEntries', () => {
  it('counts each move kind with its theme swatch', () => {
    const entries = legendEntries(model(PROGRAM), THEME);
    const byLabel = new Map(entries.map((entry) => [entry.label, entry]));
    expect(byLabel.get('Cut')?.count).toBe(1);
    expect(byLabel.get('Plunge')?.count).toBe(1);
    expect(byLabel.get('Retract')?.count).toBe(1);
    expect(byLabel.get('Traversal')?.count).toBe(1);
    expect(byLabel.get('Traversal')?.color).toBe('#cc4444');
  });
});

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
});

describe('findingsSummary', () => {
  it('is null for a clean program and lists findings otherwise', () => {
    expect(findingsSummary(model(PROGRAM))).toBeNull();
    const summary = findingsSummary(model('G21\nG99 X1\nG2 X5 Y5'));
    expect(summary).toContain('unsupported G99');
    expect(summary).toContain('first line 2');
    expect(summary).toContain('skipped move');
  });
});
