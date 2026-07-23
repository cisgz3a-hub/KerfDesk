import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import {
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode';
import { hydratePreparedExecutionOutput } from '../../io/gcode/prepared-output-persistence';
import { prepareOutputRequest } from './output-preparation';

const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  wco: null,
};

describe('output preparation worker payload', () => {
  it('returns an exact cloneable large Start result without a function-valued raster', () => {
    const project = streamedProject();
    const response = prepareOutputRequest({
      kind: 'start',
      project,
      controllerSettings: null,
      machine: {
        statusReport: IDLE,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      allowRotaryRaster: false,
      requireFrame: false,
    });

    expect(response.kind).toBe('start');
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const raster = response.result.prepared.job.groups.find((group) => group.kind === 'raster');
    expect(raster?.kind === 'raster' ? raster.rowProvider : undefined).toBeUndefined();
    expect(raster?.kind === 'raster' ? raster.archivedRowProviderRecipe : undefined).toBe(
      'prepared-project',
    );
    expect(response.result.metrics.jobBounds).not.toBeNull();
    expect(() => structuredClone(response)).not.toThrow();

    const hydrated = hydratePreparedExecutionOutput(response.result.prepared);
    expect(hydrated).not.toBeNull();
    expect(
      emitPreparedGcode(hydrated ?? response.result.prepared, {
        outputScope: DEFAULT_OUTPUT_SCOPE,
      }).gcode,
    ).toBe(response.result.gcode);
  });
});

function streamedProject(): Project {
  const base = createProject();
  const color = '#111111';
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'raster-image',
        id: 'large-image',
        color,
        source: 'large.png',
        dataUrl: 'data:image/png;base64,source',
        lumaBase64: 'AA==',
        pixelWidth: 1,
        pixelHeight: 1,
        dither: 'threshold',
        linesPerMm: 10,
        bounds: { minX: 0, minY: 0, maxX: 201, maxY: 201 },
        transform: IDENTITY_TRANSFORM,
      }),
      {
        ...createLayer({ id: 'image', color, mode: 'image' }),
        linesPerMm: 10,
        ditherAlgorithm: 'threshold',
        fillOverscanMm: 0,
      },
    ),
  };
}
