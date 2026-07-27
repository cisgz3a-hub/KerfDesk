// detectCncOffsetLadderWarnings — CNC-mode advisory: a layer whose inward-
// offset ladder (pocket rings, v-carve rings, relief waterlines) was cut short
// because the geometry engine FAILED, not because the region ran out of
// interior. The layer still cuts, but it stops early: material the operator
// expects to be gone is still standing, and a later pass meets stock it
// believed was cleared. Nothing else reports this — findDroppedCncLayers only
// catches a layer that produces no toolpath at all.
//
// Advisory only. It informs and never refuses Frame, Start or a save (rule 7);
// the operator decides whether to run it after checking the preview.

// Deep import: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json pins it at 67) and may only shrink, so
// the diagnostic cannot be added to it.
import { findCncOffsetLadderFailures } from '../../core/cnc/cnc-offset-ladder-diagnostics';
import type { Project } from '../../core/scene';

export function detectCncOffsetLadderWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  return findCncOffsetLadderFailures(project.scene, project.device, machine).map((layerId) =>
    offsetLadderWarning(layerNameFor(project, layerId)),
  );
}

function layerNameFor(project: Project, layerId: string): string {
  const layer = project.scene.layers.find((candidate) => candidate.id === layerId);
  return layer?.name ?? layerId;
}

function offsetLadderWarning(layerName: string): string {
  return (
    `Toolpaths on layer "${layerName}" could not be fully generated: the geometry engine failed ` +
    'partway through the inward-offset ladder, so this layer clears less material than the shape ' +
    'asks for and can leave a full-depth core or an uncut wall. The passes it did generate still ' +
    'cut. Check the preview before running, and try a slightly larger stepover, a smaller bit, or ' +
    'a simpler shape.'
  );
}
