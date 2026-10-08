export type SketchValue = number | { readonly parameter: string };
export type NamedSketchParameter = {
  readonly name: string;
  readonly unit: 'mm' | 'deg' | 'scalar';
  readonly value: number | string;
};
export type SketchConstraint =
  | {
      readonly id: string;
      readonly kind: 'x' | 'y';
      readonly pointId: string;
      readonly value: SketchValue;
    }
  | {
      readonly id: string;
      readonly kind: 'coincident';
      readonly first: string;
      readonly second: string;
    }
  | { readonly id: string; readonly kind: 'horizontal' | 'vertical'; readonly lineId: string }
  | {
      readonly id: string;
      readonly kind: 'distance';
      readonly first: string;
      readonly second: string;
      readonly value: SketchValue;
    }
  | {
      readonly id: string;
      readonly kind: 'equal';
      readonly firstLineId: string;
      readonly secondLineId: string;
    }
  | {
      readonly id: string;
      readonly kind: 'diameter';
      readonly circleId: string;
      readonly value: SketchValue;
    };
/** Local mm; materialized paths remain the ordinary output authority. */
export type ConstrainedSketch2d = {
  readonly version: 1;
  readonly name: string;
  readonly parameters: ReadonlyArray<NamedSketchParameter>;
  readonly points: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>;
  readonly lines: ReadonlyArray<{
    readonly id: string;
    readonly first: string;
    readonly second: string;
  }>;
  readonly circles: ReadonlyArray<{
    readonly id: string;
    readonly centre: string;
    readonly radiusMm: number;
  }>;
  readonly profiles: ReadonlyArray<{
    readonly id: string;
    readonly pointIds: ReadonlyArray<string>;
    readonly closed: boolean;
  }>;
  readonly constraints: ReadonlyArray<SketchConstraint>;
};
export type SketchSolveResult =
  | { readonly kind: 'invalid'; readonly reason: string }
  | {
      readonly kind: 'solved';
      readonly status: 'under-constrained' | 'fully-constrained' | 'over-constrained';
      readonly sketch: ConstrainedSketch2d;
      readonly degreesOfFreedom: number;
      readonly redundantEquations: number;
      readonly maximumResidualMm: number;
      readonly conflicts: ReadonlyArray<{
        readonly constraintId: string;
        readonly residualMm: number;
      }>;
    };
