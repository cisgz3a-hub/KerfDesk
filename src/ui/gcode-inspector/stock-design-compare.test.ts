// End to end (ADR-487): a relief project compiled through the Save path, its
// G-code read by the Inspector and carved as the carved stock carves it, lands
// on the relief design where the Inspector places the design.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  type Project,
  type ReliefObject,
  type Transform,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { emitSavePreparedOutput } from '../laser/save-output-emission';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';
import { inspectGcodeText } from './gcode-inspector-parse';
import { projectInspectionDesign } from './inspection-design';
import { createStockCarver, stockLayout, type StockMoves } from './stock-carving';
import { compareWithDesign } from './stock-compare';
import { designTarget, NO_DESIGN } from './stock-design-target';
import { buildToolSections } from './tool-sections';

const SAMPLES = 24;

// A dome 30 mm across and 3 mm deep: high in the middle, deep at the rim.
function dome(): ReliefObject {
  const samplesU8: number[] = [];
  for (let row = 0; row < SAMPLES; row += 1) {
    for (let column = 0; column < SAMPLES; column += 1) {
      const u = ((column + 0.5) / SAMPLES) * 2 - 1;
      const v = ((row + 0.5) / SAMPLES) * 2 - 1;
      samplesU8.push(Math.round(255 * Math.max(0, 1 - (u * u + v * v) * 0.5)));
    }
  }
  return {
    kind: 'relief',
    id: 'dome',
    source: 'dome.png',
    reliefSource: testReliefHeightfield({
      width: SAMPLES,
      height: SAMPLES,
      physicalWidthMm: 30,
      physicalHeightMm: 30,
      maxDepthMm: 3,
      samplesU8,
    }),
    targetWidthMm: 30,
    reliefDepthMm: 3,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
    transform: TURNED,
  };
}

// Placed off the corner and turned, so every step of the placement counts.
const TURNED: Transform = {
  x: 60,
  y: 45,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 30,
  mirrorX: false,
  mirrorY: false,
};

function reliefProject(): Project {
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 8, materialKey: 'hardwood-oak' },
    },
    scene: {
      objects: [dome()],
      layers: [
        {
          ...createLayer({ id: 'relief-op', color: DEFAULT_RELIEF_LAYER_COLOR }),
          output: true,
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            toolId: 'em-3175',
            depthPerPassMm: 1.5,
            reliefFinishToolId: 'bn-1588',
          },
        },
      ],
    },
  };
}

function compiled(project: Project) {
  const prepared = prepareOutput(project, {
    jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
  });
  const emission = emitSavePreparedOutput(prepared, {});
  if (emission.kind !== 'emitted' || emission.placement === undefined) {
    throw new Error('the relief did not compile');
  }
  const result = inspectGcodeText(emission.gcode, { machineKind: 'cnc' });
  if (!hasGcodeInspectorAnalysis(result)) throw new Error('the program did not parse');
  const { model } = result.parsed;
  const sections = buildToolSections(model, result.analysis.toolMarks);
  const moves: StockMoves = {
    segmentCount: model.segmentCount,
    positions: model.positions,
    segTool: sections.segTool,
    tools: sections.tools.map((tool) => tool.geometry),
  };
  return { prepared, placement: emission.placement, moves, gcode: emission.gcode };
}

function carvedWhole(moves: StockMoves, thicknessMm: number) {
  const layout = stockLayout(moves, thicknessMm);
  const carver = layout === null ? null : createStockCarver(layout, moves);
  if (layout === null || carver === null) throw new Error('nothing to carve');
  carver.carveTo({ index: moves.segmentCount, fraction: 0 });
  return { layout, grid: carver.grid };
}

describe('comparing the carved stock with the relief design (ADR-487)', () => {
  it('carves a compiled relief onto its design where the Inspector places it', () => {
    const project = reliefProject();
    const { prepared, placement, moves, gcode } = compiled(project);
    expect(prepared.ok && prepared.jobOriginOffset).not.toEqual({ x: 0, y: 0 });
    expect(placement.reliefIds).toEqual(['dome']);
    expect(gcode).toContain('ball');
    const design = projectInspectionDesign(project, placement);
    expect(design?.stockThicknessMm).toBe(8);
    expect(design?.stockMaterialKey).toBe('hardwood-oak');
    const { layout, grid } = carvedWhole(moves, 8);
    expect(layout.bottomZ).toBe(-8);
    const target = designTarget(grid, design?.reliefs ?? []);
    if (target === null) throw new Error('the design missed the stock');
    const result = compareWithDesign(grid.depth, target, 0.25);
    // The whole 30 mm square, turned 30°, lies on the stock.
    expect(result.cells * grid.mmPerCell ** 2).toBeCloseTo(900, -1);
    expect(result.within / result.cells).toBeGreaterThan(0.98);
    expect(result.gouged).toBe(0);
    // Tighter than the scallops the finishing ball leaves, less is within.
    const tight = compareWithDesign(grid.depth, target, 0.05);
    expect(tight.within).toBeLessThan(result.within);
  });

  it('finds the carving off a design placed 2 mm from where the program cuts it', () => {
    const project = reliefProject();
    const { placement, moves } = compiled(project);
    const shifted = projectInspectionDesign(project, {
      ...placement,
      jobOriginOffset: {
        x: placement.jobOriginOffset.x + 2,
        y: placement.jobOriginOffset.y,
      },
    });
    const { grid } = carvedWhole(moves, 8);
    const target = designTarget(grid, shifted?.reliefs ?? []);
    if (target === null) throw new Error('the design missed the stock');
    const result = compareWithDesign(grid.depth, target, 0.25);
    // Placed right, 99% is within 0.25 mm and nothing is gouged.
    expect(result.within / result.cells).toBeLessThan(0.75);
    expect(result.gouged / result.cells).toBeGreaterThan(0.05);
    expect(result.deepestGougeMm).toBeGreaterThan(0.5);
  });

  it('leaves cells outside every relief without a design', () => {
    const project = reliefProject();
    const { placement, moves } = compiled(project);
    const design = projectInspectionDesign(project, placement);
    const { grid } = carvedWhole(moves, 8);
    const target = designTarget(grid, design?.reliefs ?? []);
    expect(target?.[0]).toBe(NO_DESIGN);
    expect(target?.at(-1)).toBe(NO_DESIGN);
  });
});
