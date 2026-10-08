import { describe, expect, it } from 'vitest';
import { reachBenchmark } from '../../__fixtures__/cnc-leader-fixtures';
import { emitGcode, prepareOutput } from '../gcode';
import { parseGcodeProgram } from '../gcode/parse-gcode-program';
import { cncProgramFacts } from './cnc-program-facts';
import { cncProgramGeometry } from './cnc-program-geometry';
import { cncProgramReachWarnings } from './cnc-program-reach';

const PLAN = [{ id: 'end-mill', name: 'End mill' }];
const PROGRAM = [
  'G21',
  'G90',
  'G54',
  'G94',
  'G17',
  'G0 Z15',
  'G0 X0 Y0',
  'G1 Z-2 F100',
  'G1 X10 Y0 F300',
].join('\n');

describe('exact emitted-program geometry modal acknowledgements', () => {
  it('preserves native geometry across both G94 manual-tool sections without changing output', () => {
    const prepared = prepareOutput(reachBenchmark());
    if (!prepared.ok) throw new Error('The native reach fixture must prepare.');
    const program = emitGcode(prepared.project).gcode;
    const plan = cncProgramFacts(prepared.job, prepared.project).toolPlan;
    expect(program).toMatch(/^G21\nG90\nG54\nG94\nG17\n/);
    expect(program.match(/^M0$/gm)).toHaveLength(1);
    expect(program.match(/^G94$/gm)).toHaveLength(2);
    const reviewed = cncProgramGeometry(program, plan);
    expect(reviewed.sections).toHaveLength(2);
    expect(reviewed.sections.map((section) => section.tool?.id)).toEqual(
      plan.map((tool) => tool.id),
    );
    const withoutFeedMode = cncProgramGeometry(program.replace(/^G94(?:\r?\n|$)/gm, ''), plan);
    expect(reviewed).toEqual(withoutFeedMode);
    expect(reviewed.disclosures.join(' ')).not.toContain('unsupported G94');
    expect(reviewed.disclosures.join(' ')).toContain('unknown operator position');
    expect(reviewed.disclosures.join(' ')).toContain('after each manual tool change');
    expect(reviewed.incomplete).toBe(true);
    const warnings = cncProgramReachWarnings(prepared.project, program, plan).join(' ');
    expect(warnings).not.toContain('unsupported G94');
    expect(warnings).toContain('Raised clamp');
    expect(warnings).toContain('flute length');
    expect(warnings).toContain('stickout');
    expect(warnings).toContain('Path coverage is incomplete');
    expect(warnings).toContain('physical clearance are not qualified');
    expect(emitGcode(prepared.project).gcode).toBe(program);
  });

  it('leaves the general imported-program parser and its exact G94 note unchanged', () => {
    const parsed = parseGcodeProgram(PROGRAM);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    expect(parsed.notes).toContain('1× unsupported G94');
    const acknowledged = cncProgramGeometry(PROGRAM, PLAN);
    expect(acknowledged.sections[0]?.depthMm).toBe(2);
    expect(acknowledged.disclosures.join(' ')).not.toContain(
      'Geometry interpretation is incomplete',
    );
    expect(acknowledged.incomplete).toBe(true);
  });

  it.each(['G28', 'G53', 'G92', 'G93', 'G95', 'G94.1', 'G940', 'G55', 'G54.1'])(
    'continues to disclose unsupported %s alongside exact G94',
    (code) => {
      const reviewed = cncProgramGeometry(PROGRAM + '\n' + code + ' X25 Y0', PLAN);
      expect(reviewed.disclosures.join(' ')).toContain('unsupported ' + code);
      expect(reviewed.disclosures.join(' ')).not.toMatch(/unsupported G94(?:;|$)/);
      expect(reviewed.incomplete).toBe(true);
    },
  );

  it.each(['G18', 'G19'])('preserves the unsupported %s plane error', (plane) => {
    const reviewed = cncProgramGeometry(PROGRAM + '\n' + plane, PLAN);
    expect(reviewed.disclosures.join(' ')).toContain(plane + ' plane arcs are not supported');
    expect(reviewed.incomplete).toBe(true);
  });

  it('preserves the segment allocation budget for exact G94 arc programs', () => {
    const arcs = PROGRAM + '\n' + Array.from({ length: 280 }, () => 'G2 X10 Y0 I-5 J0').join('\n');
    const reviewed = cncProgramGeometry(arcs, PLAN);
    expect(reviewed.disclosures.join(' ')).toContain('100000-segment allocation budget');
    expect(reviewed.incomplete).toBe(true);
  });

  it('preserves malformed-text and bounded line-coverage disclosures', () => {
    const malformed = cncProgramGeometry(PROGRAM + '\nG94oops', PLAN);
    expect(malformed.disclosures.join(' ')).toContain('Uninterpretable program text');
    expect(malformed.incomplete).toBe(true);
    const oversized =
      PROGRAM + '\n' + Array.from({ length: 50_001 }, (_, i) => 'G1 X' + i + ' Y0').join('\n');
    const bounded = cncProgramGeometry(oversized, PLAN);
    expect(bounded.disclosures.join(' ')).toContain('stopped at 50000');
    expect(bounded.incomplete).toBe(true);
  });
});
