import type { CutGroup, FillGroup, RasterGroup } from '../job';
import { effectiveHatchSpacingMm, normalizedHatchAngleDeg } from '../job/fill-hatching';
import type { LayerOperationSettings } from '../scene';

/** Override fields are requested inputs; downstream calibration and planning
 * can change them. Keep those facts separate from resolved scan parameters. */
export function operationProvenanceComment(
  group: CutGroup | FillGroup | RasterGroup,
): string | undefined {
  const settings = group.operationSettings;
  if (settings === undefined) return undefined;
  const requested = requestedOperationComment(settings);
  if (
    group.kind === 'fill' &&
    settings.mode === 'fill' &&
    (group.fillStyle ?? 'scanline') !== 'offset'
  ) {
    // This is the hatching plan, not a promise about rotated/scaled output
    // coordinates, clipped individual rows, or decimal-rounded machine pitch.
    const direction = group.scanDirection?.bidirectional;
    const directionText = direction === undefined ? 'unspecified' : scanDirectionText(direction);
    return `${requested}\n; effective hatch plan: interval ${effectiveHatchSpacingMm(settings.hatchSpacingMm)} mm; angle ${normalizedHatchAngleDeg(settings.hatchAngleDeg)} deg; direction ${directionText}; cross-hatch ${settings.fillCrossHatch ? 'on' : 'off'} (before output placement)`;
  }
  if (group.kind === 'raster') {
    // Pass-through keeps source pixels even when requested lines/mm differs.
    const pitch = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
    return `${requested}\n; effective image scan: row pitch ${pitch} mm; direction ${scanDirectionText(group.bidirectional ?? true)}`;
  }
  return requested;
}

function scanDirectionText(bidirectional: boolean): string {
  return bidirectional ? 'bidirectional' : 'one-way';
}

function requestedOperationComment(settings: LayerOperationSettings): string {
  if (settings.mode === 'fill') {
    return `requested override: mode fill; style ${settings.fillStyle}; interval ${settings.hatchSpacingMm} mm; angle ${settings.hatchAngleDeg} deg; direction ${scanDirectionText(settings.fillBidirectional)}; cross-hatch ${settings.fillCrossHatch ? 'on' : 'off'}`;
  }
  if (settings.mode === 'image') {
    return `requested override: mode image; dither ${settings.ditherAlgorithm}; lines ${settings.linesPerMm}/mm; direction ${scanDirectionText(settings.imageBidirectional)}; negative ${settings.negativeImage ? 'on' : 'off'}`;
  }
  return `requested override: mode line; kerf ${settings.kerfOffsetMm} mm`;
}
