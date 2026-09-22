import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import type { VectorRaster } from '../../core/raster';
import {
  createLayer,
  createLayerSubLayer,
  captureLayerOperationSettings,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type LayerMode,
} from '../../core/scene';
import { assembleBitmap } from './bitmap-assembly';

function operation(id: string, mode: LayerMode, output = true, enabled = true): Layer {
  const parent = createLayer({ id, color: '#000000', mode });
  const fill = createLayer({ id: 'settings', color: '#000000', mode: 'fill' });
  return {
    ...parent,
    output,
    subLayers: [
      createLayerSubLayer(parent, {
        id: 'fill',
        label: 'Fill',
        settings: captureLayerOperationSettings(fill),
        enabled,
      }),
    ],
  };
}

function square(id: string, operationId: string, x = 0): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds: [operationId],
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
              { x: x + 10, y: 10 },
              { x, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}

function convert(
  objects: ReadonlyArray<ImportedSvg>,
  layers: ReadonlyArray<Layer>,
  brightnessPercent = 50,
): VectorRaster {
  let captured: VectorRaster | undefined;
  assembleBitmap(
    objects,
    (raster) => {
      captured = raster;
      return { dataUrl: 'data:,', lumaBase64: '' };
    },
    'bitmap',
    { dpi: 254, renderType: 'use-cut-settings', layers, brightnessPercent },
  );
  if (captured === undefined) throw new Error('Expected raster');
  return captured;
}

const pixel = (raster: VectorRaster, x: number, y: number): number | undefined =>
  raster.luma[Math.floor(y * 10) * raster.width + Math.floor(x * 10)];

describe('Use Cut Settings effective operation pixels', () => {
  it.each([
    ['line', true, true, true],
    ['line', true, false, false],
    ['line', false, true, false],
    ['fill', true, true, true],
    ['fill', true, false, true],
    ['fill', false, true, false],
    ['image', true, true, true],
  ] as const)('parent %s output=%s, Fill sub-layer enabled=%s', (mode, output, enabled, filled) => {
    const layer = operation('op', mode, output, enabled);
    const source = square('square', 'op');
    const job = compileJob({ objects: [source], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
    const raster = convert([source], [layer]);
    expect(job.groups.some((group) => group.kind === 'fill')).toBe(filled);
    expect(pixel(raster, 5, 5)).toBe(filled ? 127 : 255);
    if (!output) expect(raster.luma.every((luma) => luma === 255)).toBe(true);
    if (output && mode === 'line') expect(pixel(raster, 0, 5)).toBe(127);
  });

  it('preserves per-operation evenodd holes when both objects share a Fill sub-layer', () => {
    const raster = convert([square('a', 'op'), square('b', 'op', 5)], [operation('op', 'line')]);
    expect(pixel(raster, 2, 5)).toBe(127);
    expect(pixel(raster, 7, 5)).toBe(255);
    expect(pixel(raster, 12, 5)).toBe(127);
  });

  it('paints independent sub-layer fills together at the requested brightness without darkening their overlap', () => {
    const raster = convert(
      [square('a', 'first'), square('b', 'second', 5)],
      [operation('first', 'line'), operation('second', 'fill')],
      70,
    );
    expect(pixel(raster, 2, 5)).toBe(178);
    expect(pixel(raster, 7, 5)).toBe(178);
    expect(pixel(raster, 12, 5)).toBe(178);
    expect(raster.luma.every((luma) => luma === 178)).toBe(true);
  });

  it('keeps every legacy colour-matched operation, including enabled sub-layers', () => {
    const { operationIds: _ids, ...source } = square('legacy', 'unused');
    const raster = convert(
      [source],
      [operation('first', 'line'), operation('last', 'line', false)],
    );
    expect(pixel(raster, 5, 5)).toBe(127);
  });

  it('applies artwork-specific parent and sub-layer modes through the compiler resolver', () => {
    const layer = operation('op', 'line');
    const source = {
      ...square('overridden', 'op'),
      operationOverride: {
        byOperation: { op: { mode: 'fill' as const }, 'op:fill': { mode: 'line' as const } },
      },
    };
    const job = compileJob({ objects: [source], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
    expect(job.groups.map((group) => group.kind)).toEqual(['fill', 'cut']);
    expect(pixel(convert([source], [layer]), 5, 5)).toBe(127);
    const allLines = { ...source, operationOverride: { mode: 'line' as const } };
    expect(pixel(convert([allLines], [layer]), 5, 5)).toBe(255);
  });

  it('honours explicit path binding and preserves the hole of a nonzero compound path', () => {
    const outer = square('ring', 'disabled');
    const inner = square('inner', 'unused').paths[0]!;
    const source = {
      ...outer,
      paths: [
        {
          ...outer.paths[0]!,
          operationIds: ['enabled'],
          fillRule: 'nonzero' as const,
          polylines: [
            ...outer.paths[0]!.polylines,
            ...inner.polylines.map((polyline) => ({
              ...polyline,
              points: [...polyline.points]
                .reverse()
                .map((point) => ({ x: point.x * 0.5 + 2.5, y: point.y * 0.5 + 2.5 })),
            })),
          ],
        },
      ],
    };
    const raster = convert(
      [source],
      [operation('disabled', 'fill', false), operation('enabled', 'line')],
    );
    expect(pixel(raster, 1, 5)).toBe(127);
    expect(pixel(raster, 5, 5)).toBe(255);
  });
});
