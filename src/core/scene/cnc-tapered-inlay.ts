/** Linked pocket/plug intent. Depths are positive below their stated starting planes. */
export type CncTaperedInlaySettings = {
  readonly kind: 'tapered-v';
  readonly pocketStartDepthMm: number;
  readonly plugStartDepthMm: number;
  readonly pocketDepthMm: number;
  readonly engagementDepthMm: number;
  readonly glueGapMm: number;
  readonly surfaceClearanceMm: number;
  readonly fitClearanceMm: number;
  readonly pairSpacingMm: number;
  readonly plugBorderMm: number;
};

export const DEFAULT_CNC_TAPERED_INLAY: CncTaperedInlaySettings = {
  kind: 'tapered-v',
  pocketStartDepthMm: 0,
  plugStartDepthMm: 0,
  pocketDepthMm: 3,
  engagementDepthMm: 2.5,
  glueGapMm: 0.5,
  surfaceClearanceMm: 1,
  fitClearanceMm: 0.05,
  pairSpacingMm: 10,
  plugBorderMm: 10,
};
