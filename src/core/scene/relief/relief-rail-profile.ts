import type { Transform, Vec2 } from '../scene-object';
export type ReliefOpenRail = {
  readonly points: ReadonlyArray<Vec2>;
  readonly linkedObjectId?: string;
  readonly linkComponentTransform?: Transform;
  readonly reversed?: boolean;
};
/** A graph across the rail width: x is normalized [0,1], y is height above floor in mm. */
export type ReliefProfileSection = {
  readonly id: string;
  readonly position: number;
  readonly widthScale: number;
  readonly profile: ReadonlyArray<Vec2>;
};
export type ReliefRailProfileSource = {
  readonly kind: 'rail-profile-v1';
  /** Single rail is the centreline; with a second rail these are the two sides. */
  readonly rail: ReliefOpenRail;
  readonly secondRail?: ReliefOpenRail;
  readonly widthMm: number;
  readonly samplingSteps: number;
  readonly sections: ReadonlyArray<ReliefProfileSection>;
};
