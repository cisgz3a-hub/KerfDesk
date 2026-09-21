import { describe, expect, it } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { computeJobMotionBounds, type JobBounds, type JobOriginPlacement } from '../../core/job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitGcode, emitPreparedGcode, type EmitGcodeOptions } from './emit-gcode';
import { prepareOutput } from './prepare-output';
import {
  hydratePreparedExecutionOutput,
  prepareOutputForStructuredClone,
} from './prepared-output-persistence';

function edgeProject(): Project {
  const base = createProject({
    ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    origin: 'center',
    bedWidth: 400,
    bedHeight: 400,
  });
  return {
    ...base,
    optimization: { ...base.optimization, travelPolicy: 'source-order', pathDirection: 'preserve' },
    scene: {
      layers: [createLayer({ id: 'edge', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'edge',
          source: 'edge.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 388, minY: 170, maxX: 398, maxY: 170 },
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 398, y: 170 },
                    { x: 388, y: 170 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

const CASES: ReadonlyArray<{
  mode: string;
  jobOrigin: JobOriginPlacement;
  bounds: JobBounds;
  offset: { x: number; y: number };
  entryWord: string;
  maxX: number;
}> = [
  {
    mode: 'absolute',
    jobOrigin: { startFrom: 'absolute', anchor: 'front-right' },
    bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
    offset: { x: 0, y: 0 },
    entryWord: 'X200.000 Y30.000',
    maxX: 200,
  },
  {
    mode: 'user-origin',
    jobOrigin: { startFrom: 'user-origin', anchor: 'front-right' },
    bounds: { minX: -398, minY: -230, maxX: 2, maxY: 170 },
    offset: { x: 198, y: 30 },
    entryWord: 'X2.000 Y0.000',
    maxX: 2,
  },
  {
    mode: 'current-position',
    jobOrigin: {
      startFrom: 'current-position',
      anchor: 'front-right',
      currentPosition: { x: 12, y: 23 },
    },
    bounds: { minX: -386, minY: -207, maxX: 14, maxY: 193 },
    offset: { x: 186, y: 7 },
    entryWord: 'X14.000 Y23.000',
    maxX: 14,
  },
];

describe('prepared coordinate envelope across output boundaries', () => {
  it.each(CASES)('$mode keeps direct, worker Save and archived output identical', async (item) => {
    const project = edgeProject();
    const options: EmitGcodeOptions = {
      jobOrigin: item.jobOrigin,
      contourEntryBounds: item.bounds,
      preflightMotionOffset: item.offset,
    };
    const emitted = emitGcode(project, options);
    expect(emitted.gcode).toContain(item.entryWord);
    expect(emitted.preflight.issues.filter((issue) => issue.code === 'out-of-bed')).toEqual([]);
    const worker = await prepareOutputRequestForTest({ kind: 'save', project, options });
    if (worker.kind !== 'save' || worker.result.kind !== 'emitted') throw new Error('Save fixture');
    expect(worker.result.gcode).toBe(emitted.gcode);

    const prepared = prepareOutput(project, options);
    if (!prepared.ok) throw new Error('Prepare fixture');
    const restored = hydratePreparedExecutionOutput(
      structuredClone(prepareOutputForStructuredClone(prepared)),
    );
    if (restored === null) throw new Error('Archive fixture');
    expect(computeJobMotionBounds(restored.job, project.device)?.maxX).toBe(item.maxX);
    // A later caller cannot re-clamp a sealed prepared job against another envelope.
    expect(emitPreparedGcode(restored, { ...options, contourEntryBounds: null }).gcode).toBe(
      emitted.gcode,
    );
  });

  it('unknown physical bounds omit optional entry while keeping the burn and output available', async () => {
    const project = edgeProject();
    const options: EmitGcodeOptions = {
      jobOrigin: { startFrom: 'verified-origin', anchor: 'front-right' },
      contourEntryBounds: null,
      preflightCoordinateMode: 'relative-origin',
    };
    const emitted = emitGcode(project, options);
    expect(emitted.gcode).toContain('X-10.000 Y0.000');
    expect(emitted.gcode).not.toContain('X5.000 Y0.000');
    const worker = await prepareOutputRequestForTest({ kind: 'save', project, options });
    if (worker.kind !== 'save' || worker.result.kind !== 'emitted') throw new Error('Save fixture');
    expect(worker.result.gcode).toBe(emitted.gcode);
  });
});
