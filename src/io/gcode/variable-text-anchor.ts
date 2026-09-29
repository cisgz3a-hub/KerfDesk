// Every text render re-roots its geometry at its own ink top-left, so a
// record rendered into a variable text's place would otherwise hang from its
// own top-left corner: a centred name drifts with its width and the baseline
// jumps with its capitals and accents. Output instead moves each record so
// its alignment anchor (the point on the first baseline where the lines
// start, centre or end) lands where the anchor of the placed geometry was.

import {
  applyTransform,
  type Bounds,
  type Project,
  type TextObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import type { VariableTextRenderer } from './prepare-output-snapshot';

type AnchoredRender = {
  readonly anchor: Vec2;
  readonly width: number;
  readonly height: number;
};
type AnchorCache = Map<string, Promise<AnchoredRender | undefined>>;

// Re-rendering the placed text costs a font parse, so anchors are kept per
// render input; a batch of copies then pays for each distinct value once.
const MAX_CACHED_ANCHORS = 512;
const anchorCaches = new WeakMap<VariableTextRenderer, AnchorCache>();
// A re-render of the same input is exact; this only absorbs rounding in
// geometry saved by an older build.
const EXTENT_TOLERANCE_MM = 0.01;

export type RenderedVariableText = {
  readonly content: string;
  readonly anchor: Vec2 | undefined;
  readonly bounds: Bounds;
};

/** The text's transform, moved so the rendered record keeps the placed text's anchor. */
export async function anchoredVariableTextTransform(
  text: TextObject,
  record: RenderedVariableText,
  project: Project,
  renderer: VariableTextRenderer,
): Promise<Transform> {
  if (record.anchor === undefined) return text.transform;
  const cache = rendererAnchorCache(renderer);
  const recordRender = anchoredRender(record.anchor, record.bounds);
  remember(cache, anchorKey(text, record.content), Promise.resolve(recordRender));
  // The placed geometry was rendered from the text's own content.
  if (record.content === text.content) return text.transform;
  const placed = await placedRender(text, project, renderer, cache);
  // Only a re-render that reproduces the placed geometry's size can say where
  // its anchor was; anything else keeps the placement output always used.
  if (placed === undefined || !sameExtent(placed, text.bounds)) return text.transform;
  return shiftTransform(
    text.transform,
    placed.anchor.x + text.bounds.minX - record.anchor.x,
    placed.anchor.y + text.bounds.minY - record.anchor.y,
  );
}

async function placedRender(
  text: TextObject,
  project: Project,
  renderer: VariableTextRenderer,
  cache: AnchorCache,
): Promise<AnchoredRender | undefined> {
  const key = anchorKey(text, text.content);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const pending = renderer({ text, content: text.content, project }).then((rendered) =>
    rendered.transform === undefined && rendered.anchor !== undefined
      ? anchoredRender(rendered.anchor, rendered.bounds)
      : undefined,
  );
  remember(cache, key, pending);
  try {
    return await pending;
  } catch {
    // The record itself rendered, so keep the earlier placement rather than
    // failing the output; a later preparation retries the placed text.
    if (cache.get(key) === pending) cache.delete(key);
    return undefined;
  }
}

function anchoredRender(anchor: Vec2, bounds: Bounds): AnchoredRender {
  return { anchor, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}

function sameExtent(render: AnchoredRender, bounds: Bounds): boolean {
  return (
    Math.abs(render.width - (bounds.maxX - bounds.minX)) <= EXTENT_TOLERANCE_MM &&
    Math.abs(render.height - (bounds.maxY - bounds.minY)) <= EXTENT_TOLERANCE_MM
  );
}

function shiftTransform(transform: Transform, dx: number, dy: number): Transform {
  if (dx === 0 && dy === 0) return transform;
  // The shift is in the text's own millimetres, so it goes through the
  // object's scale, mirror and rotation before it moves the origin.
  const shift = applyTransform({ x: dx, y: dy }, { ...transform, x: 0, y: 0 });
  return { ...transform, x: transform.x + shift.x, y: transform.y + shift.y };
}

// Everything the text renderer reads for plain text; path text never gets
// here because its renderer places it and returns a transform instead.
function anchorKey(text: TextObject, content: string): string {
  return JSON.stringify([
    content,
    text.fontKey,
    text.sizeMm,
    text.alignment,
    text.lineHeight,
    text.letterSpacing,
    text.bendDeg ?? 0,
    text.weldOverlaps === true,
    text.color,
  ]);
}

function rendererAnchorCache(renderer: VariableTextRenderer): AnchorCache {
  let cache = anchorCaches.get(renderer);
  if (cache === undefined) {
    cache = new Map();
    anchorCaches.set(renderer, cache);
  }
  return cache;
}

function remember(
  cache: AnchorCache,
  key: string,
  render: Promise<AnchoredRender | undefined>,
): void {
  cache.delete(key);
  cache.set(key, render);
  if (cache.size <= MAX_CACHED_ANCHORS) return;
  const oldest = cache.keys().next();
  if (oldest.done !== true) cache.delete(oldest.value);
}
