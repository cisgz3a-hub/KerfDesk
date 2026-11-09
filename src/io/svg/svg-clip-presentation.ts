// Reads what an SVG clip definition says about its own content: cascaded CSS
// and presentation attributes, inherited through the clip's own ancestors
// (never from the element that references the clip), plus a strict transform
// reader. Clip geometry decides what is cut, so anything this module cannot
// read faithfully refuses the file instead of guessing (ADR-358 Amendment 2).

import { parseSvgTransformAttribute } from './svg-transform-attribute';
import { svgPresentationStyles } from './svg-presentation';
import type { SvgMatrix } from './svg-curve-transform';
import type { SvgStyleCascade } from './svg-stylesheet';

// CSS geometry properties need their own SVG 2 geometry parser. Attributes
// remain supported; treating a CSS-positioned clip as its attribute box is not.
const GEOMETRY_PROPERTIES = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'd'];
const CSS_TRANSFORM_PROPERTIES = ['transform', 'translate', 'rotate', 'scale'];
const TRANSFORM_CONTEXT_PROPERTIES = ['transform-origin', 'transform-box'];

export type SvgClipPresentation = {
  /**
   * The winning value of `name` for `element`. Inherited properties continue
   * through `parent` (a <use> for its referenced shape) or the DOM parent.
   */
  readonly property: (
    element: Element,
    name: string,
    inherited?: boolean,
    parent?: Element,
  ) => string | null;
  readonly declaresInCss: (element: Element, name: string) => boolean;
};

export function createSvgClipPresentation(cascade: SvgStyleCascade): SvgClipPresentation {
  const cache = new Map<Element, ReadonlyMap<string, string>>();
  const styles = (element: Element): ReadonlyMap<string, string> => {
    let values = cache.get(element);
    if (values === undefined) {
      values = svgPresentationStyles(element, cascade);
      cache.set(element, values);
    }
    return values;
  };
  const property = (
    element: Element,
    name: string,
    inherited = false,
    parent?: Element,
  ): string | null => {
    let current: Element | null = element;
    while (current !== null) {
      const value = styles(current).get(name) ?? current.getAttribute(name);
      const result = declarationResult(normalizedDeclaration(value), inherited);
      if (result !== undefined) return result;
      current = current === element && parent !== undefined ? parent : current.parentElement;
    }
    return null;
  };
  return { property, declaresInCss: (element, name) => styles(element).has(name) };
}

// A value, null for none, or undefined to keep reading up the inheritance chain.
function declarationResult(
  normalized: string | undefined,
  inherited: boolean,
): string | null | undefined {
  if (normalized === 'initial' || (normalized === 'unset' && !inherited)) return null;
  if (normalized === undefined) return inherited ? undefined : null;
  return normalized === 'inherit' || normalized === 'unset' ? undefined : normalized;
}

/** Clip content that CSS sizes, places or transforms cannot be read here. */
export function assertReadableClipContent(
  element: Element,
  presentation: SvgClipPresentation,
): void {
  if (GEOMETRY_PROPERTIES.some((name) => presentation.declaresInCss(element, name)))
    throw new Error(
      'SVG clip shapes sized or positioned with CSS are not supported. Use SVG attributes for the clip geometry before importing.',
    );
  if (
    CSS_TRANSFORM_PROPERTIES.some((name) => presentation.declaresInCss(element, name)) ||
    TRANSFORM_CONTEXT_PROPERTIES.some((name) => presentation.property(element, name) !== null)
  )
    throw new Error(
      'SVG clip paths transformed with CSS are not supported. Use the transform attribute before importing.',
    );
}

/** display:none, or an inherited visibility other than visible, adds nothing to a clip. */
export function clipContentHidden(
  element: Element,
  presentation: SvgClipPresentation,
  parent?: Element,
): boolean {
  const display = presentation.property(element, 'display')?.toLowerCase();
  const visibility = presentation.property(element, 'visibility', true, parent)?.toLowerCase();
  return display === 'none' || (visibility !== undefined && visibility !== 'visible');
}

/** clip-rule is inherited through the clip definition; SVG's initial value is nonzero. */
export function clipContentRule(
  element: Element,
  presentation: SvgClipPresentation,
  parent?: Element,
): 'nonzero' | 'evenodd' {
  const rule = presentation.property(element, 'clip-rule', true, parent)?.toLowerCase();
  return rule === 'evenodd' ? 'evenodd' : 'nonzero';
}

/**
 * A browser ignores a transform attribute it cannot read and draws the shape
 * untransformed; artwork imports that way and says so. Clip geometry decides
 * what is cut, so a clip shape's unreadable or non-finite transform refuses
 * the file instead.
 */
export function clipContentTransform(element: Element): SvgMatrix {
  const matrix = parseSvgTransformAttribute(element.getAttribute('transform'));
  if (matrix === null || !Object.values(matrix).every(Number.isFinite))
    throw new Error('An SVG clip path has a transform that cannot be read.');
  return matrix;
}

function normalizedDeclaration(value: string | null | undefined): string | undefined {
  return value
    ?.trim()
    .replace(/!important$/i, '')
    .trim();
}
