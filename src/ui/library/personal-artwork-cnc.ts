import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings, type Project } from '../../core/scene';

/** Copy referenced bits into a CNC destination, retaining its active bit, stock and machine. */
export function personalArtworkCnc(target: Project, source: Project) {
  if (source.machine?.kind !== 'cnc' || target.machine?.kind !== 'cnc')
    return { source, machine: target.machine };
  const sourceMachine = source.machine;
  const tools = [...target.machine.tools];
  const mapped = new Map<string, string>();
  const copyTool = (id: string): string => {
    const previous = mapped.get(id);
    if (previous !== undefined) return previous;
    const tool = sourceMachine.tools.find((candidate) => candidate.id === id);
    if (tool === undefined)
      throw new Error(`Saved artwork references an unavailable CNC tool: ${id}.`);
    const match = tools.find((candidate) => JSON.stringify(candidate) === JSON.stringify(tool));
    const targetId = match?.id ?? `personal-tool-${crypto.randomUUID()}`;
    if (match === undefined) tools.push({ ...tool, id: targetId });
    mapped.set(id, targetId);
    return targetId;
  };
  const layers = source.scene.layers.map((layer) => {
    const cnc = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const settings: CncLayerSettings = {
      ...cnc,
      toolId: copyTool(cnc.toolId ?? sourceMachine.toolId),
      ...(cnc.vClearToolId === undefined ? {} : { vClearToolId: copyTool(cnc.vClearToolId) }),
      ...(cnc.reliefFinishToolId === undefined
        ? {}
        : { reliefFinishToolId: copyTool(cnc.reliefFinishToolId) }),
      ...(cnc.pocketRoughToolId === undefined
        ? {}
        : { pocketRoughToolId: copyTool(cnc.pocketRoughToolId) }),
    };
    return { ...layer, cnc: settings };
  });
  return {
    source: { ...source, scene: { ...source.scene, layers } },
    machine: { ...target.machine, tools },
  };
}
