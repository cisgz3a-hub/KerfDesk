// Traversal drawn per look (ADR-426): Classic keeps its thin translucent red
// line; Studio dashes it so a rapid never reads as a cut, whatever the lens.

import type * as ThreeNamespace from 'three';
import { TRAVEL_OPACITY, type RevealTargets, type TravelLine } from './scene-toolpath';
import { planarTravelOpacity } from './planar-path-density';
import { STUDIO_TRAVEL_COLOR, type Viewer3dLook } from './viewer3d-look';
import type { Viewer3dTheme } from './viewer3d-theme';

const STUDIO_TRAVEL_OPACITY = 0.55;
// Dash length as a share of the job's largest dimension, so the pattern reads
// on a 20 mm badge and on a full sheet alike.
const DASH_EXTENT_FRACTION = 0.013;
const MIN_DASH_MM = 0.4;
const GAP_TO_DASH = 0.73;

export function applyTravelLook(
  three: typeof ThreeNamespace,
  line: TravelLine | null,
  look: Viewer3dLook,
  theme: Viewer3dTheme,
  extentMm: number,
): void {
  if (line === null) return;
  const dashed = look === 'studio';
  if ('isLineDashedMaterial' in line.material === dashed) return;
  const previous = line.material;
  if (dashed) {
    const dash = Math.max(MIN_DASH_MM, extentMm * DASH_EXTENT_FRACTION);
    line.material = new three.LineDashedMaterial({
      color: STUDIO_TRAVEL_COLOR,
      dashSize: dash,
      gapSize: dash * GAP_TO_DASH,
      transparent: true,
      opacity: STUDIO_TRAVEL_OPACITY,
      toneMapped: false,
      depthWrite: false,
      depthFunc: three.LessDepth,
    });
    if (!line.geometry.hasAttribute('lineDistance')) line.computeLineDistances();
  } else {
    line.material = new three.LineBasicMaterial({
      color: theme.travel,
      transparent: true,
      opacity: TRAVEL_OPACITY,
      toneMapped: false,
      depthWrite: false,
      depthFunc: three.LessDepth,
    });
  }
  previous.dispose();
}

/** Dense flat travel stays recessive as the view zooms and changes look. */
export function applyTravelDensity(
  targets: RevealTargets | null,
  line: TravelLine | null,
  look: Viewer3dLook,
  mmPerPixel: number,
): void {
  if (targets === null) return;
  const opacity = look === 'studio' ? STUDIO_TRAVEL_OPACITY : TRAVEL_OPACITY;
  if (line !== null) {
    line.material.opacity = planarTravelOpacity(targets.planarDensity, mmPerPixel, opacity);
  }
  if (targets.travelGhost !== null) {
    targets.travelGhost.material.opacity = planarTravelOpacity(
      targets.planarDensity,
      mmPerPixel,
      0.1,
    );
  }
}
