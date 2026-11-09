// `transform-origin` and `transform-box` (CSS Transforms 1 §5-6) as a browser
// reads them on SVG content. The origin is a point in the reference box: the
// nearest viewport's viewBox, from the user-space origin (view-box, SVG's
// initial value), or the element's object bounding box (fill-box). SVG
// elements start from `0 0` (the UA style sheet), while the property's own
// initial value is `50% 50%` (Chromium 156, ADR-574 Amendment 1).

import {
  cssLength,
  cssTokens,
  cssValueHasFunction,
  type CssLengthPercentage,
  type CssValueProblem,
} from './svg-css-values';

export type SvgTransformOrigin = {
  readonly x: CssLengthPercentage;
  readonly y: CssLengthPercentage;
  readonly z: number;
};
export type SvgTransformBox = 'view-box' | 'fill-box' | 'stroke-box';

/** The property's initial value; `initial` and `unset` restore it. */
export const CSS_INITIAL_TRANSFORM_ORIGIN = '50% 50%';

type Part = { readonly axis: 'x' | 'y' | 'either' | 'length'; readonly value: CssLengthPercentage };

const KEYWORDS: Readonly<Record<string, Part>> = {
  left: { axis: 'x', value: { px: 0, percent: 0 } },
  right: { axis: 'x', value: { px: 0, percent: 1 } },
  top: { axis: 'y', value: { px: 0, percent: 0 } },
  bottom: { axis: 'y', value: { px: 0, percent: 1 } },
  center: { axis: 'either', value: { px: 0, percent: 0.5 } },
};
const CENTER = KEYWORDS.center as Part;

/**
 * One `transform-origin` value. In a presentation attribute (`attribute`), a
 * bare number is a length in user units, as it is for other SVG attributes.
 */
export function parseSvgTransformOrigin(
  text: string,
  attribute: boolean,
): SvgTransformOrigin | CssValueProblem {
  if (cssValueHasFunction(text)) return 'unresolved';
  const tokens = cssTokens(text);
  if (tokens.length === 0 || tokens.length > 3) return 'invalid';
  const parts: Part[] = [];
  for (const token of tokens.slice(0, 2)) {
    const part = originPart(token, attribute);
    if (typeof part === 'string') return part;
    parts.push(part);
  }
  const z =
    tokens[2] === undefined
      ? { px: 0, percent: 0 }
      : cssLength(tokens[2], { percent: false, unitless: attribute });
  if (typeof z === 'string') return z;
  const pair = orderedPair(parts);
  if (pair === null) return 'invalid';
  return { x: pair[0].value, y: pair[1].value, z: z.px };
}

function originPart(token: string, attribute: boolean): Part | CssValueProblem {
  const keyword = token.toLowerCase();
  if (Object.hasOwn(KEYWORDS, keyword)) return KEYWORDS[keyword] as Part;
  const value = cssLength(token, { percent: true, unitless: attribute });
  return typeof value === 'string' ? value : { axis: 'length', value };
}

// One value names one axis and centres the other. Two keywords may come in
// either order; a length fixes its position (the first is x, the second y).
function orderedPair(parts: ReadonlyArray<Part>): readonly [Part, Part] | null {
  const [first, second] = parts;
  if (first === undefined) return null;
  if (second === undefined) return first.axis === 'y' ? [CENTER, first] : [first, CENTER];
  const keywords = first.axis !== 'length' && second.axis !== 'length';
  const swap = keywords && (first.axis === 'y' || second.axis === 'x');
  const [x, y] = swap ? [second, first] : [first, second];
  return x.axis === 'y' || y.axis === 'x' ? null : [x, y];
}

/** `transform-box`; content-box and border-box mean fill-box and stroke-box on SVG content. */
export function parseSvgTransformBox(text: string): SvgTransformBox | 'invalid' {
  const keyword = text.toLowerCase();
  if (keyword === 'view-box') return 'view-box';
  if (keyword === 'fill-box' || keyword === 'content-box') return 'fill-box';
  if (keyword === 'stroke-box' || keyword === 'border-box') return 'stroke-box';
  return 'invalid';
}
