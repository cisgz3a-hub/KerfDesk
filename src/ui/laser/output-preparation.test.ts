import { describe, expect, it } from 'vitest';
import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import type { StatusReport } from '../../core/controllers/grbl';
import { computeJobBounds, computeJobMotionBounds } from '../../core/job';
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
import { canvasExecutablePlan } from '../state/canvas-preview-motion';
import { selectExecutablePlanCalculatedBounds } from './executable-plan-calculated-bounds';
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
const MISSING_OBJECT_ID = 'missing-object';

describe('output preparation worker payload', () => {
  it('preserves a failed Save preparation as a distinct worker result', () => {
    const response = prepareOutputRequest({
      kind: 'save',
      project: createProject(),
      options: {
        outputScope: {
          cutSelectedGraphics: true,
          useSelectionOrigin: false,
          selectedObjectIds: [MISSING_OBJECT_ID],
        },
      },
    });

    expect(response).toMatchObject({
      kind: 'save',
      result: {
        kind: 'preparation-failed',
        gcode: '',
        preflight: { issues: [{ code: 'selected-output-empty' }] },
      },
    });
    expect(() => structuredClone(response)).not.toThrow();
  });

  it('returns a cloneable non-writable Save result when rotary raster permission is absent', () => {
    const response = prepareOutputRequest({
      kind: 'save',
      project: rotaryRasterSaveProject(),
      options: {},
    });

    expect(response).toMatchObject({
      kind: 'save',
      result: {
        kind: 'emission-refused',
        gcode: '',
        preflight: { issues: [{ code: 'rotary-raster-unsupported' }] },
      },
    });
    expect(() => structuredClone(response)).not.toThrow();
  });

  it('returns emitted rotary raster bytes when worker permission is explicit', () => {
    const response = prepareOutputRequest({
      kind: 'save',
      project: rotaryRasterSaveProject(),
      options: { allowRotaryRaster: true },
    });

    expect(response).toMatchObject({
      kind: 'save',
      result: { kind: 'emitted', preflight: { issues: [] } },
    });
    if (response.kind !== 'save') throw new Error('Save did not prepare.');
    expect(response.result.gcode).not.toBe('');
    expect(() => structuredClone(response)).not.toThrow();
  });

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

  it('uses the same verified plan for calculated bounds without changing emitted bytes', () => {
    const response = prepareOutputRequest({
      kind: 'start',
      project: fullBedLineProject(),
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
    const { prepared, canvasPlan, gcode, metrics } = response.result;
    const plan = canvasExecutablePlan(canvasPlan);
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    const selected = selectExecutablePlanCalculatedBounds({
      legacyJobBounds: computeJobBounds(prepared.job, prepared.project.device),
      legacyMotionBounds: computeJobMotionBounds(prepared.job, prepared.project.device),
      executablePlan: plan,
      rotaryApplies: false,
    });

    expect(selected.source).toBe('executable-plan');
    expect(metrics.jobBounds).toEqual(selected.jobBounds);
    expect(metrics.motionBounds).toEqual(selected.motionBounds);
    expect(plan.compatibility.exactProgram).toBe(gcode);
    expect(emitPreparedGcode(prepared).gcode).toBe(gcode);
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

function fullBedLineProject(): Project {
  const base = createProject();
  const color = '#222222';
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'imported-svg',
        id: 'full-bed-line',
        source: 'full-bed-line.svg',
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: base.device.bedHeight },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color,
            polylines: [
              {
                closed: false,
                points: [
                  { x: 0, y: 0 },
                  { x: 0, y: base.device.bedHeight },
                ],
              },
            ],
          },
        ],
      }),
      createLayer({ id: color, color, mode: 'line' }),
    ),
  };
}
