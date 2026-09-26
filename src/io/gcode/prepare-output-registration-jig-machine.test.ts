import { describe, expect, it } from 'vitest';
import { createRegistrationBox } from '../../core/shapes';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  createRegistrationLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

const USER_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;

function artObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40 },
    paths: [
      {
        color: '#00ff00',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 5 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

function jigProject(jigLaserKerfMm: number, cnc: boolean): Project {
  const base = createProject();
  let scene = addObject(
    base.scene,
    createRegistrationBox({ widthMm: 80, heightMm: 40, x: 10, y: 20 }),
  );
  scene = addObject(scene, artObject());
  scene = addLayer(scene, {
    ...createRegistrationLayer(),
    kerfOffsetMm: jigLaserKerfMm,
    ...(cnc ? { cnc: DEFAULT_CNC_LAYER_SETTINGS } : {}),
  });
  scene = addLayer(scene, {
    ...createLayer({ id: '#00ff00', color: '#00ff00' }),
    ...(cnc ? { cnc: DEFAULT_CNC_LAYER_SETTINGS } : {}),
  });
  return { ...base, scene, ...(cnc ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}) };
}

function placement(project: Project): { readonly x: number; readonly y: number } {
  const prepared = prepareOutput(project, { jobOrigin: USER_ORIGIN });
  if (!prepared.ok) throw new Error('expected prepared output');
  return prepared.jobOriginOffset;
}

describe('registration jig placement follows the machine that cuts it', () => {
  it('ignores the jig layer laser kerf offset on a CNC job', () => {
    expect(placement(jigProject(2, true))).toEqual(placement(jigProject(0, true)));
  });

  it('still measures the burned jig, kerf included, on a laser job', () => {
    expect(placement(jigProject(2, false))).not.toEqual(placement(jigProject(0, false)));
  });
});
