export type TextAlignment = 'left' | 'center' | 'right';

// The string-keyed font identifier. Concrete keys are enumerated in
// core/text/font-registry.ts; this module stays unaware of which
// fonts are bundled (so adding a font doesn't ripple here).
export type FontKey = string;

// Where the text sits along the guide (measured from the guide's start, or
// from its end for 'end') and across it. Absent means 'start' and 'above',
// the placement every path text had before ADR-480.
export type PathTextAlongAlign = 'start' | 'middle' | 'end';
export type PathTextAcrossAlign = 'above' | 'center' | 'below';

export type PathTextSettings = {
  readonly guideObjectId: string;
  readonly offsetMm: number;
  readonly reverse: boolean;
  readonly alongAlign?: PathTextAlongAlign;
  readonly acrossAlign?: PathTextAcrossAlign;
};

export type TextStyle = {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly uppercase?: boolean;
  readonly forceRtl?: boolean;
  /** Squeeze wider text horizontally to this width; height is kept. */
  readonly maxWidthMm?: number;
  /** Bend moves glyphs rigidly instead of bending their outlines. */
  readonly bendUndistorted?: boolean;
};
