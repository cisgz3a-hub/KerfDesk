import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type SceneObject } from '../scene';
import { compileJob } from './compile-job';

const COLOR = '#ff0000';

function squareObject(): SceneObject {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines: [{ points, closed: true }] }],
  };
}

function lineLayer(): Layer {
  return createLayer({ id: COLOR, color: COLOR });
}

function compileFirstGroup(layer: Layer, device = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE) {
  return compileJob({ objects: [squareObject()], layers: [layer] }, device).groups[0];
}

describe('compileJob ADR-239 contour entry wiring', () => {
  it('bakes the entry runway into 4040 Line groups from the layer overscan', () => {
    const group = compileFirstGroup(lineLayer());
    expect(group?.kind).toBe('cut');
    expect(group?.kind === 'cut' ? group.entryRunwayMm : undefined).toBe(5);
  });

  it('bakes the entry runway into 4040 Follow Shape (offset) fill groups', () => {
    const group = compileFirstGroup({
      ...lineLayer(),
      mode: 'fill',
      fillStyle: 'offset',
      hatchSpacingMm: 1,
    });
    expect(group?.kind).toBe('fill');
    expect(group?.kind === 'fill' ? group.entryRunwayMm : undefined).toBe(5);
    expect(group?.kind === 'fill' ? group.fillStyle : undefined).toBe('offset');
  });

  it('leaves scanline fill on its ADR-234 sweep policy without a contour entry', () => {
    const group = compileFirstGroup({
      ...lineLayer(),
      mode: 'fill',
      fillStyle: 'scanline',
      hatchSpacingMm: 1,
    });
    expect(group?.kind).toBe('fill');
    expect(group?.kind === 'fill' ? group.entryRunwayMm : undefined).toBeUndefined();
    expect(group?.kind === 'fill' ? group.fillRunwayPolicy : undefined).toBe('feed-matched-entry');
  });

  it('honors overscan 0 as the explicit disable', () => {
    const group = compileFirstGroup({ ...lineLayer(), fillOverscanMm: 0 });
    expect(group?.kind === 'cut' ? group.entryRunwayMm : undefined).toBeUndefined();
  });

  it('caps oversized overscan at the 5 mm gap threshold', () => {
    const group = compileFirstGroup({ ...lineLayer(), fillOverscanMm: 12 });
    expect(group?.kind === 'cut' ? group.entryRunwayMm : undefined).toBe(5);
  });

  it('keeps generic profiles on legacy contour groups', () => {
    const group = compileFirstGroup(lineLayer(), DEFAULT_DEVICE_PROFILE);
    expect(group?.kind).toBe('cut');
    expect(group?.kind === 'cut' ? group.entryRunwayMm : undefined).toBeUndefined();
  });
});
