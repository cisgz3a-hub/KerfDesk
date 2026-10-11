import type { Sketch } from './sketch-entity';

/** Editable authoring source; generated scene artwork remains the output authority. */
export type DesignStudioDocument = {
  readonly version: 1;
  readonly sketch: Sketch;
  readonly activeLayerId: string;
  readonly surface3d: boolean;
  readonly appliedObjectIds: readonly string[];
  readonly appliedOperationsByLayer: readonly (readonly [string, string])[];
  readonly appliedEntityObjectIds: readonly (readonly [string, string])[];
};

export type DesignStudioView = Pick<DesignStudioDocument, 'activeLayerId' | 'surface3d'>;
