// stampRemovalPerTool — stamp a prepared job's removal grid one bit at a
// time (ADR-272 Amendment 1 clause 4): split the job's groups into per-tool
// sections, rebuild the preview toolpath for each section, stamp it with THAT
// section's bit kernel, and min-combine the grids. A single active-bit kernel
// across a multi-bit job (H.7 per-layer toolId) draws the wrong cutter — a
// v-carve border stamped as a flat end mill. Shared by the Design Studio
// simulate tier and the CNC pane's scene source. Display-only consumers
// (ADR-261 §3): a failed stamp reports why and gates nothing.

import { mergeRemovalDepthsInto } from '../../core/design-carve';
import type { Group, Toolpath } from '../../core/job';
import type { CncTool, Project } from '../../core/scene';
import {
  coarsenedCellSize,
  computeRemovalGrid,
  DEFAULT_CELL_MM,
  kernelForTool,
  type RemovalGrid,
  type RemovalGridSpec,
} from '../../core/sim';
import type { PreparedOutput } from '../../io/gcode';
import { buildPreviewToolpathFromPrepared } from './draw-preview';

type PreparedOutputOk = Extract<PreparedOutput, { readonly ok: true }>;

export type StampRemovalPerToolArgs = {
  // The project `prepared` was prepared from, so every section toolpath maps
  // into scene frame through the same device and job-origin offset.
  readonly project: Project;
  readonly prepared: PreparedOutputOk;
  readonly spec: RemovalGridSpec;
  // '' is the "machine's active bit" key, same convention as the emitter's
  // tool sections; unknown ids must resolve to the active bit, matching the
  // compiler (F-CNC1: unknown tools are dropped).
  readonly resolveTool: (toolKey: string) => CncTool;
  // The full-job preview toolpath, when the caller already built one (the CNC
  // pane builds it for the 3D moves): a single-section job then stamps that
  // toolpath directly instead of rebuilding an identical one per edit.
  readonly fullToolpath?: Toolpath;
};

export type StampRemovalPerToolResult =
  | { readonly kind: 'ok'; readonly grid: RemovalGrid }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Stamps one removal grid per tool section of the prepared job and folds them
 * into a single grid where the deepest visit wins.
 */
export function stampRemovalPerTool(args: StampRemovalPerToolArgs): StampRemovalPerToolResult {
  // The kernel must match the grid's ACTUAL cell size, which createRemovalGrid
  // may coarsen from the requested one (MAX_GRID_CELLS) — resolve it the same
  // way it does.
  const size = coarsenedCellSize(
    args.spec.widthMm,
    args.spec.heightMm,
    args.spec.mmPerCell ?? DEFAULT_CELL_MM,
  );
  if (size.kind !== 'ok') return { kind: 'failed', reason: size.reason };
  const keys = sectionToolKeys(args.prepared.job.groups);
  let combined: RemovalGrid | null = null;
  for (const toolKey of keys) {
    const toolpath = sectionToolpath(args, toolKey, keys.length);
    if (toolpath.totalLength <= 0) continue;
    const kernel = kernelForTool(args.resolveTool(toolKey), size.mmPerCell);
    const result = computeRemovalGrid(toolpath, args.spec, kernel);
    if (result.kind !== 'ok') return { kind: 'failed', reason: result.reason };
    if (combined === null) combined = result.grid;
    else mergeRemovalDepthsInto(combined.depth, result.grid.depth);
  }
  return combined === null ? { kind: 'empty' } : { kind: 'ok', grid: combined };
}

function sectionToolpath(
  args: StampRemovalPerToolArgs,
  toolKey: string,
  sectionCount: number,
): Toolpath {
  // A single-section job's section IS the whole job; reuse the caller's
  // toolpath rather than rebuilding an identical one.
  if (sectionCount === 1 && args.fullToolpath !== undefined) return args.fullToolpath;
  const sectionJob = {
    ...args.prepared.job,
    groups: args.prepared.job.groups.filter((group) => groupToolKey(group) === toolKey),
  };
  return buildPreviewToolpathFromPrepared(args.project, { ...args.prepared, job: sectionJob });
}

// Order preserved so a later section's deeper pass still wins through the
// min-combine regardless.
export function sectionToolKeys(groups: ReadonlyArray<Group>): ReadonlyArray<string> {
  const keys: string[] = [];
  for (const group of groups) {
    const key = groupToolKey(group);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Laser groups carry no bit; cnc-only callers mean they never reach the
// stamping loop, but the key function stays total over the Job union.
function groupToolKey(group: Group): string {
  return group.kind === 'cnc' ? (group.toolId ?? '') : '';
}
