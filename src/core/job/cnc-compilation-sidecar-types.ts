import type { CncCutType } from '../scene';
import type {
  CncOffsetLadderCompilationEvidence,
  CncReliefPlanningEvidence,
  CncStepoverCompilationEvidence,
  CncVCarveCompilationEvidence,
} from './job';

/** Exact count from the canonical contours consumed by a closed-only operation. */
export type CncOpenContourOmission = {
  readonly layerId: string;
  readonly cutType: CncCutType;
  readonly count: number;
};

/** Separate provenance keeps aggregate counts compatible with archived evidence. */
export type CncOpenContourOmissionSource = CncOpenContourOmission & {
  readonly objectId: string;
};

/** Structured-clone-safe CNC evidence retained with the exact compiled Job. */
export type CncCompilationSidecar = {
  readonly vcarveOperations: ReadonlyArray<CncVCarveCompilationEvidence>;
  readonly offsetLadderDiagnostics?: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverOperations?: ReadonlyArray<CncStepoverCompilationEvidence>;
  readonly reliefPlans?: ReadonlyArray<CncReliefPlanningEvidence>;
  /** Absent on legacy jobs; an empty array is authoritative on fresh jobs. */
  readonly omittedOpenContours?: ReadonlyArray<CncOpenContourOmission>;
  readonly omittedOpenContourSources?: ReadonlyArray<CncOpenContourOmissionSource>;
};
