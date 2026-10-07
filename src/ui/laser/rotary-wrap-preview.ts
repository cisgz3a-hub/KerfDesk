import {
  rotaryCircumferenceMm,
  rotaryMeasurementsValid,
  rotaryUsesRollerDiameter,
  rotaryYLimitMm,
  rotaryYScale,
  type RotarySetup,
} from '../../core/devices/rotary';
import { combinedBBox, type Scene } from '../../core/scene';

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
  const machineTravelMm = rotaryYLimitMm(setup);
  const scale = rotaryYScale(setup);
  if (
    ![circumferenceMm, machineTravelMm, scale].every(positiveFinite) ||
    !Number.isFinite(heightMm) ||
    heightMm < 0
  )
    return null;
  return {
    circumferenceMm,
    machineTravelMm,
    scale,
    artworkHeightMm: heightMm,
    coverage: heightMm / circumferenceMm,
    remainingMm: Math.max(0, circumferenceMm - heightMm),
    overlapMm: Math.max(0, heightMm - circumferenceMm),
    reverse: setup.reverseAxis === true,
    scaleSource: rotaryScaleSource(setup),
  };
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function rotaryScaleSource(setup: RotarySetup): string {
  if (setup.type === 'chuck')
    return 'Chuck: Y scale = motion per turn ÷ object circumference. One chuck turn is one object turn.';
  if (rotaryUsesRollerDiameter(setup))
    return 'Roller: Y scale = motion per turn ÷ (π × driven roller diameter). Object circumference sets the wrap limit.';
  return 'Surface-calibrated roller: Y scale = 1. The controller must already express surface travel in millimetres; motion per turn is unused.';
}
