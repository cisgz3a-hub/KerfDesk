import {
  activeCncTool,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncMachineConfig,
  type CncTool,
} from '../../core/scene';

// Applying a profile may introduce aliases for catalog tools already carried
// by the project. Existing project ids must remain resolvable, while an exact
// id match keeps the profile's snapshot semantics for that tool's metadata.
export function mergeCncMachineProfileForCurrentProject(
  profileMachine: CncMachineConfig,
  currentMachine: CncMachineConfig,
): CncMachineConfig {
  const currentById = new Map(currentMachine.tools.map((tool) => [tool.id, tool] as const));
  const currentByCatalogId = firstToolsByCatalogId(currentMachine.tools);
  const exactProfileByCurrentId = exactProfileToolsByCurrentId(profileMachine.tools, currentById);
  const retainedById = new Map<string, CncTool>();
  const retainedIncomingByCatalogId = new Map<string, CncTool>();
  const incomingIdRemap = new Map<string, string>();
  const tools: CncTool[] = [];

  for (const profileTool of profileMachine.tools) {
    const retained = retainedProfileTool(
      profileTool,
      currentMachine,
      currentByCatalogId,
      exactProfileByCurrentId,
      retainedById,
      retainedIncomingByCatalogId,
    );
    if (!retainedById.has(retained.id)) {
      tools.push(retained);
      retainedById.set(retained.id, retained);
    }
    if (profileTool.catalogId !== undefined) {
      retainedIncomingByCatalogId.set(profileTool.catalogId, retained);
    }
    incomingIdRemap.set(profileTool.id, retained.id);
  }

  for (const currentTool of currentMachine.tools) {
    if (retainedById.has(currentTool.id)) continue;
    tools.push(currentTool);
    retainedById.set(currentTool.id, currentTool);
  }
  if (tools.length === 0) tools.push(...DEFAULT_CNC_MACHINE_CONFIG.tools);

  const requestedToolId = incomingIdRemap.get(profileMachine.toolId) ?? profileMachine.toolId;
  const machineWithRequestedTool = { ...profileMachine, tools, toolId: requestedToolId };
  return { ...machineWithRequestedTool, toolId: activeCncTool(machineWithRequestedTool).id };
}

export function activeCncToolFeedIdentityChanged(
  previousMachine: CncMachineConfig,
  nextMachine: CncMachineConfig,
): boolean {
  const previousTool = activeCncTool(previousMachine);
  const nextTool = activeCncTool(nextMachine);
  return previousTool.id !== nextTool.id || previousTool.fluteCount !== nextTool.fluteCount;
}

function retainedProfileTool(
  profileTool: CncTool,
  currentMachine: CncMachineConfig,
  currentByCatalogId: ReadonlyMap<string, CncTool>,
  exactProfileByCurrentId: ReadonlyMap<string, CncTool>,
  retainedById: ReadonlyMap<string, CncTool>,
  retainedIncomingByCatalogId: ReadonlyMap<string, CncTool>,
): CncTool {
  const retainedExact = retainedById.get(profileTool.id);
  if (retainedExact !== undefined) return retainedExact;
  // An exact current id keeps the profile snapshot's metadata while retaining
  // the project reference. Catalog aliases with different ids keep a current
  // project object so no project reference needs rewriting.
  const exactProfileTool = exactProfileByCurrentId.get(profileTool.id);
  if (exactProfileTool !== undefined) return exactProfileTool;
  if (profileTool.catalogId === undefined) return profileTool;
  const currentCatalogTool =
    activeCurrentCatalogTool(currentMachine, profileTool.catalogId) ??
    currentByCatalogId.get(profileTool.catalogId);
  return (
    (currentCatalogTool === undefined
      ? undefined
      : (exactProfileByCurrentId.get(currentCatalogTool.id) ?? currentCatalogTool)) ??
    retainedIncomingByCatalogId.get(profileTool.catalogId) ??
    profileTool
  );
}

function exactProfileToolsByCurrentId(
  profileTools: ReadonlyArray<CncTool>,
  currentById: ReadonlyMap<string, CncTool>,
): ReadonlyMap<string, CncTool> {
  const exact = new Map<string, CncTool>();
  for (const tool of profileTools) {
    if (currentById.has(tool.id) && !exact.has(tool.id)) exact.set(tool.id, tool);
  }
  return exact;
}

function activeCurrentCatalogTool(
  machine: CncMachineConfig,
  catalogId: string,
): CncTool | undefined {
  const activeTool = activeCncTool(machine);
  return activeTool.catalogId === catalogId ? activeTool : undefined;
}

function firstToolsByCatalogId(tools: ReadonlyArray<CncTool>): ReadonlyMap<string, CncTool> {
  const byCatalogId = new Map<string, CncTool>();
  for (const tool of tools) {
    if (tool.catalogId !== undefined && !byCatalogId.has(tool.catalogId)) {
      byCatalogId.set(tool.catalogId, tool);
    }
  }
  return byCatalogId;
}
