// One SVG element's own transform, as a browser draws it (CSS Transforms 2
// §"Current transformation matrix"; SVG 2 coords.html#TransformProperty):
//
//   T(origin) · translate · rotate · scale · transform · T(-origin)
//
// `transform` comes from CSS or, failing that, the presentation attribute
// (an SVG 1.1 list, svg-transform-attribute.ts); `translate`, `rotate`,
// `scale` and `transform-box` are CSS only. A browser ignores an invalid
// declaration and falls back; a valid value the importer cannot evaluate
// (font units, calc(), var(), a stroke box) is approximated and reported, so
// artwork never moves silently (ADR-574 Amendment 1).

import type { Bounds } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';
import { cssValueText, cssWideKeyword, type CssValueProblem } from './svg-css-values';
import {
  parseCssRotateProperty,
  parseCssScaleProperty,
  parseCssTransformProperty,
  parseCssTranslateProperty,
  resolveCssTransformTerms,
  type CssTransformTerms,
  type SvgReferenceBox,
} from './svg-css-transform';
import { svgGeometryLength } from './svg-geometry-length';
import {
  affineOfMatrix3d,
  matrix3dFrom2d,
  multiplyMatrix3d,
  translateMatrix3d,
  type Matrix3d,
} from './svg-matrix3d';
import { IDENTITY_SVG_MATRIX, parseSvgTransformAttribute } from './svg-transform-attribute';
import {
  CSS_INITIAL_TRANSFORM_ORIGIN,
  parseSvgTransformBox,
  parseSvgTransformOrigin,
  type SvgTransformBox,
  type SvgTransformOrigin,
} from './svg-transform-origin';
import type { SvgViewportSize } from './svg-viewport';

/** A winning declaration, kept so a child's `inherit` can read it. */
type Declaration = { readonly text: string; readonly attribute: boolean };
type Property =
  | 'transform'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'transform-origin'
  | 'transform-box';
export type SvgTransformDeclarations = Readonly<Partial<Record<Property, Declaration>>>;

/** The element's object bounding box in its own user space, or 'unresolved' past a budget. */
export type SvgFillBoxMeasure = (
  element: Element,
  viewport: SvgViewportSize,
) => Bounds | null | 'unresolved';

export type SvgElementTransform = {
  readonly matrix: SvgMatrix;
  /** The worst problem met reading this element's transform properties. */
  readonly problem: CssValueProblem | null;
  readonly declarations: SvgTransformDeclarations;
};

export type SvgElementTransformContext = {
  readonly parent: SvgTransformDeclarations;
  /** The viewport this element's percentages resolve against. */
  readonly viewport: SvgViewportSize;
  readonly measureFillBox?: SvgFillBoxMeasure;
};

type Read<T> = {
  readonly value: T | null;
  readonly declaration?: Declaration;
  readonly problem: CssValueProblem | null;
};

// An attribute maps only `transform` and `transform-origin` (SVG 2 presentation attributes).
const ATTRIBUTES: ReadonlySet<Property> = new Set(['transform', 'transform-origin']);

export function svgElementTransform(
  element: Element,
  styles: ReadonlyMap<string, string>,
  context: SvgElementTransformContext,
): SvgElementTransform {
  // Most elements declare nothing, or only a transform attribute: read those
  // directly, since <use> fan-outs reach this once per instantiated element.
  if (!PROPERTIES.some((name) => styles.has(name)) && !element.hasAttribute('transform-origin')) {
    const text = element.getAttribute('transform');
    if (text === null) return UNTRANSFORMED;
    const matrix = parseSvgTransformAttribute(text);
    const declarations = { transform: { text, attribute: true } };
    return matrix === null
      ? { matrix: IDENTITY, problem: 'invalid', declarations }
      : { matrix, problem: null, declarations };
  }
  const read = <T>(name: Property, parse: (declaration: Declaration) => T | CssValueProblem) =>
    readProperty(element, styles, context.parent, name, parse);
  const transform = read('transform', parseTransformDeclaration);
  const translate = read('translate', (d) => parseCssTranslateProperty(d.text));
  const rotate = read('rotate', (d) => parseCssRotateProperty(d.text));
  const scale = read('scale', (d) => parseCssScaleProperty(d.text));
  const origin = read('transform-origin', (d) => parseSvgTransformOrigin(d.text, d.attribute));
  const box = read('transform-box', (d) => parseSvgTransformBox(d.text));
  const declarations = declarationsOf({ transform, translate, rotate, scale, origin, box });
  const steps = [translate.value, rotate.value, scale.value, transform.value].filter(
    (terms): terms is CssTransformTerms => terms !== null && terms.length > 0,
  );
  const problems = [transform, translate, rotate, scale, origin, box].map((r) => r.problem);
  if (steps.length === 0) return { matrix: IDENTITY, problem: worst(problems), declarations };
  const reference = referenceBox(element, box.value ?? 'view-box', context);
  const matrix = composed(steps, origin.value, reference.box);
  return { matrix, problem: worst([...problems, reference.problem]), declarations };
}

const IDENTITY: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const UNTRANSFORMED: SvgElementTransform = { matrix: IDENTITY, problem: null, declarations: {} };
const PROPERTIES: ReadonlyArray<Property> = [
  'transform',
  'translate',
  'rotate',
  'scale',
  'transform-origin',
  'transform-box',
];

function parseTransformDeclaration(declaration: Declaration): CssTransformTerms | CssValueProblem {
  if (!declaration.attribute) return parseCssTransformProperty(declaration.text);
  const matrix = parseSvgTransformAttribute(declaration.text);
  if (matrix === null) return 'invalid';
  if (matrix === IDENTITY_SVG_MATRIX) return [];
  const { a, b, c, d, e, f } = matrix;
  return [{ kind: 'matrix', matrix: matrix3dFrom2d(a, b, c, d, e, f) }];
}

// The style value, then the presentation attribute: CSS ignores an invalid
// declaration rather than applying it. CSS-wide keywords never fall back.
function readProperty<T>(
  element: Element,
  styles: ReadonlyMap<string, string>,
  parent: SvgTransformDeclarations,
  name: Property,
  parse: (declaration: Declaration) => T | CssValueProblem,
): Read<T> {
  let problem: CssValueProblem | null = null;
  const candidates: (Declaration | null | undefined)[] = [
    cssDeclaration(styles.get(name), name, parent),
  ];
  if (ATTRIBUTES.has(name)) candidates.push(attributeDeclaration(element.getAttribute(name)));
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (candidate === null) return { value: null, problem };
    const value = parse(candidate);
    if (value === 'invalid') {
      problem = 'invalid';
      continue;
    }
    if (value === 'unresolved')
      return { value: null, declaration: candidate, problem: 'unresolved' };
    return { value, declaration: candidate, problem };
  }
  return { value: null, problem };
}

// undefined: nothing declared here. null: the property's default for SVG content.
function cssDeclaration(
  raw: string | undefined,
  name: Property,
  parent: SvgTransformDeclarations,
): Declaration | null | undefined {
  if (raw === undefined) return undefined;
  const text = cssValueText(raw);
  const keyword = cssWideKeyword(text);
  if (keyword === 'inherit') return parent[name] ?? null;
  if (keyword === 'initial' || keyword === 'unset') {
    return name === 'transform-origin'
      ? { text: CSS_INITIAL_TRANSFORM_ORIGIN, attribute: false }
      : null;
  }
  return keyword === null ? { text, attribute: false } : null;
}

function attributeDeclaration(raw: string | null): Declaration | undefined {
  return raw === null ? undefined : { text: raw, attribute: true };
}

function declarationsOf(reads: Record<string, Read<unknown>>): SvgTransformDeclarations {
  const names: Record<string, Property> = {
    transform: 'transform',
    translate: 'translate',
    rotate: 'rotate',
    scale: 'scale',
    origin: 'transform-origin',
    box: 'transform-box',
  };
  const declarations: Partial<Record<Property, Declaration>> = {};
  for (const [key, read] of Object.entries(reads)) {
    const name = names[key];
    if (name !== undefined && read.declaration !== undefined) declarations[name] = read.declaration;
  }
  return declarations;
}

function composed(
  steps: ReadonlyArray<CssTransformTerms>,
  origin: SvgTransformOrigin | null,
  box: SvgReferenceBox,
): SvgMatrix {
  const x = box.x + (origin === null ? 0 : origin.x.px + origin.x.percent * box.width);
  const y = box.y + (origin === null ? 0 : origin.y.px + origin.y.percent * box.height);
  const z = origin?.z ?? 0;
  let matrix: Matrix3d = translateMatrix3d(x, y, z);
  for (const terms of steps)
    matrix = multiplyMatrix3d(matrix, resolveCssTransformTerms(terms, box));
  return affineOfMatrix3d(multiplyMatrix3d(matrix, translateMatrix3d(-x, -y, -z)));
}

// fill-box is the object bounding box in the element's own user space. For a
// <use>, a browser measures it before the x/y offset. A stroke box, or the
// fill box of a viewport element, falls back to the nearest one and is reported.
function referenceBox(
  element: Element,
  kind: SvgTransformBox,
  context: SvgElementTransformContext,
): { box: SvgReferenceBox; problem: CssValueProblem | null } {
  const { viewport } = context;
  const viewBox = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  if (kind === 'view-box') return { box: viewBox, problem: null };
  const tag = element.tagName.toLowerCase();
  const measured =
    tag === 'svg' || tag === 'symbol' || context.measureFillBox === undefined
      ? 'unresolved'
      : context.measureFillBox(element, viewport);
  if (measured === 'unresolved') return { box: viewBox, problem: 'unresolved' };
  const offset =
    tag === 'use'
      ? {
          x: svgGeometryLength(element, 'x', viewport) ?? 0,
          y: svgGeometryLength(element, 'y', viewport) ?? 0,
        }
      : { x: 0, y: 0 };
  const box =
    measured === null
      ? { x: 0, y: 0, width: 0, height: 0 }
      : {
          x: measured.minX - offset.x,
          y: measured.minY - offset.y,
          width: measured.maxX - measured.minX,
          height: measured.maxY - measured.minY,
        };
  return { box, problem: kind === 'stroke-box' ? 'unresolved' : null };
}

function worst(problems: ReadonlyArray<CssValueProblem | null>): CssValueProblem | null {
  if (problems.includes('unresolved')) return 'unresolved';
  return problems.includes('invalid') ? 'invalid' : null;
}
