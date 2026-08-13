import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { svgObj } from '../state/test-helpers';
import { detectLaserReliefWarnings } from './laser-relief-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';
import { legacyMeshIntrinsicBounds } from '../../core/relief/legacy-mesh-intrinsic-bounds';

const OPERATION_ID = 'relief-operation';
const RELIEF_COLOR = '#a0522d';

describe('detectLaserReliefWarnings', () => {
  it('counts mesh and depth-map reliefs on output-enabled operations', () => {
    const warnings = detectLaserReliefWarnings(laserProject([meshRelief(), depthMapRelief()]));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2 relief objects');
    expect(warnings[0]).toContain('will omit');
    expect(warnings[0]).toContain('remain stored');
    expect(warnings[0]).toContain('CNC mode');
  });

  it('counts one relief once when it binds to two output operations', () => {
    const secondOperationId = 'second-relief-operation';
    const relief = { ...meshRelief(), operationIds: [OPERATION_ID, secondOperationId] };
    const base = laserProject([relief]);
    const project = {
      ...base,
      scene: {
        ...base.scene,
        layers: [
          ...base.scene.layers,
          createLayer({ id: secondOperationId, color: '#654321', name: 'Second relief' }),
        ],
      },
    };

    expect(detectLaserReliefWarnings(project)[0]).toContain('1 relief object');
  });

  it('is silent for disabled output and CNC projects', () => {
    expect(detectLaserReliefWarnings(laserProject([meshRelief()], false))).toEqual([]);
    expect(
      detectLaserReliefWarnings({
        ...laserProject([meshRelief()]),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      }),
    ).toEqual([]);
  });

  it('reaches Job Review for an emittable mixed laser job without changing its compiled job', () => {
    const vector = svgObj('vector', [RELIEF_COLOR]);
    const mixed = prepareOutput(laserProject([vector, depthMapRelief()]));
    const vectorOnly = prepareOutput(laserProject([vector]));
    expect(mixed.ok).toBe(true);
    expect(vectorOnly.ok).toBe(true);
    if (!mixed.ok || !vectorOnly.ok) throw new Error('expected emittable laser output');

    expect(mixed.job).toEqual(vectorOnly.job);
    expect(detectMachineJobWarnings(mixed.project, null, null, mixed).join(' ')).toContain(
      '1 relief object',
    );
  });

  it('uses the prepared output scope and stays silent when the relief is unselected', () => {
    const prepared = prepareOutput(laserProject([svgObj('vector', [RELIEF_COLOR]), meshRelief()]), {
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['vector'],
      },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('expected selected vector output');

    expect(prepared.project.scene.objects.map((object) => object.id)).toEqual(['vector']);
    expect(
      detectMachineJobWarnings(prepared.project, null, null, prepared).join(' '),
    ).not.toContain('relief object');
  });
});

function laserProject(objects: ReadonlyArray<SceneObject>, output = true): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [...objects],
      layers: [
        {
          ...createLayer({ id: OPERATION_ID, color: RELIEF_COLOR, name: 'Relief' }),
          output,
        },
      ],
    },
  };
}

function reliefCommon(id: string): Omit<ReliefObject, 'reliefSource'> {
  return {
    kind: 'relief',
    id,
    source: 'relief-source',
    targetWidthMm: 10,
    reliefDepthMm: 2,
    color: RELIEF_COLOR,
    operationIds: [OPERATION_ID],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
  };
}

function meshRelief(): ReliefObject {
  return {
    ...reliefCommon('mesh-relief'),
    source: 'model.stl',
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 2],
      emptyCells: 'floor',
      intrinsicBounds: legacyMeshIntrinsicBounds([0, 0, 0, 10, 0, 0, 0, 10, 2]),
    },
  };
}

function depthMapRelief(): ReliefObject {
  return {
    ...reliefCommon('depth-map-relief'),
    source: 'depth.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 2,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      maxDepthMm: 2,
      samplesU8: [0, 255, 128, 255],
      provenance: { sourceName: 'depth.png' },
    }),
  };
}
