import {
  differenceClosedPolylinesChecked,
  normalizeClosedPolylinesEvenOddChecked,
} from '../geometry/polygon-difference';
import type { CncTool, Polyline } from '../scene';
import type { CncTaperedInlaySettings } from '../scene/cnc-tapered-inlay';
import { inlayBorder, inlayBounds, mirrorInlayContours } from './tapered-inlay-geometry';
import {
  taperedInlaySettingsIssue,
  taperedInlaySlope,
  taperedInlayToolIssue,
  taperedInlayWallStartDepth,
} from './tapered-inlay-settings';

export type TaperedInlayPairPlan =
  | { readonly ok: false; readonly reason: string; readonly offsetFailed: boolean }
  | {
      readonly ok: true;
      readonly femaleContours: ReadonlyArray<Polyline>;
      readonly maleWasteContours: ReadonlyArray<Polyline>;
      /** The plug's V-carve start depth (ADR-665): every waste tool tip sits this much lower. */
      readonly plugWallStartDepthMm: number;
      readonly findings: ReadonlyArray<string>;
    };

/**
 * Both pieces use this source revision (ADR-665). The pocket V-carves the source; the plug
 * V-carves the waste around the mirrored source from a start depth of engagement plus the radial
 * fit gap's depth, so its walls are the pocket walls offset by the fit gap on every detail.
 */
export function planTaperedInlayPair(
  contours: ReadonlyArray<Polyline>,
  settings: CncTaperedInlaySettings,
  tool: CncTool,
  directionX: 1 | -1 = 1,
): TaperedInlayPairPlan {
  const issue = sourceIssue(contours, settings, tool);
  if (issue !== null) return failure(issue);
  const normalized = normalizeClosedPolylinesEvenOddChecked(contours);
  if (normalized.kind === 'error')
    return failure('The inlay source could not be normalized.', true);
  const femaleBounds = inlayBounds(normalized.value);
  if (femaleBounds === null) return failure('The source inlay has no finite bounds.');
  const border = inlayBorder(femaleBounds, settings.plugBorderMm);
  const waste = differenceClosedPolylinesChecked([border], normalized.value);
  const plugBounds = inlayBounds([border]);
  if (waste.kind === 'error' || plugBounds === null)
    return failure('The tapered plug waste region could not be calculated.', true);
  return {
    ok: true,
    femaleContours: normalized.value,
    maleWasteContours: mirrorInlayContours(
      waste.value,
      femaleBounds,
      plugBounds,
      settings.pairSpacingMm,
      directionX,
    ),
    plugWallStartDepthMm: taperedInlayWallStartDepth(settings, tool.tipAngleDeg ?? 90),
    findings: inlayFindings(settings, tool.tipAngleDeg ?? 90),
  };
}

function sourceIssue(
  contours: ReadonlyArray<Polyline>,
  settings: CncTaperedInlaySettings,
  tool: CncTool,
): string | null {
  const settingsIssue =
    taperedInlaySettingsIssue(settings) ?? taperedInlayToolIssue(tool, settings);
  if (settingsIssue !== null) return settingsIssue;
  return contours.length === 0 || contours.some((contour) => !validClosed(contour))
    ? 'Tapered inlays require finite closed source contours.'
    : null;
}
function validClosed(contour: Polyline): boolean {
  return (
    contour.closed &&
    contour.points.length >= 3 &&
    contour.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  );
}

function inlayFindings(
  settings: CncTaperedInlaySettings,
  includedAngleDeg: number,
): ReadonlyArray<string> {
  const findings = [
    'Tapered inlay clearances are geometric estimates; material fit, glue and cutter deflection need a matched trial.',
  ];
  if (settings.pocketStartDepthMm > 0 || settings.plugStartDepthMm > 0)
    findings.push(
      'A nonzero starting plane assumes the material above that plane has already been removed; this pair does not clear it.',
    );
  if (settings.glueGapMm === 0)
    findings.push('The nominal axial glue gap is zero. No glue-space qualification is recorded.');
  const seam = fitSeamFinding(settings, includedAngleDeg);
  if (seam !== null) findings.push(seam);
  return findings;
}

// CNC audit v2 J1-P3-2 (ADR-258 Amendment 8): the plug closes its radial fit gap
// by sinking fit / tan(half angle) past engagement. When that is deeper than the
// glue gap, the plug bottoms out first and the walls never meet: a seam is left
// round the inlay, which no other line said.
function fitSeamFinding(
  settings: CncTaperedInlaySettings,
  includedAngleDeg: number,
): string | null {
  const slope = taperedInlaySlope(includedAngleDeg);
  if (!(slope > 0)) return null;
  const closesAtMm = settings.fitClearanceMm / slope;
  if (closesAtMm <= settings.glueGapMm + 1e-6) return null;
  const seamMm = settings.fitClearanceMm - settings.glueGapMm * slope;
  return (
    `The ${mm(settings.fitClearanceMm)} mm radial fit gap closes only after the plug sinks ` +
    `${mm(closesAtMm)} mm, deeper than the ${mm(settings.glueGapMm)} mm glue gap: the plug ` +
    `bottoms out first and leaves about a ${mm(seamMm)} mm seam round the inlay. Raise the glue ` +
    `gap to at least ${mm(closesAtMm)} mm, or lower the radial fit gap to ` +
    `${mm(settings.glueGapMm * slope)} mm.`
  );
}

function mm(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function failure(reason: string, offsetFailed = false): TaperedInlayPairPlan {
  return { ok: false, reason, offsetFailed };
}
