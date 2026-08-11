import { artworkOperationRuns } from '../artwork-order';
// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type {
  CncCompilationSidecar,
  CncOffsetLadderCompilationEvidence,
  CncReliefPlanningEvidence,
  CncStepoverCompilationEvidence,
} from '../job/job';
import { DEFAULT_CNC_LAYER_SETTINGS, type Scene } from '../scene';
import type { CncCompilationEvidence } from './cnc-compilation-artifact';
import type { VCarveLadder } from './vcarve-ladder';

export function offsetDiagnosticsForStatus(
  layerId: string,
  status: { readonly offsetFailed: boolean; readonly passLimited: boolean },
): ReadonlyArray<CncOffsetLadderCompilationEvidence> {
  return [
    ...(status.offsetFailed ? ([{ layerId, kind: 'geometry-failed' }] as const) : []),
    ...(status.passLimited ? ([{ layerId, kind: 'pass-limit' }] as const) : []),
  ];
}

export function hasVCarveOperation(scene: Scene): boolean {
  return artworkOperationRuns(scene).some(
    ({ layer }) => (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType === 'v-carve',
  );
}

export function boundVCarveLadder(
  layers: CncCompilationEvidence['vcarveLayers'],
  operationIndex: number,
  layerId: string,
  priorityObjectId: string,
  required: boolean,
): VCarveLadder | undefined {
  const evidence = layers.find((candidate) => candidate.operationIndex === operationIndex);
  if (evidence === undefined) {
    if (required)
      throw new Error(`Missing bound V-carve evidence for operation ${operationIndex}.`);
    return undefined;
  }
  if (evidence.layerId !== layerId || evidence.priorityObjectId !== priorityObjectId) {
    throw new Error(`Bound V-carve evidence does not match operation ${operationIndex}.`);
  }
  return evidence.ladder;
}

export function buildCncCompilationSidecar(
  layers: CncCompilationEvidence['vcarveLayers'],
  stepoverOperations: ReadonlyArray<CncStepoverCompilationEvidence>,
  reliefPlans: ReadonlyArray<CncReliefPlanningEvidence>,
  offsetLadderDiagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>,
): CncCompilationSidecar {
  const exactOffsetDiagnostics = uniqueOffsetDiagnostics([
    ...offsetLadderDiagnostics,
    ...vcarveOffsetDiagnostics(layers),
  ]);
  return {
    vcarveOperations: layers.map(({ operationIndex, layerId, ladder }) => ({
      operationIndex,
      layerId,
      entryIssue: ladder.entryIssue,
      offsetFailed: ladder.offsetFailed,
      thinResidual: ladder.thinResidual,
      passLimited: ladder.passLimited,
    })),
    // Empty arrays are authoritative too: they distinguish a fresh compile
    // whose planners did not consume these values from a legacy artifact that
    // has no call-bound evidence and may need source fallback.
    stepoverOperations,
    reliefPlans,
    offsetLadderDiagnostics: exactOffsetDiagnostics,
  };
}

function vcarveOffsetDiagnostics(
  layers: CncCompilationEvidence['vcarveLayers'],
): ReadonlyArray<CncOffsetLadderCompilationEvidence> {
  return layers.flatMap(({ layerId, ladder }) => [
    ...(ladder.offsetFailed ? ([{ layerId, kind: 'geometry-failed' }] as const) : []),
    ...(ladder.thinResidual ? ([{ layerId, kind: 'thin-detail-dropped' }] as const) : []),
    ...(ladder.passLimited ? ([{ layerId, kind: 'pass-limit' }] as const) : []),
  ]);
}

function uniqueOffsetDiagnostics(
  diagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>,
): ReadonlyArray<CncOffsetLadderCompilationEvidence> {
  const seen = new Set<string>();
  return diagnostics.filter(({ layerId, kind }) => {
    const key = `${layerId}\0${kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
