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
