// Regression for the 2D preview overlay (H.7 per-layer bits): the overlay's
// removal grid must stamp each step with the bit that made it. Before this
// fix every step took the machine's ACTIVE bit's kernel, so a v-carve border
// shaded as a flat end-mill slot. Probes are in scene coordinates — the frame
// the objects are authored in and the frame the grid is stamped in — so they
// hold under every origin convention.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { toSceneCoords } from '../../core/devices';
import { buildToolpath } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_STOCK,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncMachineConfig,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../../core/scene';
import { probeRemovalGrid, type RemovalGrid } from '../../core/sim';
import { mapToolpathToScene } from './preview-scene-frame';
import { computeCncRemovalGrid } from './cnc-removal-grid';
import { toolpathToolsByToolKey } from './toolpath-tools';

const DEVICE = createProject().device;
const STOCK = { ...DEFAULT_CNC_STOCK, widthMm: 100, heightMm: 100 };
// The machine's ACTIVE bit stays the default flat 1/8" end mill (em-3175):
// the adversarial setup the single-kernel bug stamped everything with.
const MACHINE: CncMachineConfig = { ...DEFAULT_CNC_MACHINE_CONFIG, stock: STOCK };

const STOCK_A = toSceneCoords(STOCK.originOffset, DEVICE);
const STOCK_B = toSceneCoords(
  { x: STOCK.originOffset.x + STOCK.widthMm, y: STOCK.originOffset.y + STOCK.heightMm },
  DEVICE,
);
const S0 = { x: Math.min(STOCK_A.x, STOCK_B.x), y: Math.min(STOCK_A.y, STOCK_B.y) };

const VEE_X = S0.x + 55;
const VEE_Y = S0.y + 55;
const VEE_SIZE = 30;
const VEE_EDGE_Y = VEE_Y + VEE_SIZE / 2;

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
  return { ...createLayer({ id: color, color }), cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc } };
}

const VEE_SETTINGS: Partial<CncLayerSettings> = {
  cutType: 'v-carve',
  toolId: 'vb-60',
  depthMm: 3,
  depthPerPassMm: 3,
  vResolutionMm: 0.25,
};

const TWO_BIT_SCENE: Scene = {
  objects: [
    squareObject('pocket-square', '#222222', S0.x + 10, S0.y + 10, 30),
    squareObject('vee-square', '#dc2626', VEE_X, VEE_Y, VEE_SIZE),
  ],
  layers: [
    layerWith('#222222', { cutType: 'pocket', toolId: 'em-6350', depthMm: 4 }),
    layerWith('#dc2626', VEE_SETTINGS),
  ],
};

// The overlay receives a SCENE-frame toolpath (preview-scene-frame), which is
// the frame the grid is stamped in; mirror that mapping here rather than
// probing a machine-frame path against a scene-frame grid.
function sceneToolpath(scene: Scene) {
  return mapToolpathToScene(
    buildToolpath(compileCncJob(scene, DEVICE, MACHINE)),
    { x: 0, y: 0 },
    DEVICE,
  );
}

function probeDepth(grid: RemovalGrid, x: number, y: number): number {
  const reading = probeRemovalGrid(grid, { x, y });
  if (reading.kind !== 'inside') throw new Error(`probe (${x}, ${y}) landed off the stock`);
  return reading.depthMm;
}

describe('computeCncRemovalGrid', () => {
  it('shades a two-bit job with each section its own bit', () => {
    const grid = computeCncRemovalGrid(DEVICE, MACHINE, sceneToolpath(TWO_BIT_SCENE), 1);
    expect(grid).not.toBeNull();
    if (grid === null) return;

    // The 1/4" end mill's pocket: a flat floor at exactly its 4 mm depth.
    expect(probeDepth(grid, S0.x + 25, S0.y + 25)).toBeCloseTo(-4, 1);

    // The v-bit's cone wall 0.9 mm inside the border: -0.9/tan(30) ~ -1.56
    // (+/- ring spacing and cell discretization). The active flat kernel read
    // the nearest tip line's full depth here instead.
    const wall = probeDepth(grid, VEE_X + 0.9, VEE_EDGE_Y);
    expect(wall).toBeLessThan(-0.7);
    expect(wall).toBeGreaterThan(-2.4);

    // Just outside the border the cone has reached z = 0 — untouched stock.
    // The flat 3.175 mm kernel bled past the border at the near-border tips'
    // depth, which is the phantom slot the operator saw shaded.
    expect(probeDepth(grid, VEE_X - 0.9, VEE_EDGE_Y)).toBeGreaterThan(-0.2);

    // Nothing anywhere cuts past the deepest programmed pass (pocket, -4).
    let deepest = 0;
    for (const depth of grid.depth) deepest = Math.min(deepest, depth);
    expect(deepest).toBeGreaterThanOrEqual(-4.01);
  });

  it('scrubs along the one ordered path, not per bit section', () => {
    const path = sceneToolpath(TWO_BIT_SCENE);
    const early = computeCncRemovalGrid(DEVICE, MACHINE, path, 0.05);
    const full = computeCncRemovalGrid(DEVICE, MACHINE, path, 1);
    expect(early).not.toBeNull();
    expect(full).not.toBeNull();
    if (early === null || full === null) return;
    // Monotone: an early scrub can never be deeper than the finished cut.
    let violations = 0;
    for (let i = 0; i < full.depth.length; i += 1) {
      if ((early.depth[i] ?? 0) < (full.depth[i] ?? 0)) violations += 1;
    }
    expect(violations).toBe(0);
    // And it really is partial — the finished grid removes strictly more.
    const removed = (grid: RemovalGrid) => [...grid.depth].filter((d) => d < 0).length;
    expect(removed(early)).toBeLessThan(removed(full));
  });

  it('keys a two-stage v-carve by BIT, which its shared layerId cannot do', () => {
    // Clearance pocket + vee ladder compile to two groups on ONE layer with
    // DIFFERENT bits: this is why steps carry toolId rather than reusing
    // groupId (= layerId) to pick a kernel.
    const scene: Scene = {
      objects: [squareObject('vee-square', '#dc2626', VEE_X, VEE_Y, VEE_SIZE)],
      layers: [layerWith('#dc2626', { ...VEE_SETTINGS, vClearToolId: 'em-3175' })],
    };
    const groups = compileCncJob(scene, DEVICE, MACHINE).groups.filter((g) => g.kind === 'cnc');
    expect(new Set(groups.map((g) => g.layerId)).size).toBe(1);
    expect(new Set(groups.map((g) => g.toolId))).toEqual(new Set(['em-3175', 'vb-60']));

    const tools = toolpathToolsByToolKey(MACHINE, sceneToolpath(scene));
    expect(tools.get('vb-60')?.kind).toBe('v-bit');
    expect(tools.get('em-3175')?.kind).toBe('end-mill');
  });

  it('falls back to the active bit for a path whose steps carry no bit', () => {
    // Imported G-code previews arrive as bare toolpaths; the map is then just
    // the active bit and the grid still renders.
    const path = sceneToolpath(TWO_BIT_SCENE);
    // exactOptionalPropertyTypes: an absent bit OMITS the key rather than
    // setting it to undefined, which is also what an import actually produces.
    const stripped = {
      ...path,
      steps: path.steps.map((step) => {
        if (step.kind === 'travel') return step;
        const { toolId: _dropped, ...rest } = step;
        return rest;
      }),
    };
    const tools = toolpathToolsByToolKey(MACHINE, stripped);
    expect([...tools.keys()]).toEqual(['']);
    expect(tools.get('')?.id).toBe(MACHINE.toolId);
  });
});
