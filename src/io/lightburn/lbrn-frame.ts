import type { CurveSubpath, Vec2 } from '../../core/scene';

// LightBurn <XForm> order: x' = a·x + c·y + e, y' = b·x + d·y + f.
export type LbrnMatrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export const IDENTITY_MATRIX: LbrnMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export type LbrnBed = { readonly width: number; readonly height: number };

/**
 * Maps LightBurn project coordinates onto KerfDesk's scene (ADR-388).
 *
 * LightBurn saves coordinates in the saving machine's own frame: millimetres
 * from its origin corner, +X away from that corner along the bed width, +Y
 * away from it along the depth. The project root's MirrorX / MirrorY say which
 * corner that was: MirrorX puts the origin on the right, MirrorY at the rear.
 * No flags is a front-left origin with Y pointing to the rear, the usual diode
 * and GRBL case. LightBurn draws its workspace from above with the rear at the
 * top, and so does KerfDesk (scene +Y points toward the operator, origin at the
 * rear-left of the bed), so the project lands on the bed exactly as LightBurn
 * showed it: same corner distances, text reading the same way round.
 */
export function lightBurnSceneFrame(root: Element, bed: LbrnBed): LbrnMatrix {
  const originRight = flag(root.getAttribute('MirrorX'));
  const originRear = flag(root.getAttribute('MirrorY'));
  return {
    a: originRight ? -1 : 1,
    b: 0,
    c: 0,
    d: originRear ? 1 : -1,
    e: originRight ? bed.width : 0,
    f: originRear ? 0 : bed.height,
  };
}

function flag(value: string | null): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1';
}

export function parseXFormText(text: string | null | undefined): LbrnMatrix {
  const values = (text ?? '').trim().split(/\s+/).map(Number);
  if (values.length !== 6 || !values.every(Number.isFinite)) return IDENTITY_MATRIX;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values;
  return { a, b, c, d, e, f };
}

export function multiplyMatrix(left: LbrnMatrix, right: LbrnMatrix): LbrnMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function applyMatrix(matrix: LbrnMatrix, point: Vec2): Vec2 {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

// The LightBurn importer only builds lines and cubics, which stay exact under
// any affine map, the frame's mirrors included.
export function transformCurve(curve: CurveSubpath, matrix: LbrnMatrix): CurveSubpath {
  const point = (value: Vec2): Vec2 => applyMatrix(matrix, value);
  return {
    ...curve,
    start: point(curve.start),
    segments: curve.segments.map((segment) =>
      segment.kind === 'cubic'
        ? {
            ...segment,
            control1: point(segment.control1),
            control2: point(segment.control2),
            to: point(segment.to),
          }
        : { ...segment, to: point(segment.to) },
    ),
  };
}
