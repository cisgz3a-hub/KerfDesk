// detectCncOffsetLadderWarnings — CNC-mode advisory: a layer whose bounded
// planner (pocket rings, V-carve medial/floor routes, relief waterlines) was cut short
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
import type { Job } from '../../core/job';

export function detectCncOffsetLadderWarnings(
  project: Project,
  compiledJob?: Job,
  sourceGeometryChecks: 'full' | 'compiled-evidence-only' = 'full',
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  const diagnostics =
    sourceGeometryChecks === 'compiled-evidence-only'
      ? compiledVCarveDiagnostics(compiledJob)
      : findCncOffsetLadderDiagnostics(project.scene, project.device, machine, compiledJob);
  return diagnostics.map((diagnostic) => ladderWarningFor(project, diagnostic));
}

function compiledVCarveDiagnostics(job: Job | undefined): ReadonlyArray<CncOffsetLadderDiagnostic> {
  const diagnostics: CncOffsetLadderDiagnostic[] = [];
  const byLayer = new Map<string, number>();
  for (const evidence of job?.cncCompilation?.vcarveOperations ?? []) {
    const mask =
      Number(evidence.offsetFailed) |
      (Number(evidence.thinResidual) << 1) |
      (Number(evidence.passLimited) << 2);
    byLayer.set(evidence.layerId, (byLayer.get(evidence.layerId) ?? 0) | mask);
  }
  for (const [layerId, mask] of byLayer) {
    for (const diagnostic of COMPILED_VCARVE_DIAGNOSTICS) {
      if ((mask & diagnostic.bit) !== 0) diagnostics.push({ layerId, kind: diagnostic.kind });
    }
  }
  return diagnostics;
}

const COMPILED_VCARVE_DIAGNOSTICS = [
  { bit: 1, kind: 'geometry-failed' },
  { bit: 2, kind: 'thin-detail-dropped' },
  { bit: 4, kind: 'pass-limit' },
] as const satisfies ReadonlyArray<{
  readonly bit: number;
  readonly kind: CncOffsetLadderDiagnostic['kind'];
}>;

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
    'partway through bounded toolpath planning, so this layer clears less material than the shape ' +
    'asks for and can leave a full-depth core or an uncut wall. The passes it did generate still ' +
    'cut. Check the preview before running, and try simplifying or enlarging the shape or choosing ' +
    'another compatible cutter.'
  );
}

// Covers every planner that runs out of PLAN rather than interior: an offset
// ring or medial-sample budget, or a variable-depth profile whose requested
// tolerance cannot be emitted.
function passLimitWarning(layerName: string): string {
  return (
    `Toolpath planning on layer "${layerName}" hit its route/ring limits or emitted-profile ` +
    'precision limit while usable interior or requested detail remained, so the layer can ' +
    'clear less material or cut a shallower detail profile than the shape asks for. The ' +
    'generated passes still cut. Check the preview before running; for fine V-carve detail, ' +
    'a wider-included-angle (more-obtuse) bit, thicker artwork, or a larger design improves Z ' +
    'representability.'
  );
}

function thinDetailDroppedWarning(layerName: string): string {
  return (
    `V-carve on layer "${layerName}": some artwork is finer than the generated detail path ` +
    'can represent at these settings and stays uncut. Everything else still cuts. To carve those ' +
    'details, thicken them, enlarge the design, use a wider-stroke font, or choose a compatible ' +
    'cutter with a smaller tip flat, then confirm the result in the preview.'
  );
}
