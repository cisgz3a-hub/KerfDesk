import type { CncToolKind } from '../scene';

/** Materialized planning grid and finishing geometry for one relief source. */
export type CncReliefPlanningEvidence = {
  readonly layerId: string;
  /** Projection target identity in the actual ordered job, independent of display filenames. */
  readonly targetObjectId?: string;
  readonly source: string;
  readonly stage: 'roughing' | 'finishing' | 'rest-finishing' | 'projection';
  readonly predecessorToolId?: string;
  readonly targetRevision?: number;
  readonly residualThresholdMm?: number;
  readonly maximumResidualMm?: number;
  readonly selectedCells?: number;
  readonly restFallbackReason?: string;
  readonly verticalDepthMm?: number;
  readonly requestedSampleSpacingMm?: number;
  // Projection only (rolling audit v11 W6-P2-1): the step-down levels, deepest
  // tip and tabs the compiled passes really carry, for Job Review.
  readonly projection?: {
    readonly levels: number;
    readonly deepestMm: number;
    readonly closedShapes: number;
    readonly tabbedShapes: number;
    readonly freedShapes: number;
  };
  // Roughing only (W6-P2-2): area of the relief the roughing bit left more
  // than one depth per pass above the finished surface, in mm².
  readonly roughingMissedAreaMm2?: number;
  // Roughing only: the reach check exceeded its work budget and did not run.
  readonly roughingReachUnchecked?: true;
  // Finishing only (W6-P2-2): step-down levels the finishing bit cut where
  // roughing did not reach, before its finishing pass.
  readonly finishingStepLevels?: number;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSizeMm: number;
  readonly toolDiameterMm: number;
  readonly toolKind: CncToolKind;
  // Tapered ball nose only: the tip ball whose radius bounds the scallop.
  readonly toolTipDiameterMm?: number;
  readonly rowSpacingMm?: number;
  readonly scallopMm?: number;
};
