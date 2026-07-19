// Display-only provenance for CNC feed / plunge / spindle / depth-per-pass
// values. Numeric layer settings remain the compile source of truth.

export type CncFeedSource =
  | {
      readonly kind: 'machine-starter';
      readonly starterId: string;
      readonly revision: number;
    }
  | {
      readonly kind: 'material-recipe';
      readonly materialKey: string;
      readonly fluteCount: number;
    };
