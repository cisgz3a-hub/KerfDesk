import type { ColoredPath, StrokeTransform, Transform, Vec2 } from '../scene/scene-object';

export function materializedStrokeFields(
  path: ColoredPath,
  transform: Transform,
): Pick<ColoredPath, 'strokeWidthMm' | 'strokeTransform'> {
  if (path.strokeWidthMm === undefined) return {};
  const scale = Math.abs(transform.scaleX);
  if (path.strokeTransform === undefined && scale > 0 && scale === Math.abs(transform.scaleY)) {
    return { strokeWidthMm: path.strokeWidthMm * scale };
  }
  const angle = (transform.rotationDeg * Math.PI) / 180;
  const xScale = transform.scaleX * (transform.mirrorX ? -1 : 1);
  const yScale = transform.scaleY * (transform.mirrorY ? -1 : 1);
  const outer = {
    a: Math.cos(angle) * xScale,
    b: Math.sin(angle) * xScale,
    c: -Math.sin(angle) * yScale,
    d: Math.cos(angle) * yScale,
  };
  const inner = path.strokeTransform ?? { a: 1, b: 0, c: 0, d: 1 };
  return {
    strokeWidthMm: path.strokeWidthMm,
    strokeTransform: {
      a: 0 + outer.a * inner.a + outer.c * inner.b,
      b: 0 + outer.b * inner.a + outer.d * inner.b,
      c: 0 + outer.a * inner.c + outer.c * inner.d,
      d: 0 + outer.b * inner.c + outer.d * inner.d,
    },
  };
}

export function applyStrokeTransform(point: Vec2, transform: StrokeTransform): Vec2 {
  return {
    x: transform.a * point.x + transform.c * point.y,
    y: transform.b * point.x + transform.d * point.y,
  };
}

export function inverseStrokeTransform(transform: StrokeTransform): StrokeTransform | null {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (determinant === 0 || !Number.isFinite(determinant)) return null;
  const inverse = {
    a: transform.d / determinant,
    b: -transform.b / determinant,
    c: -transform.c / determinant,
    d: transform.a / determinant,
  };
  return Object.values(inverse).every(Number.isFinite) ? inverse : null;
}
