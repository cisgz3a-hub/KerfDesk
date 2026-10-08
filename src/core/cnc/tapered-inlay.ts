import { offsetClosedPolylinesWithRoundJoinsChecked } from '../geometry/kerf-offset';
import {
  differenceClosedPolylinesChecked,
  normalizeClosedPolylinesEvenOddChecked,
} from '../geometry/polygon-difference';
import type { CncTool, Polyline } from '../scene';
import type { CncTaperedInlaySettings } from '../scene/cnc-tapered-inlay';
import {
  inlayBorder,
  inlayBounds,
  inlayFilledArea,
  mirrorInlayContours,
} from './tapered-inlay-geometry';
import {
  taperedInlaySettingsIssue,
  taperedInlaySlope,
  taperedInlayToolIssue,
} from './tapered-inlay-settings';

export type TaperedInlayPairPlan =
  | { readonly ok: false; readonly reason: string; readonly offsetFailed: boolean }
  | {
      readonly ok: true;
      readonly femaleContours: ReadonlyArray<Polyline>;
      readonly plugTopContours: ReadonlyArray<Polyline>;
      readonly maleWasteContours: ReadonlyArray<Polyline>;
      readonly lostDetailContours: ReadonlyArray<Polyline>;
      readonly lostDetailAreaMm2: number;
      readonly findings: ReadonlyArray<string>;
      readonly engagementInsetMm: number;
    };

/** Both pieces use this source revision. The plug waste is the complement of its retained top. */
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
  const engagementInsetMm = settings.engagementDepthMm * taperedInlaySlope(tool.tipAngleDeg ?? 90);
  const plugInset = engagementInsetMm + settings.fitClearanceMm;
  const plugTop = offsetClosedPolylinesWithRoundJoinsChecked(normalized.value, -plugInset);
  if (plugTop.kind === 'error') return failure('The retained plug could not be offset.', true);
  if (plugTop.value.length === 0)
    return failure(
      'No source detail is wide enough for the requested engagement and radial fit gap.',
    );
  const reconstructed = offsetClosedPolylinesWithRoundJoinsChecked(plugTop.value, plugInset);
  if (reconstructed.kind === 'error')
    return failure('Inlay contact coverage could not be checked.', true);
  const lost = differenceClosedPolylinesChecked(normalized.value, reconstructed.value);
  if (lost.kind === 'error')
    return failure('Inlay lost-detail coverage could not be checked.', true);
  const femaleBounds = inlayBounds(normalized.value);
  if (femaleBounds === null) return failure('The source inlay has no finite bounds.');
  const border = inlayBorder(femaleBounds, settings.plugBorderMm);
  const waste = differenceClosedPolylinesChecked([border], plugTop.value);
  const plugBounds = inlayBounds([border]);
  if (waste.kind === 'error' || plugBounds === null)
    return failure('The tapered plug waste region could not be calculated.', true);
  const lostDetailAreaMm2 = inlayFilledArea(lost.value);
  return {
    ok: true,
    femaleContours: normalized.value,
    plugTopContours: plugTop.value,
    maleWasteContours: mirrorInlayContours(
      waste.value,
      femaleBounds,
      plugBounds,
      settings.pairSpacingMm,
      directionX,
    ),
    lostDetailContours: lost.value,
    lostDetailAreaMm2,
    engagementInsetMm,
    findings: inlayFindings(settings, lostDetailAreaMm2),
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
  lostAreaMm2: number,
): ReadonlyArray<string> {
  const findings = [
    'Tapered inlay clearances are geometric estimates; material fit, glue and cutter deflection need a matched trial.',
  ];
  if (lostAreaMm2 > 0.001)
    findings.push(
      `${Math.round(lostAreaMm2 * 1000) / 1000} mm² of source corners or narrow details cannot be reproduced at the nominal engagement. Inspect both pieces.`,
    );
  if (settings.pocketStartDepthMm > 0 || settings.plugStartDepthMm > 0)
    findings.push(
      'A nonzero starting plane assumes the material above that plane has already been removed; this pair does not clear it.',
    );
  if (settings.glueGapMm === 0)
    findings.push('The nominal axial glue gap is zero. No glue-space qualification is recorded.');
  return findings;
}

function failure(reason: string, offsetFailed = false): TaperedInlayPairPlan {
  return { ok: false, reason, offsetFailed };
}
