import {
  applyTransform,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { transformSvgCurveSubpath, type SvgMatrix } from './svg-curve-transform';

export function svgNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Artwork contains a non-finite coordinate.');
  return String(Number(value.toFixed(6)));
}

export function xmlText(value: string): string {
  const valid = Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      );
    })
    .join('');
  return valid.replace(/[&<>"']/g, (char) => {
    const entities: Readonly<Record<string, string>> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char] ?? char;
  });
}

export function svgObjectMatrix(transform: Transform): SvgMatrix {
  const zero = applyTransform({ x: 0, y: 0 }, transform);
  const x = applyTransform({ x: 1, y: 0 }, transform);
  const y = applyTransform({ x: 0, y: 1 }, transform);
  return {
    a: x.x - zero.x,
    b: x.y - zero.y,
    c: y.x - zero.x,
    d: y.y - zero.y,
    e: zero.x,
    f: zero.y,
  };
}

export function svgMatrixAttribute(transform: Transform): string {
  const m = svgObjectMatrix(transform);
  return 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].map(svgNumber).join(' ') + ')';
}

export function worldSvgCurves(path: ColoredPath, transform: Transform): readonly CurveSubpath[] {
  const matrix = svgObjectMatrix(transform);
  return (path.curves ?? path.polylines.map(polylineToCurveSubpath)).map((curve) =>
    transformSvgCurveSubpath(curve, matrix),
  );
}

export function svgPathData(curves: readonly CurveSubpath[]): string {
  return curves
    .filter((curve) => curve.segments.length > 0)
    .map((curve) => {
      const parts = ['M ' + point(curve.start)];
      for (const segment of curve.segments) {
        switch (segment.kind) {
          case 'line':
            parts.push('L ' + point(segment.to));
            break;
          case 'cubic':
            parts.push(
              'C ' +
                point(segment.control1) +
                ' ' +
                point(segment.control2) +
                ' ' +
                point(segment.to),
            );
            break;
          case 'elliptical-arc':
            parts.push(
              'A ' +
                [
                  segment.radiusX,
                  segment.radiusY,
                  segment.rotationDeg,
                  Number(segment.largeArc),
                  Number(segment.sweep),
                ]
                  .map(svgNumber)
                  .join(' ') +
                ' ' +
                point(segment.to),
            );
            break;
        }
      }
      if (curve.closed) parts.push('Z');
      return parts.join(' ');
    })
    .join(' ');
}

export function* svgCurvePoints(curves: readonly CurveSubpath[]): Generator<Vec2> {
  for (const curve of curves) {
    yield curve.start;
    for (const segment of curve.segments) {
      if (segment.kind === 'cubic') {
        yield segment.control1;
        yield segment.control2;
      }
      yield segment.to;
    }
  }
}

function point(value: Vec2): string {
  return svgNumber(value.x) + ' ' + svgNumber(value.y);
}
