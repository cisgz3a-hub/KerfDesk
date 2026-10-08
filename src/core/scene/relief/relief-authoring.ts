import type { ReliefRailProfileSource } from './relief-rail-profile';
import type { Polyline, Transform, Vec2 } from '../scene-object';
import type { ReliefHeightfield } from './relief-heightfield';

export type ReliefCombineMode = 'add' | 'subtract' | 'max' | 'min' | 'replace';

/** Even-odd closed rings in component-local mm. An empty mask covers nothing. */
export type ReliefVectorMask = {
  readonly rings: ReadonlyArray<Polyline>;
  readonly linkedObjectId?: string;
  /** Component frame captured when linked; later component placement stays additive. */
  readonly linkComponentTransform?: Transform;
};

export type ReliefShapeSource = {
  readonly kind: 'vector-shape-v1';
  readonly boundary: ReliefVectorMask;
  readonly profile: 'plane' | 'dome' | 'slope';
  /** Peak height above the component's base. Never a solid or an undercut. */
  readonly heightMm: number;
  /** Slope direction in local XY; min projection is zero, max is heightMm. */
  readonly angleDeg: number;
};

export type ReliefComponentSource =
  | { readonly kind: 'retained-field-v1'; readonly field: ReliefHeightfield }
  | ReliefShapeSource
  | ReliefRailProfileSource;

export type ReliefSculptStroke = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly componentId: string;
  readonly mode: 'add' | 'remove' | 'smooth' | 'flatten';
  /** Stroke centres in document-local millimetres. */
  readonly points: ReadonlyArray<Vec2>;
  readonly diameterMm: number;
  /** Captured artwork XY scale makes brush diameter physical at stroke time. */
  readonly metricScaleX?: number;
  readonly metricScaleY?: number;
  /** Add/remove amount in mm per dab; smooth/flatten blend in [0,1]. */
  readonly strength: number;
  readonly flattenHeightMm: number;
  /** Optional stroke region in document-local mm, intersected with component coverage. */
  readonly region?: ReliefVectorMask;
};

export type ReliefComponent = {
  readonly id: string;
  readonly name: string;
  readonly levelId: string;
  readonly visible: boolean;
  readonly combineMode: ReliefCombineMode;
  readonly transform: Transform;
  readonly baseHeightMm: number;
  readonly heightScale: number;
  readonly source: ReliefComponentSource;
  readonly mask?: ReliefVectorMask;
};

export type ReliefLevel = {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  /** Level-local clip in document coordinates. */
  readonly mask?: ReliefVectorMask;
};

/** Retained intent. The owning reliefSource is its materialised CAM authority. */
export type ReliefAuthoringDocument = {
  readonly schemaVersion: 1;
  readonly algorithmRevision: 'retained-relief-v1';
  readonly revision: number;
  readonly width: number;
  readonly height: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly maxDepthMm: number;
  /** Composition starts here, measured above the relief floor; stock top is maxDepthMm. */
  readonly baselineHeightMm: number;
  readonly outsideMask: 'stock-top' | 'relief-floor' | 'excluded';
  readonly levels: ReadonlyArray<ReliefLevel>;
  /** Compose in level order, then component array order within each level. */
  readonly components: ReadonlyArray<ReliefComponent>;
  readonly strokes: ReadonlyArray<ReliefSculptStroke>;
  readonly clip?: ReliefVectorMask;
};

export const RELIEF_AUTHORING_MAX_CELLS = 1_048_576;
export const RELIEF_AUTHORING_MAX_COMPONENTS = 64;
export const RELIEF_AUTHORING_MAX_STROKES = 2048;
export const RELIEF_AUTHORING_MAX_WORK = 32_000_000;
