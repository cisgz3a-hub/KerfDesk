import { activeCncTool, sceneObjectUsesOperation, type Project } from '../../core/scene';

/**
 * A stale explicit primary-bit id deliberately follows the active machine bit
 * at compile time. Keep that compatibility behavior, but disclose the exact
 * substitution in the shared Start/Save warning surface.
 */
export function detectCncMissingPrimaryToolWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const activeTool = activeCncTool(machine);
  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    const requestedToolId = layer.cnc?.toolId;
    if (
      !layer.output ||
      !project.scene.objects.some((object) => sceneObjectUsesOperation(object, layer)) ||
      requestedToolId === undefined ||
      machine.tools.some((tool) => tool.id === requestedToolId)
    ) {
      continue;
    }
    warnings.push(
      `Operation "${layer.name}" requests missing bit "${requestedToolId}". ` +
        `Output will use the active bit "${activeTool.name}" instead; verify the bit and its ` +
        'feed, plunge, RPM, and depth/pass before cutting.',
    );
  }
  return warnings;
}
