// design-simulate — the honest tier of the carve preview (ADR-272
// Amendment 1 clause 4): compile the designed layers through the REAL
// pipeline, then stamp each tool section's removal grid with THAT section's
// bit kernel and min-combine — per-bit cutter shapes the single-kernel CNC
// pane cannot show. Synchronous by design: it runs on an explicit click, and
// a designed sketch is orders of magnitude smaller than an imported scene.
//
// Display-only (ADR-261 §3): a failed simulate reports why and gates nothing.

import { mergeRemovalDepthsInto } from '../../../core/design-carve';
import type { Sketch } from '../../../core/design';
import type { Group } from '../../../core/job';
import { createProject, type CncTool, type Project } from '../../../core/scene';
import { computeRemovalGrid, kernelForTool, type RemovalGrid } from '../../../core/sim';
import { prepareOutput } from '../../../io/gcode';
import {
  applyCarveSettingsToOperations,
  applyDesignSketch,
} from '../../state/design-apply-mutation';
import { buildPreviewToolpathFromPrepared } from '../../workspace/draw-preview';
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

  let combined: RemovalGrid | null = null;
  for (const toolKey of sectionToolKeys(prepared.job.groups)) {
    const sectionJob = {
      ...prepared.job,
      groups: prepared.job.groups.filter((group) => groupToolKey(group) === toolKey),
    };
    const toolpath = buildPreviewToolpathFromPrepared(staged.project, {
      ...prepared,
      job: sectionJob,
    });
    if (toolpath.totalLength <= 0) continue;
    const tool = toolForKey(source, toolKey);
    const result = computeRemovalGrid(toolpath, spec, kernelForTool(tool, mmPerCell));
    if (result.kind !== 'ok') return { kind: 'failed', reason: result.reason };
    if (combined === null) combined = result.grid;
    else mergeRemovalDepthsInto(combined.depth, result.grid.depth);
  }
  if (combined === null) return { kind: 'empty', reason: 'The job produced no cutting moves.' };
  return { kind: 'ok', grid: combined };
}

// '' is the "machine's active bit" key, same convention as the emitter's
// tool sections. Order preserved so a later section's deeper pass still wins
// through the min-combine regardless.
function sectionToolKeys(groups: ReadonlyArray<Group>): ReadonlyArray<string> {
  const keys: string[] = [];
  for (const group of groups) {
    const key = groupToolKey(group);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Laser groups carry no bit; the cnc-only guard above means they never reach
// the stamping loop, but the key function stays total over the Job union.
function groupToolKey(group: Group): string {
  return group.kind === 'cnc' ? (group.toolId ?? '') : '';
}

function toolForKey(source: DesignCarveSource, toolKey: string): CncTool {
  if (toolKey === '') return source.activeTool;
  return source.tools.find((tool) => tool.id === toolKey) ?? source.activeTool;
}
