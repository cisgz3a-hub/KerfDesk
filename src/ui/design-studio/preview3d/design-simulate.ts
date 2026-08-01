// design-simulate — the honest tier of the carve preview (ADR-272
// Amendment 1 clause 4): compile the designed layers through the REAL
// pipeline, then stamp each tool section's removal grid with THAT section's
// bit kernel and min-combine (stampRemovalPerTool, shared with the CNC
// pane). Synchronous by design: it runs on an explicit click, and a designed
// sketch is orders of magnitude smaller than an imported scene.
//
// Display-only (ADR-261 §3): a failed simulate reports why and gates nothing.

import type { Sketch } from '../../../core/design';
import { createProject, type CncTool, type Project } from '../../../core/scene';
import type { RemovalGrid } from '../../../core/sim';
import { prepareOutput } from '../../../io/gcode';
import {
  applyCarveSettingsToOperations,
  applyDesignSketch,
} from '../../state/design-apply-mutation';
import { stampRemovalPerTool } from '../../workspace/stamp-removal-per-tool';
import type { DesignCarveSource } from './design-carve-source';

export type DesignSimulateResult =
  | { readonly kind: 'ok'; readonly grid: RemovalGrid }
  | { readonly kind: 'empty'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

const TARGET_CELLS_PER_AXIS = 300;

/**
 * Simulates the sketch's layers as a real job against a scratch scene built
 * from the live project's machine and device. `ids` are caller-minted object
 * ids, one per entity (pure core may not generate identity).
 */
export function simulateDesignCarve(
  project: Project,
  sketch: Sketch,
  ids: ReadonlyArray<string>,
  source: DesignCarveSource,
): DesignSimulateResult {
  if (project.machine === undefined || project.machine.kind !== 'cnc') {
    return {
      kind: 'failed',
      reason:
        'Bit simulation needs a CNC machine profile — the design preview above still applies.',
    };
  }
  const scratch: Project = {
    ...createProject(),
    device: project.device,
    machine: project.machine,
  };
  const applied = applyDesignSketch({ project: scratch, undoStack: [] }, sketch, ids);
  if (applied === null)
    return { kind: 'empty', reason: 'Nothing to simulate — the sketch has no output geometry.' };
  const staged = applyCarveSettingsToOperations(applied, applied.carveOperations);

  const prepared = prepareOutput(staged.project, {});
  if (!prepared.ok) {
    const first = prepared.preflight.issues[0]?.message ?? 'preparation failed';
    return { kind: 'failed', reason: first };
  }

  const { stock } = source;
  const mmPerCell = Math.max(0.2, Math.max(stock.widthMm, stock.heightMm) / TARGET_CELLS_PER_AXIS);
  const spec = {
    originX: stock.originX,
    originY: stock.originY,
    widthMm: stock.widthMm,
    heightMm: stock.heightMm,
    mmPerCell,
  };

  const stamped = stampRemovalPerTool({
    project: staged.project,
    prepared,
    spec,
    resolveTool: (toolKey) => toolForKey(source, toolKey),
  });
  if (stamped.kind === 'empty') {
    return { kind: 'empty', reason: 'The job produced no cutting moves.' };
  }
  return stamped;
}

function toolForKey(source: DesignCarveSource, toolKey: string): CncTool {
  if (toolKey === '') return source.activeTool;
  return source.tools.find((tool) => tool.id === toolKey) ?? source.activeTool;
}
