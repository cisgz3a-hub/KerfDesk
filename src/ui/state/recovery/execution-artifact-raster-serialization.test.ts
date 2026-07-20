import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { RasterGroup } from '../../../core/job';
import {
  DEFAULT_OUTPUT_SCOPE,
  DEFAULT_RASTER_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  createProject,
  type RasterImage,
} from '../../../core/scene';
import { emitPreparedGcode, type PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import { createExecutionArtifact, MAX_EXECUTION_ARTIFACT_RASTER_BYTES } from './execution-artifact';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from './execution-artifact-size';

describe('streamed raster execution artifact persistence', () => {
  it('materializes only the stored copy and preserves exact emitted G-code through structured clone', () => {
    const rows = [new Uint16Array([100, 0]), new Uint16Array([0, 100])] as const;
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'streamed-image',
      color: '#000000',
      power: 50,
      speed: 1_000,
      passes: 1,
      airAssist: false,
      sValues: new Uint16Array(0),
      rowProvider: (y) => rows[y] ?? new Uint16Array(0),
      pixelWidth: 2,
      pixelHeight: 2,
      bounds: { minX: 10, minY: 10, maxX: 12, maxY: 12 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };
    const prepared = {
      ok: true,
      project: createProject(DEFAULT_DEVICE_PROFILE),
      job: { groups: [raster] },
      jobOriginOffset: { x: 0, y: 0 },
    } satisfies Extract<PreparedOutput, { readonly ok: true }>;
    const emitted = emitPreparedGcode(prepared, {
      outputScope: DEFAULT_OUTPUT_SCOPE,
      allowRotaryRaster: true,
    }).gcode;
    expect(emitted).not.toBe('');

    const artifact = createExecutionArtifact({
      artifactSchemaVersion: 1,
      runId: 'run-streamed-raster',
      gcode: emitted,
      prepared,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      canvasPlan: { retentionKey: 'streamed-raster-signature' } as CanvasMotionPlan,
      controllerSettings: null,
      createdAtIso: '2026-07-19T03:00:00.000Z',
    });

    const runtimeRaster = prepared.job.groups[0];
    const storedRaster = artifact.prepared.job.groups[0];
    expect(runtimeRaster?.kind === 'raster' ? runtimeRaster.rowProvider : undefined).toBeTypeOf(
      'function',
    );
    expect(storedRaster?.kind).toBe('raster');
    if (storedRaster?.kind !== 'raster') throw new Error('Expected stored raster.');
    expect(storedRaster.rowProvider).toBeUndefined();
    expect(storedRaster.sValues).toEqual(new Uint16Array([100, 0, 0, 100]));

    const cloned = structuredClone(artifact);
    const clonedRaster = cloned.prepared.job.groups[0];
    const clonedSValues = clonedRaster?.kind === 'raster' ? clonedRaster.sValues : undefined;
    // jsdom's structuredClone returns a typed array from a different realm, so
    // instanceof is not portable even though the binary view type is retained.
    expect(ArrayBuffer.isView(clonedSValues)).toBe(true);
    expect(clonedSValues?.constructor.name).toBe('Uint16Array');
    expect(
      emitPreparedGcode(cloned.prepared, {
        outputScope: cloned.outputScope,
        allowRotaryRaster: true,
      }).gcode,
    ).toBe(emitted);
  });

  it('refuses oversized archive materialization before asking the row provider for data', () => {
    const pixelWidth = MAX_EXECUTION_ARTIFACT_RASTER_BYTES / Uint16Array.BYTES_PER_ELEMENT + 1;
    const rowProvider = vi.fn(() => new Uint16Array(pixelWidth));
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'oversized-streamed-image',
      color: '#000000',
      power: 50,
      speed: 1_000,
      passes: 1,
      airAssist: false,
      sValues: new Uint16Array(0),
      rowProvider,
      pixelWidth,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: pixelWidth, maxY: 1 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };
    const prepared = {
      ok: true,
      project: createProject(DEFAULT_DEVICE_PROFILE),
      job: { groups: [raster] },
      jobOriginOffset: { x: 0, y: 0 },
    } satisfies Extract<PreparedOutput, { readonly ok: true }>;

    expect(() =>
      createExecutionArtifact({
        artifactSchemaVersion: 1,
        runId: 'run-oversized-streamed-raster',
        gcode: 'G21\nM5\n',
        prepared,
        outputScope: DEFAULT_OUTPUT_SCOPE,
        canvasPlan: { retentionKey: 'oversized-streamed-raster' } as CanvasMotionPlan,
        controllerSettings: null,
        createdAtIso: '2026-07-19T03:00:00.000Z',
      }),
    ).toThrow('too large to archive safely');
    expect(rowProvider).not.toHaveBeenCalled();
  });

  it('bounds the complete embedded project before estimating or cloning the artifact', () => {
    const base = createProject(DEFAULT_DEVICE_PROFILE);
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'large-source-image',
      source: 'large-source.png',
      dataUrl: `data:image/png;base64,${'A'.repeat(
        Math.floor(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES / 3) + 1,
      )}`,
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      color: DEFAULT_RASTER_LAYER_COLOR,
      dither: 'threshold',
      linesPerMm: 10,
      lumaBase64: 'AA==',
    };
    const prepared = {
      ok: true,
      project: { ...base, scene: { ...base.scene, objects: [image] } },
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } satisfies Extract<PreparedOutput, { readonly ok: true }>;

    expect(() =>
      createExecutionArtifact({
        artifactSchemaVersion: 1,
        runId: 'run-oversized-source-project',
        gcode: 'G21\nM5\n',
        prepared,
        outputScope: DEFAULT_OUTPUT_SCOPE,
        canvasPlan: { retentionKey: 'oversized-source-project' } as CanvasMotionPlan,
        controllerSettings: null,
        createdAtIso: '2026-07-19T03:00:00.000Z',
      }),
    ).toThrow('safe archive size');
  });
});
