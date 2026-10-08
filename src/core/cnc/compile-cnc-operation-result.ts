import type { CncOpenContourOmissions } from './cnc-open-contour-omissions';
import type {
  CncGroup,
  CncOffsetLadderCompilationEvidence,
  CncReliefPlanningEvidence,
  CncStepoverCompilationEvidence,
} from '../job/job';
export type CompiledCncOperation = {
  readonly openContourOmissions: CncOpenContourOmissions;
  readonly kind: 'compiled';
  readonly layerId: string;
  readonly clearingGroups: ReadonlyArray<CncGroup>;
  readonly profileGroups: ReadonlyArray<CncGroup>;
  readonly reliefPlans: ReadonlyArray<CncReliefPlanningEvidence>;
  readonly offsetLadderDiagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverOperation?: CncStepoverCompilationEvidence;
};

export function tagArtworkGroup(group: CncGroup, sourceObjectId: string): CncGroup {
  return { ...group, sourceObjectId };
}

export type CncOperationGroups = {
  readonly clearingGroups: ReadonlyArray<CncGroup>;
  readonly profileGroups: ReadonlyArray<CncGroup>;
  readonly offsetLadderDiagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverUsed: boolean;
};
