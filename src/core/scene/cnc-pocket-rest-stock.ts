/** Predicted 2D stock is bound to the named generated rough stage, never measured machine stock. */
export type CncPocketRestStockSettings = {
  readonly kind: 'rough-stage-stock';
  readonly previousToolId: string;
  readonly previousToolDiameterMm: number;
  readonly toleranceMm: number;
};
