// The AppCommandContext slice for Optimize Shapes (LightBurn gap LBG-T22),
// joined into the batch 5 slice in design-tools-command-types.ts.

export type OptimizeShapesCommandContext = {
  /** Opens the Optimize Shapes dialog, or says what the selection is missing. */
  readonly optimizeShapes: () => void;
};

export type OptimizeShapesCommandId = 'tools.optimize-shapes';
