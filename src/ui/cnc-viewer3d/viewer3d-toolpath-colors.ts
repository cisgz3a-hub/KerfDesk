// toolpathLineStyle — how each move kind is drawn in the 3D viewport.
//
// Deliberately free of any three import so it stays unit-testable: jsdom has no
// WebGL, so anything that touches the renderer is unreachable in vitest. Every
// decision that CAN live in a pure table lives here rather than in the scene.
//
// The colour convention is load-bearing, not decorative. Red means TRAVERSAL,
// following LightBurn, which PROJECT.md names as this project's reference.
// OpenBuilds CONTROL uses the opposite convention (red = G1 cut); an operator
// carrying that habit over would read every rapid as a cut.

import { assertNever } from '../../core/scene';
import type { Move3dKind } from '../../core/toolpath3d';
import { viewer3dTheme } from '../theme/viewer3d-theme';

export type ToolpathLineStyle = {
  readonly color: number;
  // MILLIMETRES. The material runs in world units so its shader emits the cap
  // extension that fills corner joins; screen-space width leaves a notch at
  // every corner. Roughly a cut line's own width, so the path reads as the
  // slot it will actually make.
  readonly widthMm: number;
  readonly opacity: number;
  // Dashes read as "nothing is being removed here" at a glance, which is the
  // fastest way to tell a traversal from a cut without consulting a legend.
  readonly dashed: boolean;
};

const OPAQUE = 1;

/**
 * Resolves the line style for one move kind.
 *
 * @param kind Move kind from the 3D toolpath lift.
 * @returns Colour, world-space width in mm, opacity and dash flag for that kind.
 */
export function toolpathLineStyle(kind: Move3dKind): ToolpathLineStyle {
  const { toolpath, toolpathWidthMm, toolpathTravelOpacity } = viewer3dTheme;
  switch (kind) {
    case 'cut':
      return {
        color: toolpath.cut,
        widthMm: toolpathWidthMm.cut,
        opacity: OPAQUE,
        dashed: false,
      };
    case 'rapid':
      return {
        color: toolpath.rapid,
        widthMm: toolpathWidthMm.travel,
        opacity: toolpathTravelOpacity,
        dashed: true,
      };
    // Feed-rate travel still removes nothing, but it runs at cutting speed and
    // is worth telling apart from a rapid, so it dashes in a different hue.
    case 'feed-travel':
      return {
        color: toolpath.feedTravel,
        widthMm: toolpathWidthMm.travel,
        opacity: toolpathTravelOpacity,
        dashed: true,
      };
    // A plunge IS cutting — straight down into the stock — so it stays solid
    // and full strength. It is the move most likely to break a bit.
    case 'plunge':
      return {
        color: toolpath.plunge,
        widthMm: toolpathWidthMm.plunge,
        opacity: OPAQUE,
        dashed: false,
      };
    case 'retract':
      return {
        color: toolpath.retract,
        widthMm: toolpathWidthMm.travel,
        opacity: toolpathTravelOpacity,
        dashed: true,
      };
    default:
      return assertNever(kind, 'Move3dKind');
  }
}
