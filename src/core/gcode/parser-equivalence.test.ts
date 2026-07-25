// ADR-255 stage 1: the two modal parsers now compose one shared engine; this
// suite pins their motion agreement on identical programs so they can never
// drift apart again. (Test files may import across modules — the CLAUDE.md
// boundary exemption for test scaffolding.)
import { describe, expect, it } from 'vitest';
import { parseGcodeProgram } from '../../io/gcode';
import { buildMotionManifest } from '../job/motion-manifest';

const PROGRAMS: ReadonlyArray<{ readonly name: string; readonly gcode: string }> = [
  {
    name: 'square with feed moves',
    gcode: [
      'G21 G90',
      'M3 S500',
      'G0 X0 Y0',
      'G1 X10 Y0 F600',
      'G1 X10 Y10',
      'G1 X0 Y10',
      'G1 X0 Y0',
      'M5',
      'M2',
    ].join('\n'),
  },
  {
    name: 'ij quarter arc',
    gcode: ['G21 G90', 'M3 S255', 'G0 X0 Y10', 'G2 X10 Y0 I0 J-10 F300', 'M5'].join('\n'),
  },
  {
    name: 'r-form arc',
    gcode: ['G21 G90', 'M4 S100', 'G0 X0 Y0', 'G3 X10 Y10 R10 F200'].join('\n'),
  },
  {
    name: 'inch relative moves with a pure-Z plunge',
    gcode: ['G20 G91', 'M3 S10', 'G1 X1 Y0 F30', 'G1 X0 Y1', 'G1 Z-0.1'].join('\n'),
  },
  {
    name: 'full circle (coincident endpoints)',
    gcode: ['G21 G90', 'M3 S500', 'G0 X20 Y10', 'G2 X20 Y10 I-5 J0 F400'].join('\n'),
  },
  {
    name: 'helical full turn with Z descent',
    gcode: ['G21 G90', 'M3 S1000', 'G0 X10 Y0', 'G2 X10 Y0 I-10 J0 Z-2 F250'].join('\n'),
  },
];

type Endpoint = { readonly x: number; readonly y: number; readonly z: number };

function parserEndpoints(gcode: string): Endpoint[] {
  const result = parseGcodeProgram(gcode);
  if (result.kind !== 'ok') throw new Error(`parse failed: ${result.reason}`);
  const out: Endpoint[] = [];
  let z = 0;
  for (const step of result.toolpath.steps) {
    if (step.kind === 'travel') {
      z = step.z?.to ?? z;
      out.push({ x: step.to.x, y: step.to.y, z });
    } else if (step.kind === 'plunge') {
      z = step.toZ;
      out.push({ x: step.at.x, y: step.at.y, z });
    } else {
      const last = step.polyline[step.polyline.length - 1];
      z = step.z?.to ?? z;
      if (last !== undefined) out.push({ x: last.x, y: last.y, z });
    }
  }
  return out;
}

function manifestEndpoints(gcode: string): Endpoint[] {
  const manifest = buildMotionManifest(gcode, { machineKind: 'cnc' });
  return manifest.blocks.map((block) => {
    const last = block.points[block.points.length - 1];
    if (last === undefined) throw new Error('manifest produced an empty block');
    return { x: last.x, y: last.y, z: last.z };
  });
}

describe('parser equivalence (shared modal engine)', () => {
  for (const program of PROGRAMS) {
    it(`agrees on motion endpoints: ${program.name}`, () => {
      const fromParser = parserEndpoints(program.gcode);
      const fromManifest = manifestEndpoints(program.gcode);
      expect(fromManifest.length).toBe(fromParser.length);
      for (let index = 0; index < fromParser.length; index += 1) {
        expect(fromManifest[index]?.x).toBeCloseTo(fromParser[index]?.x ?? Number.NaN, 9);
        expect(fromManifest[index]?.y).toBeCloseTo(fromParser[index]?.y ?? Number.NaN, 9);
        expect(fromManifest[index]?.z).toBeCloseTo(fromParser[index]?.z ?? Number.NaN, 9);
      }
    });
  }
});
