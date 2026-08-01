// toolpath-tools — which bit each of a toolpath's tool sections cuts with.
//
// The simulator stamps per step (H.7 multi-bit jobs), so it needs the bit
// behind every step's toolId. '' is the "machine's active bit" key, the same
// convention the emitter's tool sections use; unknown ids also resolve to the
// active bit, matching the compiler (F-CNC1: unknown tools are dropped).

import type { Toolpath } from '../../core/job';
import { activeCncTool, layerCncTool, type CncMachineConfig, type CncTool } from '../../core/scene';

export const ACTIVE_TOOL_KEY = '';

/**
 * Resolves a tool section key to the bit it cuts with.
 *
 * @param machine The CNC machine config holding the bit library.
 * @param toolKey A step's toolId, or '' for the machine's active bit.
 * @returns The resolved bit; the active bit for '' and for unknown ids.
 */
export function machineToolForKey(machine: CncMachineConfig, toolKey: string): CncTool {
  if (toolKey === ACTIVE_TOOL_KEY) return activeCncTool(machine);
  return layerCncTool(machine, { toolId: toolKey });
}

/**
 * Collects the bits a toolpath actually uses, keyed by tool section.
 *
 * Only the keys present in the path are resolved, so a single-bit job yields
 * a one-entry map and an imported program (whose steps carry no bit) yields
 * the active bit alone.
 *
 * @param machine The CNC machine config holding the bit library.
 * @param toolpath The toolpath whose steps carry the section keys.
 * @returns Tool-key → bit, ready for computeRemovalGrid's toolsByToolKey.
 */
export function toolpathToolsByToolKey(
  machine: CncMachineConfig,
  toolpath: Toolpath,
): ReadonlyMap<string, CncTool> {
  const tools = new Map<string, CncTool>();
  for (const step of toolpath.steps) {
    if (step.kind === 'travel') continue;
    const toolKey = step.toolId ?? ACTIVE_TOOL_KEY;
    if (tools.has(toolKey)) continue;
    tools.set(toolKey, machineToolForKey(machine, toolKey));
  }
  return tools;
}
