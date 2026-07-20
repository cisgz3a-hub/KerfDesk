import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { computeJobBounds, type JobOriginPlacement } from '../../core/job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type OutputScope,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

const COLOR = '#ff0000';
const SPEED_MM_PER_MIN = 1500;

describe('scan-offset-aware job placement', () => {
  it.each([
    {
      label: 'user origin',
      placement: { startFrom: 'user-origin', anchor: 'front-left' } as const,
      targetX: 0,
    },
    {
      label: 'verified origin',
      placement: { startFrom: 'verified-origin', anchor: 'front-left' } as const,
      targetX: 0,
    },
    {
      label: 'current position',
      placement: {
        startFrom: 'current-position',
        anchor: 'front-left',
        currentPosition: { x: 50, y: 25 },
      } as const,
      targetX: 50,
    },
  ])('anchors the calibrated reverse-row minimum at $label', ({ placement, targetX }) => {
    const project = fillProject(0.5, [fillSquare('selected', 10)]);
    const prepared = prepareOutput(project, { jobOrigin: placement });
    if (!prepared.ok) throw new Error('expected prepared output');

    expect(computeJobBounds(prepared.job, project.device)?.minX).toBeCloseTo(targetX, 6);

    const emitted = emitGcode(project, { jobOrigin: placement });
    expect(emitted.preflight.ok).toBe(true);
    expect(emitted.gcode).not.toMatch(/\b[XY]-/);
  });

  it('anchors the calibrated reverse-row maximum for a negative offset', () => {
    const project = fillProject(-0.5, [fillSquare('selected', 10)]);
    const placement: JobOriginPlacement = { startFrom: 'user-origin', anchor: 'front-right' };
    const prepared = prepareOutput(project, { jobOrigin: placement });
    if (!prepared.ok) throw new Error('expected prepared output');

    expect(computeJobBounds(prepared.job, project.device)?.maxX).toBeCloseTo(0, 6);
  });

  it.each([
    { useSelectionOrigin: true, expectedMinX: 0 },
    { useSelectionOrigin: false, expectedMinX: 90 },
  ])(
    'uses calibrated full/selected bounds when useSelectionOrigin=$useSelectionOrigin',
    ({ useSelectionOrigin, expectedMinX }) => {
      const project = fillProject(0.5, [fillSquare('selected', 100), fillSquare('unselected', 10)]);
      const outputScope: OutputScope = {
        cutSelectedGraphics: true,
        useSelectionOrigin,
        selectedObjectIds: ['selected'],
      };
      const prepared = prepareOutput(project, {
        jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
        outputScope,
      });
      if (!prepared.ok) throw new Error('expected prepared output');

      expect(computeJobBounds(prepared.job, project.device)?.minX).toBeCloseTo(expectedMinX, 6);
    },
  );
});

function fillProject(offsetMm: number, objects: ReadonlyArray<SceneObject>): Project {
  const device = {
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    scanningOffsets: [{ speedMmPerMin: SPEED_MM_PER_MIN, offsetMm }],
  };
  const layer = {
    ...createLayer({ id: 'fill', color: COLOR, mode: 'fill' }),
    speed: SPEED_MM_PER_MIN,
    hatchAngleDeg: 0,
    hatchSpacingMm: 2,
    fillBidirectional: true,
    fillOverscanMm: 0,
  };
  return {
    ...createProject(device),
    scene: {
      ...EMPTY_SCENE,
      objects,
      layers: [layer],
      artworkOrder: objects.map((object) => object.id),
    },
  };
}

function fillSquare(id: string, x: number): SceneObject {
  const minY = 10;
  const maxX = x + 10;
  const maxY = minY + 10;
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY, maxX, maxY },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x, y: minY },
              { x: maxX, y: minY },
              { x: maxX, y: maxY },
              { x, y: maxY },
            ],
          },
        ],
      },
    ],
  };
}
