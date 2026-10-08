import type {
  CncGroup,
  CncOffsetLadderCompilationEvidence,
  CncReliefPlanningEvidence,
  CncStepoverCompilationEvidence,
} from '../job/job';
export type CompiledCncOperation = {
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
