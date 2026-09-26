import { multiplySvgMatrix, parseSvgTransform } from './svg-transform-attribute';
import { svgPresentationStyles, type SvgClipReference } from './svg-presentation';
import type { SvgMatrix } from './svg-curve-transform';
import type { SvgStyleCascade } from './svg-stylesheet';

// CSS geometry properties need their own SVG 2 geometry parser. Attributes
// remain supported; treating a CSS-positioned clip as its attribute box is not.
const GEOMETRY_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'transform',
  'translate',
  'rotate',
  'scale',
];
const TRANSFORM_CONTEXT_PROPERTIES = ['transform-origin', 'transform-box'];

/** The clip's own presentation, independent of the element referencing it. */
export function vectorClipTransform(
  reference: SvgClipReference,
  clip: Element,
  shape: Element,
  cascade: SvgStyleCascade,
): SvgMatrix | null {
  const cache = new Map<Element, ReadonlyMap<string, string>>();
  const styles = (element: Element) => {
    let values = cache.get(element);
    if (values === undefined) {
      values = svgPresentationStyles(element, cascade);
      cache.set(element, values);
    }
    return values;
  };
  const property = (element: Element, name: string, inherited = false): string | null => {
    let current: Element | null = element;
    while (current !== null) {
      const value = styles(current).get(name) ?? current.getAttribute(name);
      const normalized = normalizedDeclaration(value);
      if (normalized === 'initial' || (normalized === 'unset' && !inherited)) return null;
      if (normalized !== undefined && normalized !== 'inherit' && normalized !== 'unset')
        return normalized;
      if (normalized === undefined && !inherited) return null;
      current = current.parentElement;
    }
    return null;
  };
  for (const element of [clip, shape]) {
    if (GEOMETRY_PROPERTIES.some((name) => styles(element).has(name))) return null;
    if (TRANSFORM_CONTEXT_PROPERTIES.some((name) => property(element, name) !== null)) return null;
    if (
      ['clip-path', 'mask', 'filter'].some((name) => {
        const value = property(element, name);
        return value !== null && value !== 'none';
      })
    )
      return null;
  }
  // display on clipPath (or its definition ancestors) does not disable the
  // reference. Its child must contribute geometry; visibility is inherited.
  const display = property(shape, 'display');
  const visibility = property(shape, 'visibility', true);
  if (display === 'none' || (visibility !== null && visibility !== 'visible')) return null;
  const clipTransform = validatedAttributeTransform(clip.getAttribute('transform'));
  const shapeTransform = validatedAttributeTransform(shape.getAttribute('transform'));
  if (clipTransform === null || shapeTransform === null) return null;
  const world = multiplySvgMatrix(
    multiplySvgMatrix(reference.transform, clipTransform),
    shapeTransform,
  );
  return Object.values(world).every(Number.isFinite) ? world : null;
}

function normalizedDeclaration(value: string | null | undefined): string | undefined {
  return value
    ?.trim()
    .replace(/\s*!important$/i, '')
    .trim();
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
const NUMBER_LIST = new RegExp(String.raw`^\s*${NUMBER}(?:[\s,]+${NUMBER})*\s*$`);
const TRANSFORM_ARITIES: Readonly<Record<string, ReadonlyArray<number>>> = {
  matrix: [6],
  translate: [1, 2],
  scale: [1, 2],
  rotate: [1, 3],
  skewX: [1],
  skewY: [1],
};

// The general SVG importer tolerates malformed transform tokens. A proof may
// not silently drop one, nor apply SVG's unitless parser to a CSS transform.
function validatedAttributeTransform(input: string | null): SvgMatrix | null {
  if (input === null || input.trim() === '') return parseSvgTransform(null);
  let end = 0;
  for (const match of input.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    if (!/^[\s,]*$/.test(input.slice(end, match.index))) return null;
    const name = match[1] ?? '';
    const argumentsText = match[2] ?? '';
    if (!validTransformArguments(name, argumentsText)) return null;
    end = match.index + match[0].length;
  }
  return end > 0 && /^[\s,]*$/.test(input.slice(end)) ? parseSvgTransform(input) : null;
}

function validTransformArguments(name: string, text: string): boolean {
  if (!NUMBER_LIST.test(text)) return false;
  const values = text
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return values.every(Number.isFinite) && TRANSFORM_ARITIES[name]?.includes(values.length) === true;
}
