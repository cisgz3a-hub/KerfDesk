// LightBurn text options on rendered text: Bold, Italic, Upper Case, force
// right-to-left, Max Width (squeeze) and an undistorted Bend.
//
//   upper case and right-to-left change what is laid out, before rendering;
//   bold grows each outline by a share of the text size (round joins), so
//     the glyphs keep their shape but the outline becomes polylines;
//   italic slants by 12 degrees about the bottom of the text;
//   max width squeezes the text horizontally to fit, keeping its height;
//   an undistorted bend moves each glyph rigidly onto the arc instead of
//     bending its outline, so letters keep their shapes.
// Affine steps keep exact curves.

import { offsetClosedPolylinesWithRoundJoins } from '../geometry/kerf-offset';
import { bakeCurves } from '../geometry/shear-bake';
import type { AffineMatrix } from '../vector-export/affine-curves';
import {
  curveSubpathBounds,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type TextStyle,
  type Vec2,
} from '../scene';
import { bendTextRender, clampBend } from './text-bend';
import type { TextRenderResult } from './text-to-polylines';

const ITALIC_SLANT = Math.tan((12 * Math.PI) / 180);
const BOLD_SHARE = 0.03;
const RLE = '\u202b';
const PDF = '\u202c';

/** The content as it is laid out: upper case and forced right-to-left applied. */
export function styledTextContent(content: string, style: TextStyle | undefined): string {
  if (style === undefined) return content;
  const cased = style.uppercase === true ? content.toLocaleUpperCase() : content;
  return style.forceRtl === true
    ? cased
        .split('\n')
        .map((line) => (line === '' ? line : `${RLE}${line}${PDF}`))
        .join('\n')
    : cased;
}

/** Bold, max width and italic on rendered text (before any bend). */
export function styleTextRender(
  rendered: TextRenderResult,
  style: TextStyle | undefined,
  sizeMm: number,
): TextRenderResult {
  if (style === undefined) return rendered;
  let result = rendered;
  if (style.bold === true) result = emboldened(result, sizeMm * BOLD_SHARE);
  const width = result.bounds.maxX - result.bounds.minX;
  const max = style.maxWidthMm;
  if (max !== undefined && max > 0 && width > max) {
    const k = max / width;
    result = mapped(result, { a: k, b: 0, c: 0, d: 1, e: result.bounds.minX * (1 - k), f: 0 });
  }
  if (style.italic === true) {
    const base = result.bounds.maxY;
    result = mapped(result, { a: 1, b: 0, c: -ITALIC_SLANT, d: 1, e: ITALIC_SLANT * base, f: 0 });
  }
  return result;
}

function mapped(rendered: TextRenderResult, m: AffineMatrix): TextRenderResult {
  const point = (p: Vec2): Vec2 => ({
    x: m.a * p.x + m.c * p.y + m.e,
    y: m.b * p.x + m.d * p.y + m.f,
  });
  const paths = rendered.paths.map((path) => ({
    ...path,
    polylines: path.polylines.map((polyline) => ({
      ...polyline,
      points: polyline.points.map(point),
    })),
    ...(path.curves === undefined ? {} : { curves: bakeCurves(path.curves, m) }),
  }));
  return { ...rendered, paths, bounds: pathsBounds(paths) ?? rendered.bounds };
}

function emboldened(rendered: TextRenderResult, offsetMm: number): TextRenderResult {
  if (!(offsetMm > 0)) return rendered;
  const paths = rendered.paths.map((path): ColoredPath => {
    const closed = path.polylines.filter((polyline) => polyline.closed);
    if (closed.length === 0) return path;
    const grown = offsetClosedPolylinesWithRoundJoins(closed, offsetMm);
    const open = path.polylines.filter((polyline) => !polyline.closed);
    const { curves: _curves, ...rest } = path;
    return { ...rest, polylines: [...grown, ...open] };
  });
  return { ...rendered, paths, bounds: pathsBounds(paths) ?? rendered.bounds };
}

/** Styled text bent by `bendDeg`, distorting or rigid as the style asks. */
export function styledBentRender(
  rendered: TextRenderResult,
  text: { readonly bendDeg?: number; readonly textStyle?: TextStyle; readonly sizeMm: number },
): TextRenderResult {
  const styled = styleTextRender(rendered, text.textStyle, text.sizeMm);
  const bend = text.bendDeg ?? 0;
  return text.textStyle?.bendUndistorted === true
    ? bendTextUndistorted(styled, bend)
    : bendTextRender(styled, bend);
}

/**
 * Bend that keeps every glyph's shape: each cluster of overlapping contours
 * (a glyph with its dots and holes) turns and moves as one piece to where its
 * centre lands on the arc. Same arc as the distorting bend.
 */
export function bendTextUndistorted(rendered: TextRenderResult, bendDeg: number): TextRenderResult {
  const angle = (clampBend(bendDeg) * Math.PI) / 180;
  const { minX, maxX, minY, maxY } = rendered.bounds;
  if (Math.abs(angle) < 1e-9 || maxX - minX <= 0) return rendered;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radius = (maxX - minX) / angle;
  const pieces: ColoredPath[] = [];
  for (const path of rendered.paths) {
    const glyphs: ColoredPath[] = [];
    for (const cluster of glyphClusters(path)) {
      const box = cluster.box;
      const gx = (box.minX + box.maxX) / 2;
      const theta = (gx - centerX) / radius;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      // Rotate about the glyph's centre on the text's middle line, then carry
      // that point to the arc, as the distorting bend maps it.
      const target = {
        x: centerX + radius * Math.sin(theta),
        y: centerY + radius - radius * Math.cos(theta),
      };
      const m: AffineMatrix = {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: target.x - (cos * gx - sin * centerY),
        f: target.y - (sin * gx + cos * centerY),
      };
      glyphs.push(mappedPath(cluster.path, m));
    }
    pieces.push(mergedGlyphs(path, glyphs));
  }
  const bounds = pathsBounds(pieces) ?? rendered.bounds;
  const shift: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: -bounds.minX, f: -bounds.minY };
  const paths = pieces.map((path) => mappedPath(path, shift));
  return {
    paths,
    bounds: { minX: 0, minY: 0, maxX: bounds.maxX - bounds.minX, maxY: bounds.maxY - bounds.minY },
  };
}

// The glyphs of one path back together, so a text keeps one path per colour.
function mergedGlyphs(source: ColoredPath, glyphs: ReadonlyArray<ColoredPath>): ColoredPath {
  const polylines = glyphs.flatMap((glyph) => glyph.polylines);
  const curves = glyphs.flatMap((glyph) => glyph.curves ?? []);
  const { curves: _curves, ...rest } = source;
  return curves.length === polylines.length
    ? { ...rest, polylines, curves }
    : { ...rest, polylines };
}

function mappedPath(path: ColoredPath, m: AffineMatrix): ColoredPath {
  return mapped({ paths: [path], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }, m)
    .paths[0] as ColoredPath;
}

// Contours of one path grouped into glyphs: contours whose x-extents overlap
// belong together (a hole, the dot of an i). Curves and polylines pair by index.
function glyphClusters(
  path: ColoredPath,
): ReadonlyArray<{ readonly path: ColoredPath; readonly box: Bounds }> {
  const entries = path.polylines.map((polyline, index) => ({
    polyline,
    curve: path.curves?.[index],
    box: contourBox(polyline, path.curves?.[index]),
  }));
  const order = [...entries]
    .filter((entry) => entry.box !== null)
    .sort((p, q) => (p.box?.minX ?? 0) - (q.box?.minX ?? 0));
  const clusters: { entries: typeof entries; box: Bounds }[] = [];
  for (const entry of order) {
    const box = entry.box as Bounds;
    const last = clusters.at(-1);
    if (last !== undefined && box.minX < last.box.maxX) {
      last.entries.push(entry);
      last.box = union(last.box, box);
    } else {
      clusters.push({ entries: [entry], box });
    }
  }
  const curved = path.curves !== undefined && path.curves.length === path.polylines.length;
  const { curves: _curves, ...plain } = path;
  return clusters.map((cluster) => ({
    box: cluster.box,
    path: {
      ...plain,
      polylines: cluster.entries.map((entry) => entry.polyline),
      ...(curved ? { curves: cluster.entries.map((entry) => entry.curve as CurveSubpath) } : {}),
    },
  }));
}

function contourBox(polyline: Polyline, curve: CurveSubpath | undefined): Bounds | null {
  if (curve !== undefined) return curveSubpathBounds(curve);
  if (polyline.points.length === 0) return null;
  const xs = polyline.points.map((p) => p.x);
  const ys = polyline.points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function pathsBounds(paths: ReadonlyArray<ColoredPath>): Bounds | null {
  let box: Bounds | null = null;
  for (const path of paths) {
    const parts = path.curves ?? [];
    for (const curve of parts)
      box = box === null ? curveSubpathBounds(curve) : union(box, curveSubpathBounds(curve));
    if (parts.length > 0) continue;
    for (const polyline of path.polylines) {
      const next = contourBox(polyline, undefined);
      if (next !== null) box = box === null ? next : union(box, next);
    }
  }
  return box;
}
