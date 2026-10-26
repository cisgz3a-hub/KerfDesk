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

/** Exact closed copies one filled operation cut once (ADR-359 Amendment 3). */
export type CncStackedCopyMerge = {
  readonly layerId: string;
  readonly cutType: CncCutType;
  /** Copies merged into an outline already on the operation. */
  readonly count: number;
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
  /** Absent when no operation merged a copy, and on jobs from before the merge. */
  readonly mergedStackedCopies?: ReadonlyArray<CncStackedCopyMerge>;
};
