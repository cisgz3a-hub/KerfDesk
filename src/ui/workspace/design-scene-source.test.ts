// Regression for the DS-8 follow-up (H.7 per-layer bits): the pane's removal
// grid must stamp each tool section with ITS OWN bit kernel. Before this fix
// every move was stamped with the machine's ACTIVE bit, so a two-bit job
// rendered a v-carve border as a flat end-mill slot — full tip depth across a
// 3.175 mm swath instead of a 60° groove. Probes are in scene coordinates,
// the frame the objects are authored in and the frame the grid is stamped in
// (ADR-261 §2), so they hold under every origin convention.

import { describe, expect, it } from 'vitest';
import { toSceneCoords } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_STOCK,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import { probeRemovalGrid, type RemovalGrid } from '../../core/sim';
import { computeDesignSceneSource } from './design-scene-source';

function squareObject(
  id: string,
  color: string,
  atX: number,
  atY: number,
  size: number,
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: atX, minY: atY, maxX: atX + size, maxY: atY + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: atX, y: atY },
              { x: atX + size, y: atY },
              { x: atX + size, y: atY + size },
              { x: atX, y: atY + size },
            ],
          },
        ],
      },
    ],
  };
}

function layerWith(color: string, cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id: color, color }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
}

function probeDepth(grid: RemovalGrid, x: number, y: number): number {
  const reading = probeRemovalGrid(grid, { x, y });
  if (reading.kind !== 'inside') throw new Error(`probe (${x}, ${y}) landed off the stock`);
  return reading.depthMm;
}

// Dense rings so the vee walls follow the analytic cone (the same setting the
// v-carve perceptual suite uses); single pass keeps the fixture fast.
const VEE_SETTINGS: Partial<CncLayerSettings> = {
  cutType: 'v-carve',
  toolId: 'vb-60',
  depthMm: 3,
  depthPerPassMm: 3,
  vResolutionMm: 0.25,
};

// 100 mm stock keeps the pane's 500-cells-per-axis target at DEFAULT_CELL_MM
// (0.2 mm) resolution — fine enough for sub-millimetre wall probes.
const STOCK = { ...DEFAULT_CNC_STOCK, widthMm: 100, heightMm: 100 };

// The pane's grid covers the stock's SCENE-mapped rect (the origin transform
// may flip axes), so the squares are authored relative to that rect's min
// corner — the same mapping computeDesignSceneSource uses for the grid spec.
const DEVICE = createProject().device;
const STOCK_A = toSceneCoords(STOCK.originOffset, DEVICE);
const STOCK_B = toSceneCoords(
  { x: STOCK.originOffset.x + STOCK.widthMm, y: STOCK.originOffset.y + STOCK.heightMm },
  DEVICE,
);
const S0 = { x: Math.min(STOCK_A.x, STOCK_B.x), y: Math.min(STOCK_A.y, STOCK_B.y) };

// The vee square spans (S0 + 55)..(S0 + 85); its left-edge midline y.
const VEE_X = S0.x + 55;
const VEE_Y = S0.y + 55;
const VEE_SIZE = 30;
const VEE_EDGE_Y = VEE_Y + VEE_SIZE / 2;

// The machine's ACTIVE bit stays the default flat 1/8" end mill (em-3175):
// the adversarial setup the single-kernel bug stamped everything with.
const TWO_BIT_PROJECT: Project = {
  ...createProject(),
  machine: { ...DEFAULT_CNC_MACHINE_CONFIG, stock: STOCK },
  scene: {
    objects: [
      squareObject('pocket-square', '#222222', S0.x + 10, S0.y + 10, 30),
      squareObject('vee-square', '#dc2626', VEE_X, VEE_Y, VEE_SIZE),
    ],
    layers: [
      layerWith('#222222', { cutType: 'pocket', toolId: 'em-6350', depthMm: 4 }),
      layerWith('#dc2626', VEE_SETTINGS),
    ],
  },
};

describe('computeDesignSceneSource', () => {
  it('stamps each tool section of a two-bit job with its own bit kernel', () => {
    const source = computeDesignSceneSource(TWO_BIT_PROJECT, DEFAULT_OUTPUT_SCOPE);
    expect(source).not.toBeNull();
    if (source === null) return;
    const { grid } = source;

    // The 1/4" end mill's pocket: a flat floor at exactly its 4 mm depth.
    expect(probeDepth(grid, S0.x + 25, S0.y + 25)).toBeCloseTo(-4, 1);

    // The vee wall 0.9 mm inside the border slopes at the 60° cone:
    // −0.9/tan(30°) ≈ −1.56 (± ring spacing and cell discretization). The
    // active-bit kernel read the nearest tip line's full depth (≈ −3) here.
    const wall = probeDepth(grid, VEE_X + 0.9, VEE_EDGE_Y);
    expect(wall).toBeLessThan(-0.7);
    expect(wall).toBeGreaterThan(-2.4);

    // Just outside the border the cone has exactly reached z = 0 — untouched
    // stock. The flat 3.175 mm kernel bled ≈ 1.6 mm past the border at the
    // near-border tips' depth (≈ −1), which is the slot the operator saw.
    expect(probeDepth(grid, VEE_X - 0.9, VEE_EDGE_Y)).toBeGreaterThan(-0.2);

    // The v-bit still reaches its full programmed depth inside its region.
    let veeDeepest = 0;
    for (let x = VEE_X + 1; x <= VEE_X + VEE_SIZE - 1; x += 0.5) {
      for (let y = VEE_Y + 1; y <= VEE_Y + VEE_SIZE - 1; y += 0.5) {
        veeDeepest = Math.min(veeDeepest, probeDepth(grid, x, y));
      }
    }
    expect(veeDeepest).toBeLessThan(-2.5);

    // Nothing anywhere cuts past the deepest programmed pass (pocket, −4).
    let deepest = 0;
    for (const depth of grid.depth) deepest = Math.min(deepest, depth);
    expect(deepest).toBeGreaterThanOrEqual(-4.01);
  });

  it('resolves a single-bit job to the layer bit even when it is not the active bit', () => {
    const project: Project = {
      ...TWO_BIT_PROJECT,
      scene: {
        objects: [squareObject('vee-square', '#dc2626', VEE_X, VEE_Y, VEE_SIZE)],
        layers: [layerWith('#dc2626', VEE_SETTINGS)],
      },
    };
    const source = computeDesignSceneSource(project, DEFAULT_OUTPUT_SCOPE);
    expect(source).not.toBeNull();
    if (source === null) return;
    // Single section — stamped from the same toolpath the moves draw, with
    // the layer's v-bit, not the machine's active flat bit.
    expect(probeDepth(source.grid, VEE_X - 0.9, VEE_EDGE_Y)).toBeGreaterThan(-0.2);
    const wall = probeDepth(source.grid, VEE_X + 0.9, VEE_EDGE_Y);
    expect(wall).toBeLessThan(-0.7);
    expect(wall).toBeGreaterThan(-2.4);
    // The drawn silhouette is the bit that stamped the grid: the 6.35 mm
    // v-bit's 3.175 mm radius, not the active 1/8" bit's 1.59 mm.
    const maxRadiusMm = Math.max(...source.toolProfile.map((point) => point.radiusMm));
    expect(maxRadiusMm).toBeCloseTo(3.175, 2);
  });

  it('returns null for a laser project', () => {
    expect(computeDesignSceneSource(createProject(), DEFAULT_OUTPUT_SCOPE)).toBeNull();
  });
});
