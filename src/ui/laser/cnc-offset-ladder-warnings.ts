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
// (scripts/index-export-baseline.json pins it at 67) and may only shrink.
import {
  findCncOffsetLadderDiagnostics,
  type CncOffsetLadderDiagnostic,
} from '../../core/cnc/cnc-offset-ladder-diagnostics';
import { assertNever, type Project } from '../../core/scene';

export function detectCncOffsetLadderWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  return findCncOffsetLadderDiagnostics(project.scene, project.device, machine).map((diagnostic) =>
    ladderWarningFor(project, diagnostic),
  );
}

function ladderWarningFor(project: Project, diagnostic: CncOffsetLadderDiagnostic): string {
  const layerName = layerNameFor(project, diagnostic.layerId);
  switch (diagnostic.kind) {
    case 'pass-limit':
      return passLimitWarning(layerName);
    case 'geometry-failed':
      return offsetLadderWarning(layerName);
    case 'thin-detail-dropped':
      return thinDetailDroppedWarning(layerName);
    default:
      return assertNever(diagnostic.kind, 'CncOffsetLadderDiagnostic kind');
  }
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

// Covers every ladder that runs out of PLAN rather than interior: a ring
// budget, a depth-clamp footprint finer than emitted coordinate precision, or
// a variable-depth detail profile whose requested tolerance cannot be emitted.
function passLimitWarning(layerName: string): string {
  return (
    `Toolpath planning on layer "${layerName}" hit its ring limits or emitted-profile ` +
    'precision limit while usable interior or requested detail remained, so the layer can ' +
    'clear less material or cut a shallower detail profile than the shape asks for. The ' +
    'generated passes still cut. Check the preview before running; for fine V-carve detail, ' +
    'a wider-angle bit or thicker artwork improves representability.'
  );
}

function thinDetailDroppedWarning(layerName: string): string {
  return (
    `V-carve on layer "${layerName}": some artwork is finer than the generated detail path ` +
    'can represent at these settings and stays uncut. Everything else still cuts. To carve those ' +
    'details, thicken them, enlarge the design, or use a wider-stroke font, then confirm the ' +
    'result in the preview.'
  );
}
