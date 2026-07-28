import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Layer,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { applyFreshTraceScanDirection } from './fresh-trace-scan-direction';
import { applyFreshImport } from './scene-mutations';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const BASE_OPERATION: Layer = createLayer({
  id: 'trace-operation',
  color: '#000000',
  mode: 'fill',
});

function tracedImage(
  operationOverride?: TracedImage['operationOverride'],
  traceMode: TracedImage['traceMode'] = 'filled-contours',
): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'trace.png',
    traceMode,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 4 },
              { x: 0, y: 4 },
            ],
          },
        ],
      },
    ],
    ...(operationOverride === undefined ? {} : { operationOverride }),
  };
}

function resolvedOperation(
  object: TracedImage,
  device = DEFAULT_DEVICE_PROFILE,
): Layer | undefined {
  return applyFreshTraceScanDirection(object, [BASE_OPERATION], device)[0];
}

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

beforeEach(resetStore);
afterEach(resetStore);

describe('applyFreshTraceScanDirection', () => {
  it('defaults a generic filled-contour Scan Line trace to one-way', () => {
    expect(resolvedOperation(tracedImage())?.fillBidirectional).toBe(false);
  });

  it('persists and compiles the generic traced Scan Line default as one-way', () => {
    const imported = applyFreshImport(
      { project: createProject(), undoStack: [] },
      tracedImage(),
      0,
    );
    const trace = imported.project.scene.objects.find((object) => object.id === 'trace');
    const operationId =
      trace === undefined
        ? undefined
        : operationIdsForObject(trace, imported.project.scene.layers)[0];
    const operation = imported.project.scene.layers.find(
      (candidate) => candidate.id === operationId,
    );
    const fill = compileJob(imported.project.scene, imported.project.device).groups.find(
      (group) => group.kind === 'fill',
    );

    expect(operation?.fillBidirectional).toBe(false);
    expect(fill?.scanDirection).toEqual({
      bidirectional: false,
      reason: 'requested-one-way',
    });
    expect(fill?.segments.every((segment) => !segment.reverse)).toBe(true);
  });

  it('persists and compiles one-way through the Trace Existing Image store action', () => {
    useStore.getState().importRasterImage(sourceRaster());
    useStore.getState().traceExistingImage('source', tracedImage());
    const project = useStore.getState().project;
    const trace = project.scene.objects.find((object) => object.id === 'trace');
    const operationId =
      trace === undefined ? undefined : operationIdsForObject(trace, project.scene.layers)[0];
    const operation = project.scene.layers.find((candidate) => candidate.id === operationId);
    const fill = compileJob(project.scene, project.device).groups.find(
      (group) => group.kind === 'fill',
    );

    expect(operation?.fillBidirectional).toBe(false);
    expect(fill?.scanDirection).toEqual({
      bidirectional: false,
      reason: 'requested-one-way',
    });
    expect(fill?.segments.every((segment) => !segment.reverse)).toBe(true);
  });

  it('preserves explicit direction and non-Scan-Line trace intent', () => {
    expect(
      resolvedOperation(tracedImage({ mode: 'fill', fillBidirectional: true }))?.fillBidirectional,
    ).toBe(true);
    expect(
      resolvedOperation(tracedImage({ mode: 'fill', fillStyle: 'island' }))?.fillBidirectional,
    ).toBe(true);
    expect(resolvedOperation(tracedImage(undefined, 'centerline'))?.fillBidirectional).toBe(true);
  });

  it('leaves the qualified 4040 direction policy in control', () => {
    expect(
      resolvedOperation(tracedImage(), NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)?.fillBidirectional,
    ).toBe(true);
  });

  it('keeps verified and legacy-verified generic scan calibration bidirectional', () => {
    const scanningOffsets = [{ speedMmPerMin: 1500, offsetMm: 0.08 }];
    expect(
      resolvedOperation(tracedImage(), {
        ...DEFAULT_DEVICE_PROFILE,
        scanningOffsets,
        scanOffsetCalibrationStatus: 'verified',
      })?.fillBidirectional,
    ).toBe(true);
    expect(
      resolvedOperation(tracedImage(), {
        ...DEFAULT_DEVICE_PROFILE,
        scanningOffsets,
      })?.fillBidirectional,
    ).toBe(true);
  });
});
