// The DS-8 acceptance gate (ADR-272 Amendment 1): a LAYERED design — two
// carve layers, two different bits — must reach a multi-bit CNC program
// through the UNCHANGED pipeline: per-bit tool sections, the profile section
// last, and a labelled M0 tool-change pause between them. This is "change
// bits mid task" proven end to end from the Studio's own data.

import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import type { Sketch } from '../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../core/design/layers';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { cncGrblStrategy, extractToolChangeLabels } from '../../core/output';
import {
  DEFAULT_CNC_MACHINE_PARAMS,
  DEFAULT_CNC_STOCK,
  DEFAULT_CNC_TOOLS,
  createProject,
  type CncMachineConfig,
} from '../../core/scene';
import { applyCarveSettingsToOperations, applyDesignSketch } from './design-apply-mutation';

const MACHINE: CncMachineConfig = {
  kind: 'cnc',
  stock: DEFAULT_CNC_STOCK,
  tools: DEFAULT_CNC_TOOLS,
  toolId: 'em-3175',
  params: DEFAULT_CNC_MACHINE_PARAMS,
};

// A tiny picture frame: the field between two rectangles pockets with a 6.35mm
// end mill, the outer rectangle cuts through with the 3.175mm bit.
const FRAME: Sketch = {
  entities: [
    {
      kind: 'rect',
      id: 'outer-pocket',
      origin: { x: 40, y: 40 },
      widthMm: 100,
      heightMm: 80,
      cornerRadiusMm: 0,
      layerId: 'field',
    },
    {
      kind: 'rect',
      id: 'inner-pocket',
      origin: { x: 60, y: 55 },
      widthMm: 60,
      heightMm: 50,
      cornerRadiusMm: 0,
      layerId: 'field',
    },
    {
      kind: 'rect',
      id: 'cutout',
      origin: { x: 30, y: 30 },
      widthMm: 120,
      heightMm: 100,
      cornerRadiusMm: 6,
      layerId: 'through',
    },
  ],
  layers: [
    {
      ...DEFAULT_DESIGN_LAYER,
      id: 'field',
      name: 'Recessed field',
      cutType: 'pocket',
      depthMm: 4,
      toolId: 'em-6350',
    },
    {
      ...DEFAULT_DESIGN_LAYER,
      id: 'through',
      name: 'Cut out',
      color: '#2563eb',
      cutType: 'profile-outside',
      depthMm: DEFAULT_CNC_STOCK.thicknessMm,
      toolId: 'em-3175',
    },
  ],
};

function appliedFrameProject() {
  const base = createProject();
  const project = { ...base, machine: MACHINE };
  const applied = applyDesignSketch(
    { project, undoStack: [] },
    FRAME,
    FRAME.entities.map((_entity, index) => `id-${index}`),
  );
  if (applied === null) throw new Error('expected the frame sketch to apply');
  return applyCarveSettingsToOperations(applied, applied.carveOperations);
}

describe('a layered design becomes a multi-bit CNC job', () => {
  const result = appliedFrameProject();
  const job = compileCncJob(result.project.scene, DEFAULT_DEVICE_PROFILE, MACHINE);
  const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);

  it('each design layer became an operation carrying its carve settings', () => {
    const byName = new Map(result.project.scene.layers.map((layer) => [layer.name, layer]));
    const field = byName.get('Recessed field');
    const through = byName.get('Cut out');
    expect(field?.cnc?.cutType).toBe('pocket');
    expect(field?.cnc?.depthMm).toBe(4);
    expect(field?.cnc?.toolId).toBe('em-6350');
    expect(through?.cnc?.cutType).toBe('profile-outside');
    expect(through?.cnc?.toolId).toBe('em-3175');
  });

  it('compiles into contiguous per-bit sections with the profile section last', () => {
    const toolOrder = job.groups.map((group) => ('toolId' in group ? group.toolId : undefined));
    expect(new Set(toolOrder).size).toBe(2);
    // Contiguous: once the bit changes it never changes back.
    const changes = toolOrder.filter((tool, at) => at > 0 && tool !== toolOrder[at - 1]).length;
    expect(changes).toBe(1);
    // The freeing profile cut runs last (cnc-tool-sections invariant).
    expect(toolOrder[toolOrder.length - 1]).toBe('em-3175');
  });

  it('emits exactly one labelled tool-change pause naming the next bit', () => {
    const labels = extractToolChangeLabels(gcode);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('3.175');
    expect(gcode).toContain('M0');
  });

  it('pockets shallower than it cuts through', () => {
    const zs = [...gcode.matchAll(/Z(-\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    expect(Math.min(...zs)).toBeCloseTo(-DEFAULT_CNC_STOCK.thicknessMm, 1);
    expect(zs.some((z) => Math.abs(z + 4) < 0.01)).toBe(true);
  });
});
