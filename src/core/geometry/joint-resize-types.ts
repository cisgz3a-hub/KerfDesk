import type { ImportedSvg, TracedImage, Vec2 } from '../scene';

/** A bounded design edit, never a material-fit or machine qualification claim (ADR-570). */
export type JointResizeRequest = {
  readonly currentWidthMm: number;
  readonly materialThicknessMm: number;
  /** Positive widens a receiving opening, negative tightens it. No tool/kerf compensation. */
  readonly fitAllowanceMm: number;
  readonly detectionToleranceMm: number;
};
export type JointResizeObject = ImportedSvg | TracedImage;
export type JointCandidate = {
  readonly id: string;
  readonly objectId: string;
  readonly pathIndex: number;
  readonly contourIndex: number;
  readonly kind: 'enclosed-rectangle' | 'inward-slot';
  readonly widthMm: number;
  readonly depthMm: number;
  readonly centre: Vec2;
  readonly direction: Vec2;
  readonly shifts: ReadonlyArray<{ readonly vertex: number; readonly sign: -1 | 1 }>;
};
export type JointResizeAnalysis = {
  readonly candidates: ReadonlyArray<JointCandidate>;
  readonly notices: ReadonlyArray<string>;
  readonly targetWidthMm: number;
};
export type Failure = { readonly message: string };
export type Contour = {
  readonly pathIndex: number;
  readonly contourIndex: number;
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};
export type Geometry = {
  readonly object: JointResizeObject;
  readonly contours: ReadonlyArray<Contour>;
};
export type Extraction = {
  readonly geometries: ReadonlyArray<Geometry>;
  readonly notices: ReadonlyArray<string>;
};
