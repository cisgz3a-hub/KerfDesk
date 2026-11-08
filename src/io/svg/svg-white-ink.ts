// Which white fills an SVG paints as ink rather than bare material (ADR-686
// Amendment 1). The knock-out takes a white fill for paper only when the file
// paints it flat, opaque white with nothing hiding part of it. A see-through
// white (fill-opacity, a group's opacity, rgba or #rrggbbaa) shows the shape
// under it darkened, a gradient that starts white shades into another colour,
// and a mask hides some of the shape; cutting any of them out of the fills
// under them leaves a hole, or a whole emblem, where the file shows ink.

import type { WhiteInk } from '../../core/scene/colored-path';
import type { ResolvedSvgPaint } from './svg-paint-server';
import type { PresentationState } from './svg-presentation';

const WHITE = '#ffffff';

/** The entry field that marks a white fill as ink: empty for a stroked element (cut as
 * lines), flat opaque white and every other colour. */
export function svgWhiteInkField(
  strokeColor: string,
  fill: ResolvedSvgPaint,
  state: PresentationState,
): { readonly whiteInk?: WhiteInk } {
  const whiteInk = strokeColor === '' ? svgWhiteInk(fill, state) : undefined;
  return whiteInk === undefined ? {} : { whiteInk };
}

/** Why a white fill burns as ink; undefined for flat opaque white, or any other colour. */
function svgWhiteInk(fill: ResolvedSvgPaint, state: PresentationState): WhiteInk | undefined {
  if (fill.color !== WHITE) return undefined;
  if (fill.server === 'gradient') return 'gradient';
  if (state.unsupportedEffects.includes('mask')) return 'masked';
  const alpha = (fill.alpha ?? 1) * state.fillOpacity * state.opacity;
  return alpha < 1 || state.fillOpacityUnresolved ? 'translucent' : undefined;
}
