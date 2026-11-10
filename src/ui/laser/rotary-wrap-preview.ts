import {
  activeRotaryTaper,
  rotaryCircumferenceMm,
  rotaryMeasurementsValid,
  rotaryUsesRollerDiameter,
  rotaryYLimitMm,
  rotaryYScale,
  type RotarySetup,
  type RotaryTaper,
} from '../../core/devices/rotary';
import { rotaryTaperRadiusAt } from '../../core/job/rotary-taper-profile';
import { combinedBBox, type Scene } from '../../core/scene';
import { isFinitePositive } from '../../core/util/finite';

export type RotaryArtworkExtent = { readonly widthMm: number; readonly heightMm: number };
export function rotaryArtworkExtent(scene: Scene): RotaryArtworkExtent | null {
  const bounds = combinedBBox(scene.objects);
  if (bounds === null) return null;
  const widthMm = bounds.maxX - bounds.minX;
  const heightMm = bounds.maxY - bounds.minY;
  return Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm >= 0 && heightMm >= 0
    ? { widthMm, heightMm }
    : null;
}

export function rotaryWrapPreview(setup: RotarySetup, artwork?: RotaryArtworkExtent | null) {
  if (!rotaryMeasurementsValid(setup)) return null;
  const circumferenceMm = rotaryCircumferenceMm(setup);
  const heightMm = artwork?.heightMm ?? 0;
  const taper = activeRotaryTaper(setup);
  const taperModel = taper === null ? null : rotaryTaperPreview(taper, artwork?.widthMm ?? null);
  // One turn where the part is narrowest under the artwork is what it must fit.
  const wrapLimitMm = taperModel?.narrowestTurnMm ?? circumferenceMm;
  const machineTravelMm = rotaryYLimitMm(setup);
  const scale = rotaryYScale(setup);
  if (
    ![circumferenceMm, machineTravelMm, scale, wrapLimitMm].every(isFinitePositive) ||
    !Number.isFinite(heightMm) ||
    heightMm < 0
  )
    return null;
  return {
    circumferenceMm,
    machineTravelMm,
    scale,
    wrapLimitMm,
    taper: taperModel,
    artworkHeightMm: heightMm,
    coverage: heightMm / wrapLimitMm,
    remainingMm: Math.max(0, wrapLimitMm - heightMm),
    overlapMm: Math.max(0, heightMm - wrapLimitMm),
    reverse: setup.reverseAxis === true,
    scaleSource: rotaryScaleSource(setup),
  };
}

export type RotaryTaperPreview = {
  readonly topTurnMm: number;
  readonly bottomTurnMm: number;
  /** One turn at the narrowest point the artwork covers (the narrower end
   * without artwork). */
  readonly narrowestTurnMm: number;
};

// The artwork runs along the side from artworkFromTopMm for its width.
function rotaryTaperPreview(taper: RotaryTaper, artworkWidthMm: number | null): RotaryTaperPreview {
  const cone = {
    referenceRadiusMm: 1,
    topX: 0,
    direction: 1 as const,
    topRadiusMm: taper.topDiameterMm / 2,
    bottomRadiusMm: taper.bottomDiameterMm / 2,
    lengthMm: taper.lengthMm,
    baseY: 0,
  };
  const near = artworkWidthMm === null ? 0 : taper.artworkFromTopMm;
  const far = artworkWidthMm === null ? taper.lengthMm : near + artworkWidthMm;
  // The radius is linear along the side, so its least is at one end.
  const narrowestRadiusMm = Math.min(
    rotaryTaperRadiusAt(cone, near),
    rotaryTaperRadiusAt(cone, far),
  );
  return {
    topTurnMm: Math.PI * taper.topDiameterMm,
    bottomTurnMm: Math.PI * taper.bottomDiameterMm,
    narrowestTurnMm: 2 * Math.PI * narrowestRadiusMm,
  };
}

function rotaryScaleSource(setup: RotarySetup): string {
  if (setup.type === 'chuck')
    return 'Chuck: Y scale = motion per turn ÷ object circumference. One chuck turn is one object turn.';
  if (rotaryUsesRollerDiameter(setup))
    return 'Roller: Y scale = motion per turn ÷ (π × driven roller diameter). Object circumference sets the wrap limit.';
  return 'Surface-calibrated roller: Y scale = 1. The controller must already express surface travel in millimetres; motion per turn is unused.';
}
