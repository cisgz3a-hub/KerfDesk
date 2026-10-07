import type { ArraySpec } from './array-layout-types';

export type RetainedArrayInstance = {
  readonly id: string;
  readonly sourceToObject: Readonly<Record<string, string>>;
};
export type RetainedArrayLayout = {
  readonly id: string;
  readonly name: string;
  readonly spec: ArraySpec;
  readonly sourceIds: readonly string[];
  readonly instances: readonly RetainedArrayInstance[];
  /** Dependencies shared with other artwork are excluded from destructive replacement. */
  readonly ownedObjectIds: readonly string[];
  readonly sourceProjectJson: string;
  readonly baselineProjectJson: string;
  readonly evaluationTime?: string;
  /** False fixes every copy to the same allocated value; absent retains legacy sequenced mode. */
  readonly advanceVariables?: boolean;
};
