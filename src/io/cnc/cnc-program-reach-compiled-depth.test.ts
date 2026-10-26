import { beforeAll, describe, expect, it } from 'vitest';
import {
  benchmarkLayer,
  benchmarkProject,
  benchmarkVector,
} from '../../__fixtures__/cnc-leader-fixtures';
import type { Project } from '../../core/scene';
import { emitSavePreparedOutput } from '../../ui/laser/save-output-emission';
import { prepareOutput } from '../gcode';
import { cncProgramFacts } from './cnc-program-facts';
import { cncProgramGeometry } from './cnc-program-geometry';
import { buildCncToolPrograms } from './cnc-tool-programs';

// Audit F7-P2-2 through the real compile (ADR-572 Amendment 2): a 16 mm cut whose
// last level starts after line 50,000, then a second bit after the M0.
// End mill 6 records a 15 mm flute, End mill 2 a 6 mm flute.
function longTwoBitJob(): Project {
  const base = benchmarkProject();
  if (base.machine?.kind !== 'cnc') throw new Error('The benchmark is a CNC project.');
  const zigzag = Array.from({ length: 3_400 }, (_, i) => ({
    x: 5 + (i % 2) * 2,
    y: 10 + i * 0.01,
  }));
  return {
    ...base,
    machine: { ...base.machine, stock: { ...base.machine.stock, thicknessMm: 19 } },
    scene: {
      layers: [
        benchmarkLayer('deep', { cutType: 'profile-on-path', toolId: 'end6', depthMm: 16 }),
        benchmarkLayer('late', { cutType: 'profile-on-path', toolId: 'end2', depthMm: 8 }),
      ],
      objects: [
        benchmarkVector('deep-zigzag', [{ closed: false, points: zigzag }], ['deep']),
        benchmarkVector(
          'late-line',
          [
            {
              closed: false,
              points: [
                { x: 60, y: 20 },
                { x: 80, y: 20 },
              ],
            },
          ],
          ['late'],
        ),
      ],
    },
  };
}

describe('CNC reach depth comes from the compiled job', () => {
  let prepared: Extract<ReturnType<typeof prepareOutput>, { ok: true }>;
  beforeAll(() => {
    const result = prepareOutput(longTwoBitJob());
    if (!result.ok) throw new Error('The long two-bit job must prepare.');
    prepared = result;
  });

  it('Save names the late deepest level and the bit after line 50,000', () => {
    const emission = emitSavePreparedOutput(prepared, {});
    if (emission.kind !== 'emitted') throw new Error('The long two-bit job must emit.');
    const lines = emission.gcode.split('\n');
    expect(lines.indexOf('M0') + 1).toBeGreaterThan(50_000);
    // The bounded parse alone stops above the flute length and before the second bit.
    const parsed = cncProgramGeometry(
      emission.gcode,
      cncProgramFacts(prepared.job, prepared.project).toolPlan,
    );
    expect(parsed.sections.map((section) => section.depthMm)).toEqual([15]);
    expect(emission.machineWarnings).toEqual(
      expect.arrayContaining([
        'CNC reach review · End mill 6: Cut depth 16 mm exceeds the recorded 15 mm flute length.',
        'CNC reach review · End mill 2: Cut depth 8 mm exceeds the recorded 6 mm flute length.',
        "CNC reach review · End mill 2: no program geometry was reviewed for this bit's section; its fixture clearance was not evaluated.",
      ]),
    );
  }, 120_000);

  it('separate-tool export reviews each bit file with its own compiled depth', () => {
    const programs = buildCncToolPrograms(prepared, {});
    if (programs.kind !== 'ready') throw new Error(programs.message);
    expect(programs.programs.map((program) => program.toolId)).toEqual(['end6', 'end2']);
    expect(programs.programs[0]?.warnings).toContain(
      'CNC reach review · End mill 6: Cut depth 16 mm exceeds the recorded 15 mm flute length.',
    );
    expect(programs.programs[1]?.warnings).toContain(
      'CNC reach review · End mill 2: Cut depth 8 mm exceeds the recorded 6 mm flute length.',
    );
  }, 120_000);
});
