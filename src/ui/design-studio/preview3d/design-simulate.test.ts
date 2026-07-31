// The simulate tier's gate (ADR-271 Amendment 1 clause 4): real toolpaths,
// and each tool section stamped with ITS OWN bit — a v-groove where the v-bit
// ran, a flat floor where the end mill ran, in one combined grid. Assertions
// read depth VALUES, not absolute positions, so they hold under every origin
// convention (the device profile legitimately flips Y).

import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../../core/design/layers';
import {
  DEFAULT_CNC_MACHINE_PARAMS,
  DEFAULT_CNC_STOCK,
  DEFAULT_CNC_TOOLS,
  createProject,
  type Project,
} from '../../../core/scene';
import { designCarveSource } from './design-carve-source';
import { simulateDesignCarve } from './design-simulate';

const CNC_PROJECT: Project = {
  ...createProject(),
  machine: {
    kind: 'cnc',
    stock: DEFAULT_CNC_STOCK,
    tools: DEFAULT_CNC_TOOLS,
    toolId: 'em-3175',
    params: DEFAULT_CNC_MACHINE_PARAMS,
  },
};

const TWO_BIT_SKETCH: Sketch = {
  entities: [
    {
      kind: 'rect',
      id: 'pocket-rect',
      origin: { x: 100, y: 100 },
      widthMm: 60,
      heightMm: 60,
      cornerRadiusMm: 0,
      layerId: 'flat',
    },
    {
      kind: 'rect',
      id: 'vee-rect',
      origin: { x: 220, y: 220 },
      widthMm: 40,
      heightMm: 40,
      cornerRadiusMm: 0,
      layerId: 'vee',
    },
  ],
  layers: [
    {
      ...DEFAULT_DESIGN_LAYER,
      id: 'flat',
      name: 'Flat pocket',
      cutType: 'pocket',
      depthMm: 4,
      toolId: 'em-6350',
    },
    {
      ...DEFAULT_DESIGN_LAYER,
      id: 'vee',
      name: 'Vee border',
      color: '#dc2626',
      cutType: 'v-carve',
      depthMm: 3,
      toolId: 'vb-60',
    },
  ],
};

const ids = (sketch: Sketch): ReadonlyArray<string> =>
  sketch.entities.map((_entity, index) => `sim-${index}`);

describe('simulateDesignCarve', () => {
  it('carves a two-bit design with each section stamped by its own bit', () => {
    const source = designCarveSource(CNC_PROJECT);
    const outcome = simulateDesignCarve(CNC_PROJECT, TWO_BIT_SKETCH, ids(TWO_BIT_SKETCH), source);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    const depths = [...outcome.grid.depth];
    // The end mill's pocket floor: a broad flat region at exactly -4.
    const floorCells = depths.filter((depth) => Math.abs(depth + 4) < 0.05).length;
    expect(floorCells).toBeGreaterThan(200);
    // The v-bit's sloped walls: plenty of fractional depths a flat cutter
    // cannot leave, strictly between the surface and the vee's 3mm max.
    const slopeCells = depths.filter((depth) => depth < -0.4 && depth > -2.6).length;
    expect(slopeCells).toBeGreaterThan(50);
    // Nothing cuts past the stock.
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(-DEFAULT_CNC_STOCK.thicknessMm - 0.01);
  });

  it('reports a laser project as unsimulatable, without throwing', () => {
    const laser = createProject();
    const source = designCarveSource(laser);
    const outcome = simulateDesignCarve(laser, TWO_BIT_SKETCH, ids(TWO_BIT_SKETCH), source);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.reason).toContain('CNC machine profile');
  });

  it('reports an all-construction sketch as empty', () => {
    const guides: Sketch = {
      entities: TWO_BIT_SKETCH.entities.map((entity) => ({ ...entity, construction: true })),
      layers: TWO_BIT_SKETCH.layers,
    };
    const source = designCarveSource(CNC_PROJECT);
    const outcome = simulateDesignCarve(CNC_PROJECT, guides, ids(guides), source);
    expect(outcome.kind).toBe('empty');
  });
});
