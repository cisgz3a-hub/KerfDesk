// Compact, exact SVG path data for vector export (ADR-403).
//
// Two encodings:
//   * full precision (grid === null): absolute commands, every coordinate
//     printed with String(value) — the historical exporter's exact form.
//   * grid (a power-of-ten step): every line/cubic coordinate is snapped to
//     the grid once, then written as RELATIVE integer grid differences
//     (l/h/v/c/m). Differences of integers are exact, so relative commands
//     cannot accumulate rounding drift, and the written point is exactly the
//     snapped point.
//
// A subpath that contains an elliptical arc is always written absolute at
// full precision: an arc's centre is ill-conditioned when its radii are close
// to half the chord, so a micrometre endpoint move could shift the drawn arc
// far more than the requested precision.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import type { CurveSubpath, PathSegment, Vec2 } from '../scene/scene-object';
import { formatGridIndex, gridIndex, snapToGrid, type DecimalGrid } from './decimal-grid';

type GridPoint = { readonly x: number; readonly y: number };

/** Snap every line/cubic coordinate of arc-free subpaths onto `grid`. */
export function quantizeCurves(
  curves: ReadonlyArray<CurveSubpath>,
  grid: DecimalGrid | null,
): CurveSubpath[] {
  if (grid === null) return [...curves];
  return curves.map((curve) => (hasArc(curve) ? curve : quantizeCurve(curve, grid)));
}

export function formatSvgPathData(
  curves: ReadonlyArray<CurveSubpath>,
  grid: DecimalGrid | null,
): string {
  const writer = new PathWriter();
  let cursor: GridPoint | null = null;
  for (const curve of curves) {
    if (curve.segments.length === 0) continue;
    if (grid === null || hasArc(curve)) {
      writeAbsolute(writer, curve);
      cursor = null;
    } else {
      cursor = writeRelative(writer, curve, grid, cursor);
    }
  }
  return writer.text();
}

function hasArc(curve: CurveSubpath): boolean {
  return curve.segments.some((segment) => segment.kind === 'elliptical-arc');
}

function quantizeCurve(curve: CurveSubpath, grid: DecimalGrid): CurveSubpath {
  const snap = (p: Vec2): Vec2 => ({ x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) });
  return {
    start: snap(curve.start),
    closed: curve.closed,
    segments: curve.segments.map((segment): PathSegment => {
      if (segment.kind === 'cubic') {
        return {
          kind: 'cubic',
          control1: snap(segment.control1),
          control2: snap(segment.control2),
          to: snap(segment.to),
        };
      }
      return { ...segment, to: snap(segment.to) };
    }),
  };
}

function writeAbsolute(writer: PathWriter, curve: CurveSubpath): void {
  writer.command('M', [curve.start.x, curve.start.y].map(exactNumber));
  for (const segment of curve.segments) {
    if (segment.kind === 'line') writer.command('L', pointText(segment.to));
    else if (segment.kind === 'cubic') {
      writer.command('C', [
        ...pointText(segment.control1),
        ...pointText(segment.control2),
        ...pointText(segment.to),
      ]);
    } else {
      writer.command('A', [
        exactNumber(segment.radiusX),
        exactNumber(segment.radiusY),
        exactNumber(segment.rotationDeg),
        segment.largeArc ? '1' : '0',
        segment.sweep ? '1' : '0',
        ...pointText(segment.to),
      ]);
    }
  }
  if (curve.closed) writer.close();
}

function writeRelative(
  writer: PathWriter,
  curve: CurveSubpath,
  grid: DecimalGrid,
  cursor: GridPoint | null,
): GridPoint {
  const index = (p: Vec2): GridPoint => ({ x: gridIndex(p.x, grid), y: gridIndex(p.y, grid) });
  const text = (value: number): string => formatGridIndex(value, grid);
  const start = index(curve.start);
  if (cursor === null) writer.command('M', [text(start.x), text(start.y)]);
  else writer.command('m', [text(start.x - cursor.x), text(start.y - cursor.y)]);
  let current = start;
  const last = curve.segments.length - 1;
  curve.segments.forEach((segment, i) => {
    const to = index(segment.to);
    // `z` draws the closing straight edge itself.
    const closingLine =
      curve.closed && i === last && segment.kind === 'line' && samePoint(to, start);
    if (closingLine) return;
    if (segment.kind === 'cubic') {
      const c1 = index(segment.control1);
      const c2 = index(segment.control2);
      writer.command(
        'c',
        [c1.x, c1.y, c2.x, c2.y, to.x, to.y].map((v, k) =>
          text(v - (k % 2 === 0 ? current.x : current.y)),
        ),
      );
    } else if (to.y === current.y && to.x !== current.x) {
      writer.command('h', [text(to.x - current.x)]);
    } else if (to.x === current.x && to.y !== current.y) {
      writer.command('v', [text(to.y - current.y)]);
    } else {
      writer.command('l', [text(to.x - current.x), text(to.y - current.y)]);
    }
    current = to;
  });
  if (!curve.closed) return current;
  writer.close();
  return start;
}

function samePoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function pointText(p: Vec2): string[] {
  return [exactNumber(p.x), exactNumber(p.y)];
}

function exactNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Artwork contains a non-finite coordinate.');
  return String(value);
}

/**
 * Emits command letters only when they change (SVG repeats the previous
 * command for extra argument groups) and drops separators the grammar does
 * not need: before a minus sign and a leading zero before a decimal point.
 * The ".5.5" concatenation trick is deliberately not used; some importers
 * mis-read it.
 */
class PathWriter {
  private readonly parts: string[] = [];
  private previous = '';
  private needsSeparator = false;

  command(letter: string, args: ReadonlyArray<string>): void {
    // After M/m, SVG treats extra pairs as L/l, so the letter must repeat.
    if (letter !== this.previous || letter === 'M' || letter === 'm') {
      this.parts.push(letter);
      this.previous = letter;
      this.needsSeparator = false;
    }
    for (const arg of args) this.number(arg);
  }

  close(): void {
    this.parts.push('z');
    this.previous = 'z';
    this.needsSeparator = false;
  }

  text(): string {
    return this.parts.join('');
  }

  private number(raw: string): void {
    const value = raw.startsWith('0.')
      ? raw.slice(1)
      : raw.startsWith('-0.')
        ? '-' + raw.slice(2)
        : raw;
    if (this.needsSeparator && !value.startsWith('-')) this.parts.push(' ');
    this.parts.push(value);
    this.needsSeparator = true;
  }
}
