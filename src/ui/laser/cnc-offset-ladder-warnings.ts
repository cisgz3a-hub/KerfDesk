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

// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json pins it at 67) and may only shrink, so
// neither the diagnostic nor the detail-pitch constant can be added to it.
import {
  findCncOffsetLadderDiagnostics,
  type CncOffsetLadderDiagnostic,
} from '../../core/cnc/cnc-offset-ladder-diagnostics';
import { THIN_DETAIL_RESOLUTION_MM } from '../../core/cnc/vcarve-thin-detail';
import { assertNever, type Project } from '../../core/scene';

// The narrowest groove the fine detail stage can carve (ADR-280).
const MIN_CARVEABLE_DETAIL_MM = 2 * THIN_DETAIL_RESOLUTION_MM;

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

// Covers every ladder that runs out of PLAN rather than interior: the
// rest-machining ring budget, the v-carve ring budget, and a depth-clamp
// footprint finer than the 0.001 mm emission grid (#584's 1° bit at 0.05 mm).
function passLimitWarning(layerName: string): string {
  return (
    `Toolpath planning on layer "${layerName}" hit its ring limits while usable interior ` +
    'remained (the ring budget, or a ring pitch finer than the 0.001 mm G-code grid), so the ' +
    'layer clears less material than the shape asks for. The generated passes still cut. ' +
    'Check the preview before running; a wider-angle bit, more depth, a larger bit or a larger ' +
    'detail/stepover reduces the ring count.'
  );
}

function thinDetailDroppedWarning(layerName: string): string {
  return (
    `V-carve on layer "${layerName}": some artwork details are narrower than ` +
    `${MIN_CARVEABLE_DETAIL_MM} mm — finer than the smallest groove the detail pass can carve — ` +
    'and stay uncut. Everything else still cuts. To carve those details, thicken them or use a ' +
    'font or artwork with slightly wider strokes.'
  );
}
