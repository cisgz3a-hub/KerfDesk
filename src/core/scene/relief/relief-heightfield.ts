export type ReliefHeightfieldSourceKind =
  | 'depth-map'
  | 'brightness-emboss'
  | 'relative-depth-map'
  | 'editable-relief-map'
  | 'stl-top-projection';

export type ReliefHeightfieldMask = {
  readonly encoding: 'u8-base64-v1';
  readonly samplesBase64: string;
};

export type ReliefHeightfieldMapping = {
  readonly polarity: 'light-is-high' | 'light-is-deep';
  readonly inputLowCode: number;
  readonly inputHighCode: number;
  readonly curve: {
    readonly kind: 'gamma-v1';
    readonly gamma: number;
  };
  readonly maxDepthMm: number;
  readonly crop: {
    readonly kind: 'normalized-v1';
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Import/editor policy already resolved into physical dimensions and crop. */
  readonly aspect: 'preserve' | 'stretch';
  readonly inclusionThreshold: number;
  readonly outsideMask: 'stock-top' | 'relief-floor' | 'excluded';
};

export type ReliefHeightfieldProvenance = {
  readonly sourceKind: ReliefHeightfieldSourceKind;
  readonly sourceName: string;
  readonly sourceBitDepth?: 8 | 16;
  readonly sourcePolarity?: 'light-is-high' | 'light-is-deep';
  readonly producer?: {
    readonly name: string;
    readonly model?: string;
    readonly version?: string;
  };
};

/** Versioned durable scalar source for one-sided top-down reliefs (ADR-291). */
export type ReliefHeightfield = {
  readonly kind: 'heightfield-v1';
  readonly schemaVersion: 1;
  readonly width: number;
  readonly height: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly encoding: 'u16le-base64-v1';
  readonly samplesBase64: string;
  readonly inclusionMask?: ReliefHeightfieldMask;
  readonly mapping: ReliefHeightfieldMapping;
  readonly provenance: ReliefHeightfieldProvenance;
  readonly algorithmRevision: 'heightfield-map-v1';
  readonly revision: number;
  readonly digest: `sha256:${string}`;
};
