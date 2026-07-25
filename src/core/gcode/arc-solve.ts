// Shared G2/G3 arc-center and sweep math (ADR-255 stage 1). Pure geometry
// only: validity POLICY deliberately stays with each caller — the simulator
// parser reports error strings, the motion manifest drops the block — so both
// keep their exact pre-refactor behavior.

const FULL_TURN = Math.PI * 2;

/** Chord-degeneracy epsilon both parsers already used (1e-9). */
export const ARC_EPSILON = 1e-9;

export type XyPoint = {
  readonly x: number;
  readonly y: number;
};

// I/J are ALWAYS incremental offsets from the current point in GRBL.
export function ijArcCenter(
  from: XyPoint,
  i: number | undefined,
  j: number | undefined,
  unitScale: number,
): XyPoint {
  return { x: from.x + (i ?? 0) * unitScale, y: from.y + (j ?? 0) * unitScale };
}

export type RArcGeometry = {
  readonly center: XyPoint;
  readonly radiusMm: number;
  readonly chordMm: number;
  /**
   * radius² − (chord/2)² BEFORE clamping. Negative when the commanded radius
   * cannot span the chord; each caller applies its own tolerance to this.
   */
  readonly halfChordGapSq: number;
};

/**
 * Solves the R-form center on the spec side: positive R asks for the minor
 * (≤180°) arc, negative R for the major arc. Returns null only for a
 * zero-length chord (start == end), which the R form cannot express — the
 * caller decides whether that is an error or a dropped block. A too-small
 * radius still solves (height clamped to 0) so the caller can apply its own
 * tolerance to `halfChordGapSq`.
 */
export function rArcGeometry(
  from: XyPoint,
  to: XyPoint,
  r: number,
  clockwise: boolean,
  unitScale: number,
): RArcGeometry | null {
  const radiusMm = Math.abs(r) * unitScale;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chordMm = Math.hypot(dx, dy);
  if (chordMm <= ARC_EPSILON) return null;
  const halfChordGapSq = radiusMm * radiusMm - (chordMm / 2) * (chordMm / 2);
  const h = Math.sqrt(Math.max(0, halfChordGapSq));
  // The center sits on the chord's left normal (-dy, dx) for a CCW minor arc
  // and on the right for a CW minor arc; the major arc flips the side.
  const wantMinor = r >= 0;
  const side = (clockwise ? -1 : 1) * (wantMinor ? 1 : -1);
  return {
    center: {
      x: from.x + dx / 2 + side * (-dy / chordMm) * h,
      y: from.y + dy / 2 + side * (dx / chordMm) * h,
    },
    radiusMm,
    chordMm,
    halfChordGapSq,
  };
}

/**
 * Signed sweep from start to end angle: negative for clockwise, positive for
 * counter-clockwise, a full ±2π when the caller judged the endpoints
 * coincident (G-code's full-circle form). The same-point predicate stays with
 * the caller — the two parsers use slightly different epsilon geometry and
 * this stage changes no behavior.
 */
export function arcSweepAngle(
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
  samePoint: boolean,
): number {
  if (samePoint) return clockwise ? -FULL_TURN : FULL_TURN;
  let sweep = endAngle - startAngle;
  if (clockwise) {
    while (sweep >= 0) sweep -= FULL_TURN;
  } else {
    while (sweep <= 0) sweep += FULL_TURN;
  }
  return sweep;
}
