import { describe, expect, it } from 'vitest';
import { normalizeExternalProgram, reviewExternalProgram } from '../../core/external-program';
import { createMarlinProgramReader } from '../../core/external-program/marlin-program-reader';
import { inspectGcodeText } from './gcode-inspector-parse';

describe('Marlin fan selector parser options', () => {
  // parser.h 2.1.2.8: FASTER_GCODE_PARSER retains the last parameter offset;
  // the slow parser searches the first. M107 selects P, not necessarily fan0.
  it.each(['M107 P0 P1', 'M106 P0 P1 S0', 'M107 P 0', 'M107 p0'])(
    'discloses ambiguous fan selection in %s without inferring fan0 switched off',
    (line) => {
      const read = createMarlinProgramReader('laser');
      expect(read('M106 S255').line).toBe('M106 S255');
      const result = read(line);
      expect(result.line).not.toMatch(/^M107$|^M106 S0$/);
      expect(result.warnings.join('\n')).toMatch(/parser|repeats/);
    },
  );

  it('carries the selector warning into the canonical external review with unchanged bytes', () => {
    const source = 'M106 S255\nM107 P0 P1\nG1 X10 F600';
    const normalized = normalizeExternalProgram(source, undefined, 'marlin');
    if (normalized.kind !== 'ok') throw new Error('normalization failed');
    const parsed = inspectGcodeText(normalized.program.gcode, {
      controllerKind: 'marlin',
      machineKind: 'laser',
      laserPowerControl: 'fan',
      boundsFromStart: true,
      initialPositionMm: { x: 0, y: 0, z: 0 },
    });
    if (parsed.parsed.kind !== 'ok' || parsed.analysis === null)
      throw new Error('inspection failed');
    const review = reviewExternalProgram(
      normalized.program.gcode,
      parsed.parsed.model,
      {
        controllerKind: 'marlin',
        machineKind: 'laser',
        laserMaxPowerS: 255,
      },
      parsed.analysis.findings,
    );
    expect(review.warnings.join('\n')).toContain('repeats a parameter');
    expect(parsed.parsed.model.stats.travelMm).toBe(0);
    expect(normalized.program.gcode).toContain('M107 P0 P1\n');
  });

  it('keeps ordinary fan0 off and nonzero-fan selection distinct', () => {
    const read = createMarlinProgramReader('laser');
    expect(read('M107 P0')).toEqual({ line: 'M107', warnings: [] });
    expect(read('M107 P1').warnings.join('\n')).toContain('another fan');
  });
});
