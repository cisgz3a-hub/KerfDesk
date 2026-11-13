import type { CncCutType, Vec2 } from '../scene';
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

/** ADR-672: an Outside or Inside profile's outlines that were drawn as open paths. */
export type CncProfileOpenPaths = {
  readonly layerId: string;
  readonly layerName: string;
  readonly cutType: 'profile-outside' | 'profile-inside';
  /** Open paths cut on their line, not offset to the profile's side. */
  readonly onLine: number;
  /** Near-closed outlines joined into closed shapes and offset as such. */
  readonly joined: number;
  /** The cut width at full depth: how far off size an outline cut on its line comes out. */
  readonly cutWidthMm: number;
};

/** ADR-433 Amendment 3: a profile operation's cutter reaches a part another operation keeps. */
export type CncKeptPartCut = {
  readonly layerId: string;
  readonly layerName: string;
  readonly keptLayerId: string;
  readonly keptLayerName: string;
  /** Walls of `keptLayerId` (part outlines or hole edges) the cutter reaches. */
  readonly contours: number;
  /** Deepest reach into a kept part, mm; null when the cut runs into the part itself. */
  readonly depthMm: number | null;
  /** Machine position of the deepest reach, on the kept part's edge. */
  readonly at: Vec2;
  /** The cut width of `layerId` at full depth. */
  readonly cutWidthMm: number;
  /** The finish allowance `layerId` roughs with, set when only its roughing
   * ring reaches the part: the finishing pass alone would clear it. */
  readonly finishAllowanceMm?: number;
};

/** Exact closed copies one filled operation cut once (ADR-359 Amendment 3). */
export type CncStackedCopyMerge = {
  readonly layerId: string;
  readonly cutType: CncCutType;
  /** Copies merged into an outline already on the operation. */
  readonly count: number;
};

/** An operation that cuts another strategy than the one it asks for, and why
 * (performance audit S8-P2-1): adaptive clearing the planner or verifier
 * refused cuts the ordinary offset pocket, and stock-aware rest machining
 * without a usable stock model clears the whole pocket with its finishing bit. */
export type CncStrategyFallback = {
  readonly layerId: string;
  readonly kind: 'adaptive-offset' | 'rest-full-pocket';
  readonly reason: string;
};

/**
 * ADR-258 Amendment 5: a loop whose holding tabs are not the ones set.
 *   - never-through: too short for even one tab, so it rides the tab top and
 *     is never cut free;
 *   - fewer-tabs: cut with fewer tabs than set, so that it still cuts through;
 *   - narrow-bridge: a tab whose window turns so far that the bridge left is
 *     under half the set width;
 *   - closed-gap: an open outline whose ends the bit sweeps together, tabbed
 *     as the closed shape it cuts free.
 */
export type CncTabHoldShape = {
  readonly layerId: string;
  readonly layerName: string;
  readonly kind: 'never-through' | 'fewer-tabs' | 'narrow-bridge' | 'closed-gap';
  readonly role: 'part' | 'hole';
  /** The drawn shape's width and height, mm. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly tabsSet: number;
  readonly tabsCut: number;
  readonly tabWidthMm: number;
  /** The cut width at full depth. */
  readonly cutWidthMm: number;
  /** The narrowest bridge left, mm (narrow-bridge only). */
  readonly bridgeMm?: number;
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
  /** Absent on jobs compiled before ADR-672. */
  readonly profileOpenPaths?: ReadonlyArray<CncProfileOpenPaths>;
  /** Absent on jobs compiled before ADR-433 Amendment 3. */
  readonly keptPartCuts?: ReadonlyArray<CncKeptPartCut>;
  /** Absent when no operation merged a copy, and on jobs from before the merge. */
  readonly mergedStackedCopies?: ReadonlyArray<CncStackedCopyMerge>;
  /** Absent when no operation fell back, and on jobs from before S8-P2-1. */
  readonly strategyFallbacks?: ReadonlyArray<CncStrategyFallback>;
  /** Absent when every loop has the tabs set, and on jobs from before ADR-258 Amendment 5. */
  readonly tabHoldShapes?: ReadonlyArray<CncTabHoldShape>;
};
