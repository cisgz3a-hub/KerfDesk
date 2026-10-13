import { describe, expect, it } from 'vitest';
import { toMachineCoords, type Origin } from '../../core/devices';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type Vec2,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { buildGcodeRenderModel, SEG_MOTION } from '../../core/gcode-view';
import { prepareOutput } from './prepare-output';

function project(): Project {
  const base = createProject();
  const scene = addObject(base.scene, {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 20 },
              { x: 30, y: 20 },
              { x: 30, y: 40 },
              { x: 10, y: 40 },
              { x: 10, y: 20 },
            ],
          },
        ],
      },
    ],
  });
  return { ...base, scene: addLayer(scene, createLayer({ id: 'red', color: '#ff0000' })) };
}

function firstCut(prepared: ReturnType<typeof prepareOutput>): Vec2 | undefined {
  if (!prepared.ok) throw new Error('preparation failed');
  const group = prepared.job.groups[0];
  if (group?.kind !== 'cut') throw new Error('cut missing');
  return group.segments[0]?.polyline[0];
}

describe('prepared output explicit job start', () => {
  it('applies the absolute bed-to-program offset to the chosen start exactly once', () => {
    const base = project();
    const input: Project = { ...base, startPoints: { job: { x: 17, y: 20 } } };
    const offset = { x: -100, y: 35 };
    const prepared = prepareOutput(input, { absoluteProgramOffset: offset });
    const machine = toMachineCoords({ x: 17, y: 20 }, input.device);
    expect(firstCut(prepared)).toEqual({ x: machine.x + offset.x, y: machine.y + offset.y });
  });

  it.each<Origin>(['rear-left', 'rear-right', 'front-left', 'front-right', 'center'])(
    'maps the chosen scene point and job placement once for %s',
    (origin) => {
      const base = project();
      const input = {
        ...base,
        device: { ...base.device, origin },
        startPoints: { job: { x: 17, y: 20 } },
      };
      const prepared = prepareOutput(input, {
        jobOrigin: {
          startFrom: 'current-position',
          anchor: 'center',
          currentPosition: { x: 100, y: 80 },
        },
      });
      if (!prepared.ok) throw new Error('preparation failed');
      const expected = toMachineCoords({ x: 17, y: 20 }, input.device);
      expect(firstCut(prepared)).toEqual({
        x: expected.x + prepared.jobOriginOffset.x,
        y: expected.y + prepared.jobOriginOffset.y,
      });
    },
  );

  it('resolves a new-job relative preference in scene orientation', () => {
    const base = project();
    const input: Project = { ...base, startPoints: { job: { x: 0.75, y: 0, relative: true } } };
    expect(firstCut(prepareOutput(input))).toEqual(toMachineCoords({ x: 25, y: 20 }, input.device));
  });

  it('emits its first actual powered cut from the same selected point as the preview job', () => {
    const base = project();
    const input: Project = { ...base, startPoints: { job: { x: 17, y: 20 } } };
    const prepared = prepareOutput(input);
    const parsed = buildGcodeRenderModel(emitGcode(input).gcode);
    if (parsed.kind !== 'ok') throw new Error('emitted program did not parse');
    const index = parsed.model.segPower.findIndex(
      (power, index) => power > 0 && parsed.model.segMotion[index] !== SEG_MOTION.rapid,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect({
      x: parsed.model.positions[index * 6],
      y: parsed.model.positions[index * 6 + 1],
    }).toEqual(firstCut(prepared));
  });

  it('keeps absent preferences identical to automatic preparation', () => {
    const base = project();
    expect(prepareOutput({ ...base, startPoints: { frame: { edge: 2, fraction: 0.5 } } }).ok).toBe(
      true,
    );
    expect(
      firstCut(prepareOutput({ ...base, startPoints: { frame: { edge: 2, fraction: 0.5 } } })),
    ).toEqual(firstCut(prepareOutput(base)));
  });
});
