// design-simulate — the honest tier of the carve preview (ADR-272
// Amendment 1 clause 4): compile the designed layers through the REAL
// pipeline, then stamp every step with the bit that made it, so the result
// shows per-bit cutter shapes. Cheap designs run synchronously on the explicit
// Simulate click. Operations whose planners amplify small input (for example
// pocket and V-carve) are prepared and stamped in the shared design worker;
// neither phase may freeze the canvas thread.
//
// Display-only (ADR-261 §3): a failed simulate reports why and gates nothing.

import type { Sketch } from '../../../core/design';
import type { Toolpath } from '../../../core/job';
import { createProject, type CncTool, type Project } from '../../../core/scene';
import { computeRemovalGrid, kernelForTool, type RemovalGrid } from '../../../core/sim';
import { prepareOutput, type PreparedOutput } from '../../../io/gcode';
import {
  applyCarveSettingsToOperations,
  applyDesignSketch,
} from '../../state/design-apply-mutation';
import { costlyCanvasPreparation } from '../../workspace/canvas-preparation-policy';
import { buildPreviewToolpathFromPrepared } from '../../workspace/draw-preview';
import type { DesignCarveSource } from './design-carve-source';

export type DesignSimulateResult =
  | { readonly kind: 'ok'; readonly grid: RemovalGrid }
  | { readonly kind: 'empty'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

const TARGET_CELLS_PER_AXIS = 300;

export type DesignSimulationStage =
  | { readonly kind: 'ready'; readonly project: Project }
  | { readonly kind: 'result'; readonly result: DesignSimulateResult };

export type DesignSimulationRoute =
  | { readonly kind: 'immediate'; readonly result: DesignSimulateResult }
  | { readonly kind: 'background'; readonly pending: Promise<DesignSimulateResult> };

export type StartBackgroundDesignSimulation = (
  project: Project,
  source: DesignCarveSource,
) => Promise<DesignSimulateResult> | null;

export function routeDesignCarveSimulation(
  project: Project,
  sketch: Sketch,
  ids: ReadonlyArray<string>,
  source: DesignCarveSource,
  startBackground: StartBackgroundDesignSimulation,
): DesignSimulationRoute {
  const staged = stageDesignCarveSimulation(project, sketch, ids);
  if (staged.kind === 'result') return { kind: 'immediate', result: staged.result };
  if (!costlyCanvasPreparation(staged.project)) {
    return {
      kind: 'immediate',
      result: simulateStagedDesignCarveDirect(staged.project, source),
    };
  }
  const pending = startBackground(staged.project, source);
  return pending === null
    ? {
        kind: 'immediate',
        result: {
          kind: 'failed',
          reason:
            'Background bit simulation is unavailable. Reopen CurveDesk or enable worker support, then try again.',
        },
      }
    : { kind: 'background', pending };
}

/**
 * Simulates the sketch's layers as a real job against a scratch scene built
 * from the live project's machine and device. `ids` are caller-minted object
 * ids, one per entity (pure core may not generate identity).
 */
export function stageDesignCarveSimulation(
  project: Project,
  sketch: Sketch,
  ids: ReadonlyArray<string>,
): DesignSimulationStage {
  if (project.machine === undefined || project.machine.kind !== 'cnc') {
    return {
      kind: 'result',
      result: {
        kind: 'failed',
        reason:
          'Bit simulation needs a CNC machine profile — the design preview above still applies.',
      },
    };
  }
  const scratch: Project = {
    ...createProject(),
    device: project.device,
    machine: project.machine,
  };
  const applied = applyDesignSketch({ project: scratch, undoStack: [] }, sketch, ids);
  if (applied === null)
    return {
      kind: 'result',
      result: {
        kind: 'empty',
        reason: 'Nothing to simulate — the sketch has no output geometry.',
      },
    };
  const staged = applyCarveSettingsToOperations(applied, applied.carveOperations);
  return { kind: 'ready', project: staged.project };
}

/** Direct path used only after the shared cost classifier selected cheap work. */
export function simulateStagedDesignCarveDirect(
  project: Project,
  source: DesignCarveSource,
): DesignSimulateResult {
  return completeDesignCarveSimulation(project, source, prepareOutput(project, {}));
}

/** Shared completion used by both the cheap direct path and the design worker. */
export function completeDesignCarveSimulation(
  project: Project,
  source: DesignCarveSource,
  prepared: PreparedOutput,
): DesignSimulateResult {
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

  const toolpath = buildPreviewToolpathFromPrepared(project, prepared);
  if (toolpath.totalLength <= 0) {
    return { kind: 'empty', reason: 'The job produced no cutting moves.' };
  }
  const result = computeRemovalGrid(toolpath, spec, kernelForTool(source.activeTool, mmPerCell), {
    toolsByToolKey: sketchToolsByToolKey(source, toolpath),
  });
  if (result.kind !== 'ok') return { kind: 'failed', reason: result.reason };
  return { kind: 'ok', grid: result.grid };
}

// The sketch's bits come from the Design Studio's own source rather than a
// machine config, so the map is built here instead of via toolpath-tools.
function sketchToolsByToolKey(
  source: DesignCarveSource,
  toolpath: Toolpath,
): ReadonlyMap<string, CncTool> {
  const tools = new Map<string, CncTool>();
  for (const step of toolpath.steps) {
    if (step.kind === 'travel') continue;
    const toolKey = step.toolId ?? '';
    if (tools.has(toolKey)) continue;
    tools.set(toolKey, toolForKey(source, toolKey));
  }
  return tools;
}

function toolForKey(source: DesignCarveSource, toolKey: string): CncTool {
  if (toolKey === '') return source.activeTool;
  return source.tools.find((tool) => tool.id === toolKey) ?? source.activeTool;
}
