// Turns the compile path's JobDiagnostics into Job Review warning strings.
//
// Advisory only, never a gate (rule 7): the return type is a list of strings,
// so there is no channel here that could refuse Frame or Start. The operator
// reads these in the Job Review warnings list and decides.
//
// JobDiagnostic is intentionally not exported from core/job's barrel (a
// CI-ratcheted legacy barrel that may only shrink), so the variant type is
// derived from compileJob's return type — the same idiom job-intent-warnings
// already uses for Group.

import type { compileJob } from '../../core/job';
import { assertNever } from '../../core/scene';
import { formatFeatureMm } from './job-review/min-feature-warnings';
import { kerfDroppedLineWarning } from './kerf-dropped-line-warning';
import { isLaserLeadDiagnostic, laserLeadWarnings } from './laser-lead-warnings';

type CompiledJob = ReturnType<typeof compileJob>;
type AnyCompileDiagnostic = NonNullable<CompiledJob['diagnostics']>[number];
// Laser lead diagnostics (ADR-626) have their own wording and merging.
type CompileDiagnostic = Exclude<
  AnyCompileDiagnostic,
  {
    readonly kind:
      | 'laser-leads-perforated'
      | 'laser-leads-tabbed'
      | 'laser-leads-adjusted'
      | 'laser-leads-side-unknown';
  }
>;

const FILL_COLLAPSED_AT_PRECISION_WARNING = (layerName: string): string =>
  `Fill on layer "${layerName}" is missing from the job because every hatch sweep rounds to a stationary point at emitted G-code precision. Check the preview, and enlarge the artwork or use a Line operation if this microscopic detail must remain visible.`;

export function compileDiagnosticWarnings(job: CompiledJob): ReadonlyArray<string> {
  const diagnostics = job.diagnostics ?? [];
  const others = diagnostics.filter(
    (diagnostic): diagnostic is CompileDiagnostic => !isLaserLeadDiagnostic(diagnostic),
  );
  return [
    ...mergeClosedUpCounts(others).map(warningFor),
    ...laserLeadWarnings(diagnostics.filter(isLaserLeadDiagnostic)),
  ];
}

function warningFor(diagnostic: CompileDiagnostic): string {
  if (diagnostic.kind === 'kerf-offset-dropped-line') return kerfDroppedLineWarning(diagnostic);
  return diagnostic.kind === 'kerf-offset-no-area'
    ? kerfNoAreaWarning(diagnostic.layerName, diagnostic.count)
    : diagnosticWarning(diagnostic);
}

// A layer compiled one object at a time (objects with their own power scale)
// reports a count per object; the operator needs one line per layer.
function mergeClosedUpCounts(
  diagnostics: ReadonlyArray<CompileDiagnostic>,
): ReadonlyArray<CompileDiagnostic> {
  const merged: CompileDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const index = merged.findIndex(
      (earlier) =>
        sameClosedUpLayer(earlier, diagnostic) ||
        sameAssumedSide(earlier, diagnostic) ||
        sameDroppedLineLayer(earlier, diagnostic) ||
        (earlier.kind === 'kerf-offset-no-area' &&
          diagnostic.kind === 'kerf-offset-no-area' &&
          earlier.layerName === diagnostic.layerName),
    );
    const earlier = merged[index];
    if (earlier?.kind === 'kerf-offset-closed-up' && diagnostic.kind === 'kerf-offset-closed-up') {
      merged[index] = { ...earlier, count: earlier.count + diagnostic.count };
    } else if (
      earlier?.kind === 'kerf-offset-no-area' &&
      diagnostic.kind === 'kerf-offset-no-area'
    ) {
      merged[index] = { ...earlier, count: earlier.count + diagnostic.count };
    } else if (
      earlier?.kind === 'kerf-offset-dropped-line' &&
      diagnostic.kind === 'kerf-offset-dropped-line'
    ) {
      merged[index] = { ...earlier, parts: [...earlier.parts, ...diagnostic.parts] };
    } else if (earlier?.kind === 'kerf-side-assumed' && diagnostic.kind === 'kerf-side-assumed') {
      merged[index] = { ...earlier, count: earlier.count + diagnostic.count };
    } else {
      merged.push(diagnostic);
    }
  }
  return merged;
}

function sameClosedUpLayer(a: CompileDiagnostic, b: CompileDiagnostic): boolean {
  return (
    a.kind === 'kerf-offset-closed-up' &&
    b.kind === 'kerf-offset-closed-up' &&
    a.layerName === b.layerName &&
    a.kerfOffsetMm === b.kerfOffsetMm
  );
}

function sameDroppedLineLayer(a: CompileDiagnostic, b: CompileDiagnostic): boolean {
  return (
    a.kind === 'kerf-offset-dropped-line' &&
    b.kind === 'kerf-offset-dropped-line' &&
    a.layerName === b.layerName &&
    a.kerfOffsetMm === b.kerfOffsetMm
  );
}

function sameAssumedSide(a: CompileDiagnostic, b: CompileDiagnostic): boolean {
  return (
    a.kind === 'kerf-side-assumed' &&
    b.kind === 'kerf-side-assumed' &&
    a.layerId === b.layerId &&
    a.aroundName === b.aroundName &&
    a.kerfOffsetMm === b.kerfOffsetMm
  );
}

function diagnosticWarning(
  diagnostic: Exclude<
    CompileDiagnostic,
    { readonly kind: 'kerf-offset-no-area' | 'kerf-offset-dropped-line' }
  >,
): string {
  switch (diagnostic.kind) {
    case 'offset-fill-failed':
      return offsetFillFailedWarning(diagnostic.layerName);
    case 'offset-fill-pass-limit':
      return offsetFillPassLimitWarning(diagnostic.layerName, diagnostic.passLimit);
    case 'fill-ownership-failed':
      return `Fill could not be prepared for ${diagnostic.count} artwork objects in operation "${diagnostic.layerName}". This run's Fill output is missing. Check the preview before running. Other prepared output remains available.`;
    case 'kerf-offset-failed':
      return kerfOffsetFailedWarning(diagnostic.layerName);
    case 'kerf-offset-closed-up':
      return kerfClosedUpWarning(diagnostic.layerName, diagnostic.count, diagnostic.kerfOffsetMm);
    case 'kerf-side-assumed':
      return kerfSideAssumedWarning(diagnostic);
    case 'fill-collapsed-at-precision':
      return FILL_COLLAPSED_AT_PRECISION_WARNING(diagnostic.layerName);
    case 'fill-ramp-too-large':
      return `Fill operation "${diagnostic.layerName}" has a Ramp, but its ramp grid would need ${diagnostic.cells.toLocaleString('en-US')} cells, more than the 8,000,000 a ramp may use. It burns flat at full power, without the ramp. Raise its Line interval or split the artwork to keep the ramp.`;
    case 'fill-ramp-scan-angle-rotary':
      return `Fill operation "${diagnostic.layerName}" has a Ramp and asks for a scan angle, cross-hatch or an angle change per pass. A ramped Fill burns as a scan, and the rotary only keeps rows along X straight, so every pass of this Fill scans along X.`;
    case 'image-scan-angle-rotary':
      return `Image "${diagnostic.source}" on layer "${diagnostic.layerName}" asks for a scan angle, cross-hatch or an angle change per pass. The rotary only keeps rows along X straight, so every pass of this image scans along X.`;
    case 'raster-source-luma-mismatch':
      return `Image "${diagnostic.source}" on layer "${diagnostic.layerName}" is missing from the job because its pixel buffer has ${diagnostic.actualPixels} samples, but its declared dimensions require ${diagnostic.expectedPixels}. Reopen or re-import the image before running.`;
    default:
      return assertNever(diagnostic, 'JobDiagnostic');
  }
}

// An offset fill whose geometry engine failed produces fewer contours than the
// artwork asks for — or none at all, in which case the layer leaves no group
// behind and would vanish from the job unremarked.
function offsetFillFailedWarning(layerName: string): string {
  return `Follow Shape on layer "${layerName}" could not be fully generated: the geometry engine failed partway, so this fill is incomplete or missing from the job. Check the preview before running, and increase Line Interval or simplify the shape. If an outline is required, configure it as a separate Line operation.`;
}

function offsetFillPassLimitWarning(layerName: string, passLimit: number): string {
  return `Follow Shape on layer "${layerName}" stopped after ${passLimit} inward-offset levels while usable interior remained, so some remaining interior fill is missing from the job. Check the preview before running, and increase Line Interval to complete the fill with fewer levels. If an outline is required, configure it as a separate Line operation.`;
}

// Kerf compensation runs on the closed contours of a Line layer — the cut that
// makes the part. When the engine fails they are all dropped, so unlike the
// fill case there is no outline left to fall back on: the layer either cuts
// nothing or cuts only its open paths.
function kerfOffsetFailedWarning(layerName: string): string {
  return `Kerf offset on layer "${layerName}" could not be generated: the geometry engine failed, so this layer's closed contours are missing from the job and will NOT be cut. Only its open paths remain. Check the preview before running, and try a smaller kerf offset, or set kerf to 0 to cut the contours uncompensated.`;
}

// The engine succeeded, but a hole or slot narrower than the kerf has no inside
// left once it shrinks by the offset (a part, when the offset is negative).
// The minimum-feature check may flag the same spot as a narrow gap; this says
// what actually happened to it.
// ADR-486 Amendment 4: a closed contour with no inside has no side to offset
// to, so it is dropped whether the offset grows or shrinks.
function kerfNoAreaWarning(layerName: string, count: number): string {
  const one = count === 1;
  return `Kerf offset on layer "${layerName}" dropped ${count} closed ${one ? 'path that encloses' : 'paths that enclose'} no area, such as a line drawn twice or a path that runs out and back over itself, so ${one ? 'it is' : 'they are'} missing from the job and will NOT be cut. Check the preview before running. Break ${one ? 'it' : 'each'} open at a node in the node editor, remove a second copy with Delete Duplicates, or set Kerf Offset to 0.`;
}

function kerfClosedUpWarning(layerName: string, count: number, kerfOffsetMm: number): string {
  const one = count === 1;
  const kerf = `the ${formatFeatureMm(2 * Math.abs(kerfOffsetMm))} mm kerf (twice its Kerf Offset)`;
  const lost = `so ${one ? 'it is' : 'they are'} missing from the job and will NOT be cut. Check the preview before running, and widen ${one ? 'it' : 'them'}`;
  if (kerfOffsetMm < 0) {
    return `Kerf offset on layer "${layerName}" shrank ${count} ${one ? 'part' : 'parts'} narrower than ${kerf} to nothing, ${lost} or use a kerf offset closer to 0.`;
  }
  return `Kerf offset on layer "${layerName}" closed up ${count} ${one ? 'hole or slot' : 'holes or slots'} narrower than ${kerf}, ${lost} or use a smaller kerf offset.`;
}

// ADR-486 Amd 3: a closed shape on a layer without kerf offset, leads or tabs
// may be a part cut uncompensated, or only a score line or border. The offset
// took it for the latter; if it is the former, the side is wrong, and the cut
// is off its drawn width by four offsets (two on each side).
function kerfSideAssumedWarning(
  diagnostic: Extract<CompileDiagnostic, { readonly kind: 'kerf-side-assumed' }>,
): string {
  const one = diagnostic.count === 1;
  const around = `"${diagnostic.aroundName}"`;
  const error = formatFeatureMm(4 * Math.abs(diagnostic.kerfOffsetMm));
  return `Kerf offset on layer "${diagnostic.layerName}": ${diagnostic.count} ${one ? 'shape sits' : 'shapes sit'} inside a closed shape on layer ${around}, which has no kerf offset, leads or tabs, so ${one ? 'it was' : 'they were'} offset as if that shape were only a score line or border. If ${around} cuts parts out, ${one ? 'this shape was' : 'these shapes were'} offset to the wrong side and ${one ? 'comes' : 'come'} out ${error} mm off ${one ? 'its' : 'their'} drawn width: give ${around} a kerf offset, or cut both on one layer.`;
}
