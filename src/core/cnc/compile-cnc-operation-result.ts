import type { CncOpenContourOmissions } from './cnc-open-contour-omissions';
import type {
  CncProfileOpenPaths,
  CncStackedCopyMerge,
  CncStrategyFallback,
  CncTabHoldShape,
} from '../job/cnc-compilation-sidecar-types';
import type {
  CncGroup,
  CncOffsetLadderCompilationEvidence,
  CncReliefPlanningEvidence,
  CncStepoverCompilationEvidence,
} from '../job/job';
export type CompiledCncOperation = {
  readonly openContourOmissions: CncOpenContourOmissions;
  readonly profileOpenPaths: ReadonlyArray<CncProfileOpenPaths>;
  readonly stackedCopyMerges: ReadonlyArray<CncStackedCopyMerge>;
  readonly kind: 'compiled';
  readonly layerId: string;
  readonly clearingGroups: ReadonlyArray<CncGroup>;
  readonly profileGroups: ReadonlyArray<CncGroup>;
  readonly reliefPlans: ReadonlyArray<CncReliefPlanningEvidence>;
  readonly offsetLadderDiagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverOperation?: CncStepoverCompilationEvidence;
  readonly strategyFallbacks: ReadonlyArray<CncStrategyFallback>;
  readonly tabHoldShapes: ReadonlyArray<CncTabHoldShape>;
};

export function tagArtworkGroup(group: CncGroup, sourceObjectId: string): CncGroup {
  return { ...group, sourceObjectId };
}

export type CncOperationGroups = {
  readonly clearingGroups: ReadonlyArray<CncGroup>;
  readonly profileGroups: ReadonlyArray<CncGroup>;
  readonly offsetLadderDiagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverUsed: boolean;
  readonly strategyFallbacks: ReadonlyArray<CncStrategyFallback>;
  readonly tabHoldShapes: ReadonlyArray<CncTabHoldShape>;
};
