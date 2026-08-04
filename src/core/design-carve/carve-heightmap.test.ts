import { describe, expect, it } from 'vitest';

import type { CncTool } from '../scene';
import type { Heightmap } from '../relief';
import { DEFAULT_DESIGN_LAYER, type DesignLayer } from '../design/layers';
import type { Sketch, SketchEntity } from '../design';
import { designCarveHeightmap } from './carve-heightmap';
import type { DesignCarveInput } from './carve-input';

const END_MILL: CncTool = { id: 'em', name: '3mm end mill', kind: 'end-mill', diameterMm: 3 };
const V_BIT: CncTool = {
  id: 'vb',
  name: '90deg v-bit',
  kind: 'v-bit',
  diameterMm: 6.35,
  tipAngleDeg: 90,
};
const FLAT_ENGRAVER: CncTool = {
  id: 'flat-engraver',
  name: '90deg 0.4mm-tip engraver',
  kind: 'engraving',
  diameterMm: 2,
  tipAngleDeg: 90,
  tipDiameterMm: 0.4,
};

const CELL_MM = 0.5;

const layer = (patch: Partial<DesignLayer>): DesignLayer => ({
  ...DEFAULT_DESIGN_LAYER,
  ...patch,
});

function withoutFlatDepthFlag(value: DesignLayer): DesignLayer {
  const { vCarveFlatDepthEnabled: _legacyAbsent, ...legacy } = value;
  return legacy;
}

const rect = (
  id: string,
  layerId: string,
  x: number,
  y: number,
  size: number,
  construction = false,
): SketchEntity => ({
  id,
  kind: 'rect',
  origin: { x, y },
  widthMm: size,
  heightMm: size,
  cornerRadiusMm: 0,
  layerId,
  ...(construction ? { construction: true } : {}),
});

const input = (sketch: Sketch): DesignCarveInput => ({
  sketch,
  stock: { widthMm: 20, heightMm: 20, thicknessMm: 6, originX: 0, originY: 0 },
  mmPerCell: CELL_MM,
  tools: [END_MILL, V_BIT],
  activeTool: END_MILL,
});

const depthAtMm = (map: Heightmap, x: number, y: number): number => {
  const cx = Math.min(map.widthCells - 1, Math.max(0, Math.round(x / map.mmPerCell - 0.5)));
  const cy = Math.min(map.heightCells - 1, Math.max(0, Math.round(y / map.mmPerCell - 0.5)));
  return map.depth[cy * map.widthCells + cx] ?? 0;
};

describe('designCarveHeightmap', () => {
  it('pockets the even-odd band between two rectangles — the frame field', () => {
    const band = layer({ id: 'L', cutType: 'pocket', depthMm: 4, toolId: 'em' });
    const map = designCarveHeightmap(
      input({
        entities: [rect('outer', 'L', 2, 2, 16), rect('inner', 'L', 6, 6, 8)],
        layers: [band],
      }),
    );
    expect(depthAtMm(map, 4, 10)).toBeCloseTo(-4, 5); // inside the band
    expect(depthAtMm(map, 10, 10)).toBe(0); // island inside the inner rect
    expect(depthAtMm(map, 1, 1)).toBe(0); // outside the outer rect
  });

  it('v-carves by boundary distance and clamps at layer depth and cone height', () => {
    const carve = layer({ id: 'L', cutType: 'v-carve', depthMm: 5, toolId: 'vb' });
    const map = designCarveHeightmap(
      input({ entities: [rect('r', 'L', 5, 5, 10)], layers: [carve] }),
    );
    // 90-degree bit: slope 1, cone height = 3.175mm < depthMm, so the flat
    // floor sits at the cone height, not the requested 5mm.
    const centre = depthAtMm(map, 10, 10);
    expect(centre).toBeCloseTo(-6.35 / 2, 1);
    // 1mm inside the boundary the groove is ~1mm deep (chamfer error < 5%).
    const nearEdge = depthAtMm(map, 6, 10);
    expect(nearEdge).toBeLessThan(-0.8);
    expect(nearEdge).toBeGreaterThan(-1.3);
    // Depth grows monotonically toward the middle.
    expect(centre).toBeLessThanOrEqual(nearEdge);
    expect(depthAtMm(map, 4, 10)).toBe(0);
  });

  it.each([
    { label: 'flowing', flatDepth: false, expectedDepthMm: 6.35 / 2 },
    { label: 'explicit flat', flatDepth: true, expectedDepthMm: 1 },
    { label: 'legacy absent flat', flatDepth: undefined, expectedDepthMm: 1 },
  ])(
    'previews $label V-carve depth with the same cap semantics as G-code',
    ({ flatDepth, expectedDepthMm }) => {
      const configured = layer({
        id: 'L',
        cutType: 'v-carve',
        depthMm: 1,
        toolId: 'vb',
        ...(flatDepth === undefined ? {} : { vCarveFlatDepthEnabled: flatDepth }),
      });
      const carve = flatDepth === undefined ? withoutFlatDepthFlag(configured) : configured;
      const map = designCarveHeightmap(
        input({ entities: [rect('r', 'L', 5, 5, 10)], layers: [carve] }),
      );

      expect(depthAtMm(map, 10, 10)).toBeCloseTo(-expectedDepthMm, 1);
    },
  );

  it.each([
    ['below', 0.3, false],
    ['at', 0.4, false],
    ['above', 0.6, true],
  ] as const)(
    'previews a feature $label the flat-tip diameter without inventing a point',
    (_label, sizeMm, shouldCut) => {
      const carve = layer({ id: 'L', cutType: 'v-carve', depthMm: 1, toolId: 'flat-engraver' });
      const sketch: Sketch = {
        entities: [rect('r', 'L', 0.2, 0.2, sizeMm)],
        layers: [carve],
      };
      const map = designCarveHeightmap({
        sketch,
        stock: { widthMm: 1, heightMm: 1, thicknessMm: 1, originX: 0, originY: 0 },
        mmPerCell: 0.05,
        tools: [FLAT_ENGRAVER],
        activeTool: FLAT_ENGRAVER,
      });
      expect(map.depth.some((value) => value < 0)).toBe(shouldCut);
    },
  );

  it('clamps a too-deep profile slot to a through cut at stock thickness', () => {
    const through = layer({ id: 'L', cutType: 'profile-on-path', depthMm: 99, toolId: 'em' });
    const map = designCarveHeightmap(
      input({ entities: [rect('r', 'L', 5, 5, 10)], layers: [through] }),
    );
    expect(depthAtMm(map, 10, 5)).toBeCloseTo(-6, 5); // slot on the path
    expect(depthAtMm(map, 10, 10)).toBe(0); // interior untouched
  });

  it('drills a bit-diameter hole at a circle centre and ignores other shapes', () => {
    const drill = layer({ id: 'L', cutType: 'drill', depthMm: 3, toolId: 'em' });
    const circle: SketchEntity = {
      id: 'c',
      kind: 'circle',
      center: { x: 10, y: 10 },
      radiusMm: 4,
      layerId: 'L',
    };
    const map = designCarveHeightmap(
      input({ entities: [circle, rect('r', 'L', 1, 1, 3)], layers: [drill] }),
    );
    expect(depthAtMm(map, 10, 10)).toBeCloseTo(-3, 5);
    expect(depthAtMm(map, 10, 12)).toBe(0); // 2mm out > 1.5mm bit radius
    expect(depthAtMm(map, 2.5, 2.5)).toBe(0); // rect contributes nothing to drill
  });

  it('never carves construction geometry', () => {
    const pocket = layer({ id: 'L', cutType: 'pocket', depthMm: 4 });
    const map = designCarveHeightmap(
      input({ entities: [rect('g', 'L', 5, 5, 10, true)], layers: [pocket] }),
    );
    expect(map.depth.every((value) => value === 0)).toBe(true);
  });

  it('min-combines overlapping layers so the deeper cut wins', () => {
    const shallow = layer({ id: 'A', cutType: 'pocket', depthMm: 1, toolId: 'em' });
    const deep = layer({ id: 'B', name: 'Layer 2', cutType: 'pocket', depthMm: 5, toolId: 'em' });
    const map = designCarveHeightmap(
      input({
        entities: [rect('a', 'A', 4, 4, 12), rect('b', 'B', 8, 8, 4)],
        layers: [shallow, deep],
      }),
    );
    expect(depthAtMm(map, 5, 5)).toBeCloseTo(-1, 5);
    expect(depthAtMm(map, 10, 10)).toBeCloseTo(-5, 5);
  });

  // The maintainer asked whether one pocket layer pockets everything. It does
  // not: a pocket clears the whole interior of ITS OWN layer's shape, and a
  // shape on a DIFFERENT layer neither extends it nor punches an island in it.
  // Islands come from putting both contours on the same layer (the frame case
  // covered by the first test in this file).
  it('confines a pocket to its own layer and leaves other layers alone', () => {
    const pocket = layer({ id: 'P', cutType: 'pocket', depthMm: 4, toolId: 'em' });
    const other = layer({ id: 'O', name: 'Layer 2', cutType: 'profile-on-path', depthMm: 1 });
    const map = designCarveHeightmap(
      input({
        entities: [rect('p', 'P', 2, 2, 6), rect('o', 'O', 14, 14, 4)],
        layers: [pocket, other],
      }),
    );
    expect(depthAtMm(map, 5, 5)).toBeCloseTo(-4, 5); // inside the pocket layer
    // Well clear of both shapes (3 mm from each, past the 1.5 mm bit radius).
    expect(depthAtMm(map, 11, 11)).toBe(0);
    // The other layer's shape is cut by ITS setting, not the pocket's depth.
    expect(depthAtMm(map, 14, 16)).toBeCloseTo(-1, 5);
  });

  it('is deterministic for identical input', () => {
    const carve = layer({ id: 'L', cutType: 'v-carve', depthMm: 2, toolId: 'vb' });
    const sketch: Sketch = { entities: [rect('r', 'L', 5, 5, 10)], layers: [carve] };
    const first = designCarveHeightmap(input(sketch));
    const second = designCarveHeightmap(input(sketch));
    expect(second.depth).toEqual(first.depth);
  });
});
