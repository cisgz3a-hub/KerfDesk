// Rolling audit v14 Z3-P1-2 end to end (ADR-705 Amendment 1): a Moshiboard
// project with a Y-port chuck goes through the real prepareOutput and
// emitPreparedMoshiJob, and every decoded stroke moves the part's surface at
// the layer speed. Before the fix, strokes round an Ø80 glass in the Creality
// chuck burned at 15.9 % of the set dose.
import { describe, expect, it } from 'vitest';
import { decodeMoshiProgram } from '../../core/controllers/moshi';
import { MM_PER_MIL } from '../../core/controllers/moshi/moshi-units';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type RotarySetup } from '../../core/devices';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../gcode';
import { emitPreparedMoshiJob } from './emit-moshi';

const DIAMETER = 80;
const CREALITY_CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: DIAMETER,
};
const K = 40 / (Math.PI * DIAMETER);

function project(rotary: RotarySetup | undefined): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 100, minY: 150, maxX: 140, maxY: 170 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 100, y: 150 },
              { x: 140, y: 150 },
              { x: 140, y: 170 },
              { x: 100, y: 170 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const device: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'moshi',
    ...(rotary === undefined ? {} : { rotary }),
  };
  const base = createProject(device);
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: 'L1', color: '#ff0000' })),
  };
}

/** Dose of each decoded cut: layer speed / surface speed, with machine Y = k x surface. */
function doses(p: Project, k: number): number[] {
  const prepared = prepareOutput(p, {});
  if (!prepared.ok) throw new Error('prepare failed');
  const group = prepared.job.groups[0];
  if (group === undefined || group.kind !== 'cut') throw new Error('expected one Line group');
  const layerMmS = group.speed / 60;
  const result = emitPreparedMoshiJob(prepared);
  if (!result.ok) throw new Error(result.messages.join(' '));
  const out: number[] = [];
  for (const program of result.programs) {
    const decoded = decodeMoshiProgram(program.bytes);
    if (!decoded.ok) throw new Error(decoded.error);
    let at = decoded.program.steps[0];
    for (const step of decoded.program.steps.slice(1)) {
      if (step.cut && at !== undefined) {
        const dx = (step.x - at.x) * MM_PER_MIL;
        const dy = (step.y - at.y) * MM_PER_MIL;
        const surface = Math.hypot(dx, dy / k) / Math.hypot(dx, dy);
        out.push(layerMmS / (decoded.program.speed * surface));
      }
      at = step;
    }
  }
  return out;
}

describe('Moshiboard with a Y-port rotary', () => {
  it('burns strokes along and round the glass at the set dose', () => {
    const measured = doses(project(CREALITY_CHUCK), K);
    expect(measured).toHaveLength(4);
    for (const dose of measured) expect(Math.abs(dose - 1)).toBeLessThan(0.13);
  });

  it('leaves the flat-bed job at the layer speed', () => {
    for (const dose of doses(project(undefined), 1)) expect(dose).toBeCloseTo(1, 2);
  });
});
