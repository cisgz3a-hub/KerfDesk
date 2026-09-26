// Resolves a clip-path reference into the shapes whose fill areas form the
// clip, each with its complete local-to-document matrix (SVG 1.1 §14.3,
// CSS Masking 1 §6):
//   - clipPathUnits: userSpaceOnUse (the default) places the content in the
//     referencing element's user space; objectBoundingBox maps 0..1 onto that
//     element's object bounding box. The clipPath's own transform applies
//     outside the bounding-box mapping, as browsers apply it.
//   - Each child contributes its geometry with its own clip-rule (inherited
//     through the clip definition, initially nonzero); children are united.
//   - A clip-path on the <clipPath> intersects the whole clip, in the
//     referencing element's user space; one on a child clips that child.
//   - A <use> child contributes the shape it references directly.
// Hidden content contributes nothing. Text, a <use> of anything but a shape,
// a reference loop or a missing clip cannot be imported faithfully and refuse.

import type { Bounds } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';
import {
  assertReadableClipContent,
  clipContentHidden,
  clipContentRule,
  clipContentTransform,
  createSvgClipPresentation,
  type SvgClipPresentation,
} from './svg-clip-presentation';
import type { SvgIdResolver } from './svg-id-resolver';
import { svgObjectBoundingBox } from './svg-object-bbox';
import { numAttr, svgClipPathId, type SvgClipReference } from './svg-presentation';
import type { SvgStyleCascade } from './svg-stylesheet';
import { multiplySvgMatrix, translateSvgMatrix } from './svg-transform-attribute';

export type SvgClipShape = {
  readonly element: Element;
  /** Maps the shape's own coordinates to document millimetres. */
  readonly matrix: SvgMatrix;
  readonly rule: 'nonzero' | 'evenodd';
  readonly clips: ReadonlyArray<ResolvedSvgClip>;
};

export type ResolvedSvgClip = {
  readonly shapes: ReadonlyArray<SvgClipShape>;
  readonly clips: ReadonlyArray<ResolvedSvgClip>;
};

export type SvgClipResolver = {
  readonly resolveId: SvgIdResolver;
  readonly presentation: SvgClipPresentation;
  readonly boundingBox: (element: Element) => Bounds | null;
  readonly serial: (element: Element) => number;
};

// The clip ids being resolved around a reference, and how many more nested
// clips it may still reach: clips that reference clips can branch at every
// level, and far beyond any real artwork that multiplies the work.
type Trail = { readonly chain: ReadonlyArray<string>; readonly budget: { remaining: number } };

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const MAX_NESTING = 32;
const MAX_NESTED_CLIPS = 1_000;
const TEXT_CLIP =
  'SVG clip paths made of text are not supported. Convert the text to paths before importing.';

export function createSvgClipResolver(
  resolveId: SvgIdResolver,
  cascade: SvgStyleCascade,
): SvgClipResolver {
  const boxes = new Map<Element, Bounds | null>();
  const serials = new Map<Element, number>();
  return {
    resolveId,
    presentation: createSvgClipPresentation(cascade),
    boundingBox: (element) => {
      if (!boxes.has(element))
        boxes.set(element, svgObjectBoundingBox(element, resolveId, cascade));
      return boxes.get(element) ?? null;
    },
    serial: (element) => {
      if (!serials.has(element)) serials.set(element, serials.size);
      return serials.get(element) ?? -1;
    },
  };
}

export function resolveSvgClip(
  reference: SvgClipReference,
  resolver: SvgClipResolver,
): ResolvedSvgClip {
  const trail = { chain: [], budget: { remaining: MAX_NESTED_CLIPS } };
  return resolveClip(reference.id, reference.transform, reference.element, resolver, trail);
}

/**
 * References with the same key resolve to the same clip: same clipPath, same
 * user space and, when the clip measures it, the same referencing element.
 */
export function svgClipReferenceKey(
  reference: SvgClipReference,
  resolver: SvgClipResolver,
): string {
  const { a, b, c, d, e, f } = reference.transform;
  const key = `${reference.id}|${a},${b},${c},${d},${e},${f}`;
  const clip = resolver.resolveId(reference.id);
  const nested = clip === null ? null : resolver.presentation.property(clip, 'clip-path');
  const measures =
    clip?.getAttribute('clipPathUnits')?.trim() === 'objectBoundingBox' ||
    (nested !== null && nested !== 'none');
  return measures ? `${key}|${resolver.serial(reference.element)}` : key;
}

function resolveClip(
  id: string,
  userSpace: SvgMatrix,
  referencing: Element,
  resolver: SvgClipResolver,
  trail: Trail,
): ResolvedSvgClip {
  if (trail.chain.includes(id)) throw new Error(`SVG clip path #${id} is nested inside itself.`);
  if (trail.chain.length >= MAX_NESTING)
    throw new Error(`SVG clip paths are nested more than ${MAX_NESTING} deep.`);
  trail.budget.remaining -= 1;
  if (trail.budget.remaining < 0)
    throw new Error('SVG clip paths refer to one another too many times to import.');
  const clip = resolver.resolveId(id);
  if (clip === null || clip.tagName.toLowerCase() !== 'clippath')
    throw new Error(`SVG clip-path refers to #${id}, which is not a clipPath in this file.`);
  assertReadableClipContent(clip, resolver.presentation);
  const next = { chain: [...trail.chain, id], budget: trail.budget };
  const content = multiplySvgMatrix(
    multiplySvgMatrix(userSpace, clipContentTransform(clip)),
    unitsMatrix(clip, referencing, resolver),
  );
  return {
    shapes: Array.from(clip.children).flatMap((child) =>
      childShapes(child, content, resolver, next),
    ),
    clips: nestedClips(clip, userSpace, referencing, resolver, next),
  };
}

function unitsMatrix(clip: Element, referencing: Element, resolver: SvgClipResolver): SvgMatrix {
  if (clip.getAttribute('clipPathUnits')?.trim() !== 'objectBoundingBox') {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  // No geometry means no box: the clip collapses and keeps nothing.
  const box = resolver.boundingBox(referencing) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    a: box.maxX - box.minX,
    b: 0,
    c: 0,
    d: box.maxY - box.minY,
    e: box.minX,
    f: box.minY,
  };
}

function childShapes(
  child: Element,
  content: SvgMatrix,
  resolver: SvgClipResolver,
  trail: Trail,
): SvgClipShape[] {
  const tag = child.tagName.toLowerCase();
  // Only shapes, text and <use> are clip content; browsers ignore the rest.
  if (!(SHAPES.has(tag) || tag === 'text' || tag === 'use')) return [];
  if (clipContentHidden(child, resolver.presentation)) return [];
  if (tag === 'text') throw new Error(TEXT_CLIP);
  assertReadableClipContent(child, resolver.presentation);
  const matrix = multiplySvgMatrix(content, clipContentTransform(child));
  if (tag === 'use') return shapesOfUse(child, matrix, resolver, trail);
  return [
    {
      element: child,
      matrix,
      rule: clipContentRule(child, resolver.presentation),
      clips: nestedClips(child, matrix, child, resolver, trail),
    },
  ];
}

function shapesOfUse(
  use: Element,
  useSpace: SvgMatrix,
  resolver: SvgClipResolver,
  trail: Trail,
): SvgClipShape[] {
  const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
  const target = href?.startsWith('#') === true ? resolver.resolveId(href.slice(1)) : null;
  // A <use> that references nothing renders nothing, as in the artwork.
  if (target === null || target === use) return [];
  const tag = target.tagName.toLowerCase();
  if (!SHAPES.has(tag) && tag !== 'text')
    throw new Error(
      'A <use> inside an SVG clip path must refer directly to a shape or path (SVG 1.1 §14.3.5).',
    );
  if (clipContentHidden(target, resolver.presentation, use)) return [];
  if (tag === 'text') throw new Error(TEXT_CLIP);
  assertReadableClipContent(target, resolver.presentation);
  const matrix = multiplySvgMatrix(
    multiplySvgMatrix(useSpace, translateSvgMatrix(numAttr(use, 'x'), numAttr(use, 'y'))),
    clipContentTransform(target),
  );
  return [
    {
      element: target,
      matrix,
      rule: clipContentRule(target, resolver.presentation, use),
      clips: [
        ...nestedClips(use, useSpace, use, resolver, trail),
        ...nestedClips(target, matrix, target, resolver, trail),
      ],
    },
  ];
}

function nestedClips(
  owner: Element,
  userSpace: SvgMatrix,
  referencing: Element,
  resolver: SvgClipResolver,
  trail: Trail,
): ResolvedSvgClip[] {
  const id = svgClipPathId(resolver.presentation.property(owner, 'clip-path'));
  return id === null ? [] : [resolveClip(id, userSpace, referencing, resolver, trail)];
}
