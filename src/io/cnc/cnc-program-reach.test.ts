import { describe, expect, it } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { cncProgramGeometry } from './cnc-program-geometry';
import { cncProgramReachWarnings } from './cnc-program-reach';
import { emitSavePreparedOutput } from '../../ui/laser/save-output-emission';
import { prepareOutput } from '../gcode';

const plan = DEFAULT_CNC_MACHINE_CONFIG.tools
  .slice(0, 1)
  .map((tool) => ({ id: tool.id, name: tool.name }));
const program = [
  'G21',
  'G90',
  'G54',
  'G0 Z15',
  'G0 X0 Y0',
  'G1 Z-2 F100',
  'G1 X10 Y0 F300',
  'G0 Z15',
  'G0 X20 Y0',
  'M5',
  'M30',
].join('\n');
describe('exact CNC program reach review', () => {
  it('preserves constant travel Z and excludes unknown initial approaches', () => {
    const result = cncProgramGeometry(program, plan);
    expect(result.sections[0]?.depthMm).toBe(2);
    expect(result.sections[0]?.paths.at(-1)).toEqual([
      { x: 10, y: 0, z: 15 },
      { x: 20, y: 0, z: 15 },
    ]);
    expect(result.sections[0]?.paths[0]).toEqual([{ x: 0, y: 0, z: 15 }]);
    expect(result.disclosures.join(' ')).toContain('unknown operator position');
    expect(result.incomplete).toBe(true);
  });
  it('resets geometry ownership at manual tool changes', () => {
    const result = cncProgramGeometry(
      program.replace('M30', 'M0\nG21\nG90\nG0 Z10\nG0 X30 Y40\nG1 Z-3\nG1 X35 Y40\nM30'),
      [...plan, { id: 'fine', name: 'Fine' }],
    );
    expect(result.sections).toHaveLength(2);
    expect(result.sections[1]?.tool?.id).toBe('fine');
    expect(result.sections[1]?.paths[0]).toEqual([{ x: 30, y: 40, z: 10 }]);
    expect(result.sections[1]?.depthMm).toBe(3);
  });
  it('inflates large-radius arc chords by the actual sampling error', () => {
    const result = cncProgramGeometry('G21\nG90\nG0 X10000 Y0 Z0\nG3 X0 Y10000 I-10000 J0', plan);
    expect(result.sections[0]?.pathToleranceMm).toBeGreaterThan(0.3);
    expect(result.sections[0]?.pathToleranceMm).toBeLessThan(0.4);
  });
  it('discloses allocation limits and missing tool identities', () => {
    const big =
      'G21\nG90\nG0 X0 Y0\n' +
      Array.from({ length: 50_050 }, (_, i) => 'G1 X' + (i + 1) + ' Y0').join('\n');
    expect(cncProgramGeometry(big, plan).disclosures.join(' ')).toContain('stopped at 50000');
    const project = {
      ...projectWithLine(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      cncSetup: {
        ...defaultCncMachiningSetup(),
        fixtures: [
          {
            id: 'F',
            name: 'Clamp',
            xMm: 10,
            yMm: 0,
            widthMm: 3,
            heightMm: 3,
            bottomZMm: 0,
            topZMm: 8,
          },
        ],
      },
    };
    expect(cncProgramReachWarnings(project, program).join(' ')).toContain(
      'no resolved cutter identity',
    );
  });
  it('opens on the job’s own bits, not unrelated library entries (audit F7-P3-1)', () => {
    const project = { ...projectWithLine(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    const starterVBit = DEFAULT_CNC_MACHINE_CONFIG.tools.find(
      (tool) => tool.shankDiameterMm !== undefined,
    );
    expect(starterVBit).toBeDefined();
    expect(cncProgramReachWarnings(project, program, plan)).toEqual([]);
  });
  it('warns for a fixture crossed by travel and never changes emitted bytes', () => {
    const tool = {
      ...DEFAULT_CNC_MACHINE_CONFIG.tools[0]!,
      fluteLengthMm: 10,
      stickoutMm: 20,
      shankDiameterMm: 6,
      holderSegments: [{ name: 'Holder', startMm: 20, lengthMm: 20, diameterMm: 25 }],
    };
    const project = {
      ...projectWithLine(),
      machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id },
      cncSetup: {
        ...defaultCncMachiningSetup(),
        fixtures: [
          {
            id: 'F',
            name: 'Clamp',
            xMm: 15,
            yMm: -2,
            widthMm: 2,
            heightMm: 4,
            bottomZMm: 0,
            topZMm: 20,
          },
        ],
      },
    };
    const warnings = cncProgramReachWarnings(project, program, [{ id: tool.id, name: tool.name }]);
    expect(warnings.join(' ')).toContain('Clamp');
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    const withWarnings = emitSavePreparedOutput(prepared, {});
    const baseline = emitSavePreparedOutput(
      prepareOutput({
        ...project,
        cncSetup: defaultCncMachiningSetup(),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      }),
      {},
    );
    expect(withWarnings.gcode).toBe(baseline.gcode);
    expect(withWarnings.kind).toBe('emitted');
  });
});

// One 0.01 mm-step zigzag level per millimetre of depth, `linesPerPass` lines each.
function levelsProgram(levels: number, linesPerPass: number): string[] {
  const lines = ['G0 Z5', 'G0 X0 Y0'];
  for (let level = 1; level <= levels; level++) {
    lines.push('G1 Z-' + level + ' F100');
    for (let i = 0; i < linesPerPass; i++)
      lines.push('G1 X' + (i % 2) * 2 + ' Y' + (i * 0.01).toFixed(2) + ' F600');
  }
  return lines;
}

describe('reach depth past the bounded geometry review (audit F7-P2-2, ADR-572 Amendment 2)', () => {
  const longBit = {
    id: 'long',
    name: 'Long bit',
    kind: 'end-mill' as const,
    diameterMm: 6,
    fluteLengthMm: 15,
    stickoutMm: 24,
  };
  const lateBit = {
    id: 'late',
    name: 'Late bit',
    kind: 'end-mill' as const,
    diameterMm: 1.588,
    fluteLengthMm: 4.7,
    stickoutMm: 12,
  };
  const project = {
    ...projectWithLine(),
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [longBit, lateBit], toolId: longBit.id },
  };
  const longPlan = [{ id: longBit.id, name: longBit.name }];
  const twoBitPlan = [...longPlan, { id: lateBit.id, name: lateBit.name }];
  // Level 16 starts after line 50,000, so the parse alone stops at Z-15.
  const deepLate = ['G21', 'G90', ...levelsProgram(16, 3_400)].join('\n');
  const lateSecondBit = [
    'G21',
    'G90',
    ...levelsProgram(10, 5_200),
    'M0',
    'G21',
    'G90',
    ...levelsProgram(8, 10),
  ].join('\n');

  it('compares the compiled deepest cut after line 50,000 with the flute length', () => {
    expect(cncProgramGeometry(deepLate, longPlan).sections[0]).toMatchObject({
      depthMm: 15,
      truncated: true,
    });
    const warnings = cncProgramReachWarnings(project, deepLate, longPlan, [16]);
    expect(warnings).toContain(
      'CNC reach review · Long bit: Cut depth 16 mm exceeds the recorded 15 mm flute length.',
    );
    expect(warnings.join(' ')).not.toContain('cut depth was read only');
  });
  it('never presents a partial depth read as complete', () => {
    const warnings = cncProgramReachWarnings(project, deepLate, longPlan);
    expect(warnings.join(' ')).not.toContain('exceeds the recorded');
    expect(warnings).toContain(
      "CNC reach review · Long bit: cut depth was read only up to where the geometry review stopped; deeper cuts later in this bit's section were not compared with its flute length or stickout.",
    );
  });
  it('reviews a second bit that starts after the geometry review stopped', () => {
    expect(lateSecondBit.split('\n').indexOf('M0') + 1).toBeGreaterThan(50_000);
    expect(cncProgramGeometry(lateSecondBit, twoBitPlan).sections).toHaveLength(1);
    const warnings = cncProgramReachWarnings(project, lateSecondBit, twoBitPlan, [10, 8]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'CNC reach review · Late bit: Cut depth 8 mm exceeds the recorded 4.7 mm flute length.',
        "CNC reach review · Late bit: no program geometry was reviewed for this bit's section; its fixture clearance was not evaluated.",
      ]),
    );
    const parsedOnly = cncProgramReachWarnings(project, lateSecondBit, twoBitPlan);
    expect(parsedOnly).toContain(
      "CNC reach review · Late bit: no program geometry was reviewed for this bit's section; its cut depth and fixture clearance were not evaluated.",
    );
    expect(parsedOnly.join(' ')).not.toContain('Late bit: Cut depth');
  });
});
