import { buildCncToolPrograms, type CncToolProgram } from '../../io/cnc/cnc-tool-programs';
import { cncProgramReachWarnings } from '../../io/cnc/cnc-program-reach';
import { cncProgramFacts, type CncProgramFacts } from '../../io/cnc/cnc-program-facts';
import { emitPreparedGcode, type EmitGcodeOptions, type PreparedOutput } from '../../io/gcode';
import type { PreflightResult } from '../../core/preflight';
import { sceneObjectUsesOperation, type Scene, type Vec2 } from '../../core/scene';
import { outputPreparationFailure } from './output-preparation-errors';
import {
  compiledVCarveLayerDepths,
  type CompiledVCarveLayerDepth,
} from './cnc-compiled-depth-warnings';

const FACTUAL_EMISSION_REFUSAL_CODES = new Set([
  'coordinate-unencodable',
  'program-materialization-failed',
]);

/**
 * Where preparation put the design in the program, for the G-code Inspector's
 * carved stock to compare with (ADR-487).
 */
export type EmittedDesignPlacement = {
  /** What preparation added to the design's machine X and Y. */
  readonly jobOriginOffset: Vec2;
  /** The reliefs on operations the program carves. */
  readonly reliefIds: ReadonlyArray<string>;
};

/**
 * Tagged Save emission result. Callers must branch on `kind`;
 * `preparation-failed` means no prepared program exists, while
 * `emission-refused` means preparation succeeded but the emitter produced no
 * writable bytes.
 */
export type SaveOutputEmission =
  | {
      readonly kind: 'preparation-unavailable' | 'preparation-busy' | 'preparation-error';
      readonly gcode: '';
      readonly message: string;
      readonly preflight: PreflightResult;
    }
  | {
      readonly kind: 'preparation-failed';
      readonly gcode: '';
      readonly preflight: Extract<PreparedOutput, { readonly ok: false }>['preflight'];
    }
  | {
      readonly kind: 'emission-refused';
      readonly gcode: '';
      readonly preflight: ReturnType<typeof emitPreparedGcode>['preflight'];
    }
  | {
      readonly kind: 'emitted';
      readonly cncProgramFacts?: CncProgramFacts;
      readonly cncToolPrograms?: ReadonlyArray<CncToolProgram>;
      readonly gcode: string;
      readonly preflight: ReturnType<typeof emitPreparedGcode>['preflight'];
      readonly cncVCarveDepths: ReadonlyArray<CompiledVCarveLayerDepth>;
      readonly machineWarnings?: ReadonlyArray<string>;
      readonly placement?: EmittedDesignPlacement;
    };

/**
 * Emits a successfully prepared output while retaining failed preparation as
 * a distinct, non-writable result.
 */
export function emitSavePreparedOutput(
  prepared: PreparedOutput,
  options: EmitGcodeOptions,
  machineWarnings: ReadonlyArray<string> = [],
): SaveOutputEmission {
  if (!prepared.ok) {
    return {
      kind: 'preparation-failed',
      gcode: '',
      preflight: prepared.preflight,
    };
  }
  const emitted = emitPreparedGcode(prepared, options);
  const isFactualEmissionRefusal =
    emitted.gcode === '' &&
    emitted.preflight.issues.some((issue) => FACTUAL_EMISSION_REFUSAL_CODES.has(issue.code));
  if (isFactualEmissionRefusal) {
    return { kind: 'emission-refused', ...emitted, gcode: '' };
  }
  const { warnings: toolWarnings, ...artifacts } = cncSaveArtifacts(prepared, options, emitted);
  return {
    kind: 'emitted',
    ...emitted,
    cncVCarveDepths: compiledVCarveLayerDepths(prepared.job),
    ...artifacts,
    machineWarnings: [
      ...machineWarnings,
      ...toolWarnings,
      ...cncProgramReachWarnings(
        prepared.project,
        emitted.gcode,
        artifacts.cncProgramFacts?.toolPlan,
      ),
    ],
    placement: {
      jobOriginOffset: prepared.jobOriginOffset,
      reliefIds: outputReliefIds(prepared.project.scene),
    },
  };
}

function cncSaveArtifacts(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
  options: EmitGcodeOptions,
  combinedEmission: ReturnType<typeof emitPreparedGcode>,
): {
  readonly cncProgramFacts?: CncProgramFacts;
  readonly cncToolPrograms?: ReadonlyArray<CncToolProgram>;
  readonly warnings: ReadonlyArray<string>;
} {
  if (prepared.project.machine?.kind !== 'cnc') return { warnings: [] };
  const facts = cncProgramFacts(prepared.job, prepared.project);
  const result = buildCncToolPrograms(prepared, options, combinedEmission);
  return {
    cncProgramFacts: facts,
    ...(result.kind === 'ready' ? { cncToolPrograms: result.programs } : {}),
    warnings: result.kind === 'unavailable' ? [result.message] : [],
  };
}
// The reliefs an output operation carves, as the CNC compiler picks them.
function outputReliefIds(scene: Scene): ReadonlyArray<string> {
  const output = scene.layers.filter((layer) => layer.output);
  return scene.objects
    .filter(
      (object) =>
        object.kind === 'relief' && output.some((layer) => sceneObjectUsesOperation(object, layer)),
    )
    .map((object) => object.id);
}

export function unavailableSaveOutput(message: string): SaveOutputEmission {
  return {
    kind: 'preparation-unavailable',
    gcode: '',
    message,
    preflight: { ok: false, issues: [] },
  };
}

export function failedBackgroundSaveOutput(error: unknown): SaveOutputEmission {
  const failure = outputPreparationFailure(error);
  return {
    kind:
      failure.kind === 'capacity'
        ? 'preparation-busy'
        : failure.kind === 'infrastructure'
          ? 'preparation-unavailable'
          : 'preparation-error',
    gcode: '',
    message: failure.message,
    preflight: { ok: false, issues: [] },
  };
}
