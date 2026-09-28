// The Array command's requests and the placements they produce (ADR-307).
// Every field added after the first release is optional: leaving it out gives
// the layout the dialog made before it existed.

/** Which ways a copy is mirrored: left to right, top to bottom, or both. */
export type ArrayMirrorAxes = 'none' | 'horizontal' | 'vertical' | 'both';

export type GridArraySpec = {
  readonly kind: 'grid';
  readonly rows: number;
  readonly columns: number;
  /** Across: the gap between copies' edges, or with `spaceBy: 'centres'` between their centres. */
  readonly spacingX: number;
  /** Down: the gap between copies' edges, or with `spaceBy: 'centres'` between their centres. */
  readonly spacingY: number;
  /** How the spacing is measured. Absent means the gap between edges. */
  readonly spaceBy?: 'gap' | 'centres';
  /** Every other row (the 2nd, 4th, ...) moves this far right; negative moves it left. */
  readonly rowShift?: number;
  /** Every other column (the 2nd, 4th, ...) moves this far down; negative moves it up. */
  readonly columnShift?: number;
  /** Build the columns leftward from the original instead of rightward. */
  readonly reverseColumns?: boolean;
  /** Build the rows upward from the original instead of downward. */
  readonly reverseRows?: boolean;
  /** Mirror every other column (the 2nd, 4th, ...). */
  readonly mirrorColumns?: ArrayMirrorAxes;
  /** Mirror every other row (the 2nd, 4th, ...). A copy in both is mirrored by each. */
  readonly mirrorRows?: ArrayMirrorAxes;
};

/** Part of a circle: up to an end angle, or a set angle between neighbouring copies. */
export type CircularArcSpec =
  | { readonly kind: 'end'; readonly endAngleDeg: number }
  | { readonly kind: 'step'; readonly stepAngleDeg: number };

export type CircularArraySpec = {
  readonly kind: 'circular';
  readonly count: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly rotateCopies: boolean;
  /** Absent spreads the copies evenly all the way round. */
  readonly arc?: CircularArcSpec;
  /**
   * A selected object the circle is centred on. It stays where it is and is
   * not copied; `centerX`/`centerY` carry its centre.
   */
  readonly centerObjectId?: string;
};

export type PointRotationArraySpec = {
  readonly kind: 'point-rotation';
  readonly count: number;
  readonly totalAngleDeg: number;
};

export type ArraySpec = GridArraySpec | CircularArraySpec | PointRotationArraySpec;

export type ArrayPlacementMirror = {
  readonly horizontal: boolean;
  readonly vertical: boolean;
  /** Scene-space point the source is mirrored about: the source selection's centre. */
  readonly center: { readonly x: number; readonly y: number };
};

export type ArrayPlacement = {
  readonly dx: number;
  readonly dy: number;
  readonly rotationDeg: number;
  // Scene-space point the copy rotates about. Circular arrays use the
  // destination ring point; Point Rotation uses the combined selection centre.
  // Present only when rotationDeg is non-zero.
  readonly pivot?: { readonly x: number; readonly y: number };
  /** Mirror the source before it moves. Present only when the copy is mirrored. */
  readonly mirror?: ArrayPlacementMirror;
};
