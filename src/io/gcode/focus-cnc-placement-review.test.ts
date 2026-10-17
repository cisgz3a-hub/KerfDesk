import { expect, it } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';
it('CNC may not discard Focus intent that becomes represented after placement', () => {
  const scene = generateFocusTest({
    steps: 2,
    minOffsetMm: -1,
    maxOffsetMm: 1,
    lineLengthMm: 20,
    spacingMm: 3,
    speed: 1200,
    power: 10,
    travelFeedMmPerMin: 300,
  });
  const project = {
    ...createProject(),
    scene: {
      ...scene,
      layers: scene.layers.map((layer, index) => {
        if (index === 0) return layer;
        const { focusTest: _focus, ...ordinary } = layer;
        return ordinary;
      }),
      objects: scene.objects.map((object, index) =>
        index !== 0 || object.kind !== 'imported-svg'
          ? object
          : {
              ...object,
              paths: object.paths.map((path) => ({
                ...path,
                polylines: [
                  {
                    closed: false,
                    points: [
                      { x: 0, y: 0 },
                      { x: 0.0001, y: 0 },
                    ],
                  },
                ],
              })),
            },
      ),
    },
  };
  const placement = { absoluteProgramOffset: { x: 0.00045, y: 0 } };
  expect(emitGcode(project).gcode).not.toContain('G1 Z');
  expect(emitGcode(project, placement).gcode).toContain('G1 Z-1.000');
  expect(
    prepareOutput({ ...project, machine: DEFAULT_CNC_MACHINE_CONFIG }, placement),
  ).toMatchObject({ ok: false, preflight: { issues: [{ code: 'focus-test-needs-laser' }] } });
});
