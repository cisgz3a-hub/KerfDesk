// The AppCommandContext slice for Trim Shapes and Cut Shapes (LightBurn gap
// LBG-T04 and LBG-T08), joined into the batch 5 slice from
// design-tools-command-types.ts so the shared context files stay as they are.

export type VectorCutCommandContext = {
  /** Trim Shapes is the active canvas tool. */
  readonly trimShapesActive: boolean;
  /** Turn Trim Shapes on, or off again when it is on. */
  readonly trimShapes: () => void;
  readonly cutShapes: () => void;
};

export type VectorCutCommandId = 'tools.trim-shapes' | 'tools.cut-shapes';
