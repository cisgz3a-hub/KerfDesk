import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from './gcode-render-model';
import { countBySeverity, findProgramIssues } from './program-findings';
import type { GcodeRenderModel } from './render-model-types';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function idsOf(text: string): ReadonlyArray<string> {
  return findProgramIssues(model(text)).map((finding) => finding.id);
}

// A well-formed program: units declared, spindle on before cutting, feeds
// set, rapids stay above the work, and it ends properly.
const CLEAN = [
  'G21 G90',
  'M3 S600',
  'G0 X10 Y10',
  'G1 Z-1 F200',
  'G1 X60 Y10 F800',
  'G0 Z5',
  'M5',
  'M2',
].join('\n');

describe('findProgramIssues', () => {
  it('reports nothing for a well-formed program', () => {
    expect(findProgramIssues(model(CLEAN))).toEqual([]);
  });

  it('flags lateral rapids that cross the work below Z0', () => {
    const finding = findProgramIssues(
      model(['G21 G90', 'M3 S600', 'G1 Z-2 F200', 'G0 X50', 'M2'].join('\n')),
    ).find((entry) => entry.id === 'rapid-through-material');
    expect(finding?.severity).toBe('warning');
    expect(finding?.count).toBe(1);
    expect(finding?.detail).toContain('-2.00');
  });

  it('flags rapid plunges but never an ordinary rapid retract', () => {
    const plunge = findProgramIssues(
      model(['G21 G90', 'M3 S600', 'G0 Z-3', 'G1 X10 F100', 'M2'].join('\n')),
    ).find((entry) => entry.id === 'rapid-plunge');
    expect(plunge?.severity).toBe('warning');
    expect(plunge?.detail).toContain('-3.00');

    // G0 Z5 from depth is the correct, universal retract — never a finding.
    const retractOnly = idsOf(
      ['G21 G90', 'M3 S600', 'G1 Z-1 F200', 'G1 X10 F800', 'G0 Z5', 'M2'].join('\n'),
    );
    expect(retractOnly).not.toContain('rapid-plunge');
    expect(retractOnly).not.toContain('rapid-through-material');
  });

  it('flags cutting that starts before the spindle is on', () => {
    const early = findProgramIssues(
      model(['G21 G90', 'G1 X10 F300', 'M3 S600', 'M2'].join('\n')),
    ).find((entry) => entry.id === 'cut-before-spindle');
    expect(early?.severity).toBe('warning');
    expect(early?.detail).toContain('line 2');

    const never = idsOf(['G21 G90', 'G1 X10 F300', 'M2'].join('\n'));
    expect(never).toContain('cut-before-spindle');
  });

  it('flags cutting moves with no feed rate', () => {
    const finding = findProgramIssues(
      model(['G21 G90', 'M3 S600', 'G1 X10', 'G1 X20', 'M2'].join('\n')),
    ).find((entry) => entry.id === 'cut-without-feed');
    expect(finding?.severity).toBe('warning');
    expect(finding?.count).toBe(2);
    expect(finding?.line).toBe(2);
  });

  it('notices missing units, missing end, junk, and lines after the end', () => {
    expect(idsOf(['G90', 'M3 S1', 'G1 X10 F100'].join('\n'))).toEqual(
      expect.arrayContaining(['units-not-declared', 'no-program-end']),
    );
    const ids = idsOf(['G21 G90', 'M3 S1', 'G1 X10 F100', '!!!???', 'M2', 'G1 X20'].join('\n'));
    expect(ids).toContain('junk-line');
    expect(ids).toContain('lines-after-end');
  });

  it('reports unsupported words and undrawable moves', () => {
    const findings = findProgramIssues(
      model(['G21 G90', 'M3 S1', 'G64 P0.1', 'G1 X10 F100', 'G2 X20 Y5', 'M2'].join('\n')),
    );
    const unsupported = findings.find((entry) => entry.id === 'unsupported-word:G64');
    expect(unsupported?.severity).toBe('info');
    const skipped = findings.find((entry) => entry.id === 'skipped-motion');
    expect(skipped?.severity).toBe('notice');
    expect(skipped?.detail).toContain('arc needs I/J or R');
  });

  it('notices a program that parses but never moves', () => {
    expect(idsOf('G21 G90\nM3 S0\nM5')).toContain('no-motion');
  });

  it('orders findings most-severe first, then by line', () => {
    const findings = findProgramIssues(model(['G90', 'G1 X10', 'G64', '!!!', 'G0 Z-5'].join('\n')));
    const severities = findings.map((finding) => finding.severity);
    const ranks = { warning: 2, notice: 1, info: 0 };
    for (let index = 1; index < severities.length; index += 1) {
      const previous = ranks[severities[index - 1] ?? 'info'];
      const current = ranks[severities[index] ?? 'info'];
      expect(previous).toBeGreaterThanOrEqual(current);
    }
  });
});

describe('countBySeverity', () => {
  it('tallies each severity', () => {
    expect(countBySeverity(findProgramIssues(model(CLEAN)))).toEqual({
      info: 0,
      notice: 0,
      warning: 0,
    });
    const counts = countBySeverity(findProgramIssues(model('G90\nG1 X10\nG0 Z-5')));
    expect(counts.warning).toBeGreaterThan(0);
  });
});
