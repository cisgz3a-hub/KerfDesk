// The AppCommandContext slice for Warp and Deform (LightBurn gap LBG-T06),
// joined into the batch 5 slice in design-tools-command-types.ts.

export type WarpDeformCommandContext = {
  /** The selection holds unlocked vector artwork the tools can bend. */
  readonly canWarpSelection: boolean;
  readonly warpToolActive: boolean;
  readonly deformToolActive: boolean;
  readonly startWarp: () => void;
  readonly startDeform: () => void;
};

export type WarpDeformCommandId = 'tools.warp' | 'tools.deform';
