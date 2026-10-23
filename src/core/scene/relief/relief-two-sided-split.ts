/**
 * What a two-sided split planned a side relief for (ADR-580 Amendment 1). The
 * side's mesh carries its stock-face frame for `stockThicknessMm`; relief CAM
 * re-plans the side for the current stock from this record, so a later stock
 * edit keeps the model centred and the holding web as split.
 */
export type ReliefTwoSidedSplitRecord = {
  readonly side: 'A' | 'B';
  /** The stock thickness the mesh's frame was planned for, in mm (never below the model). */
  readonly stockThicknessMm: number;
  /** The model's own height, the finished part's thickness, in mm. */
  readonly modelDepthMm: number;
  /** The split plane's height above the model's lowest point, in mm. */
  readonly splitHeightMm: number;
  /** The holding web left between the two floors, in mm. */
  readonly webMm: number;
};
