import {
  buildExecutablePlan,
  type ExecutablePlanBuildIssue,
  type ExecutablePlanV1,
} from '../../core/execution-plan';
import { selectOutputStrategy } from '../../core/output';
import { machineKindOf, type Project } from '../../core/scene';
import { emitPreparedGcode, type EmitGcodeOptions, type EmitGcodeResult } from './emit-gcode';
import {
  verifyExecutablePlanParity,
  type ExecutablePlanParityResult,
} from './executable-plan-parity';
import { prepareOutput, type PreparedOutput } from './prepare-output';

/** Semantic sidecar status attached to an otherwise unchanged emission result. */
export type ExecutablePlanSidecar =
  | {
      readonly kind: 'ok';
      readonly plan: ExecutablePlanV1;
      readonly parity: ExecutablePlanParityResult;
    }
  | { readonly kind: 'unavailable'; readonly reason: 'no-gcode' }
  | {
      readonly kind: 'error';
      readonly reason: 'plan-build-failed' | 'semantic-parity-failed';
      readonly issues: ReadonlyArray<ExecutablePlanBuildIssue | string>;
    };

/** Legacy emission result plus the opt-in ExecutablePlan sidecar. */
export type EmitGcodeWithExecutablePlanResult = EmitGcodeResult & {
  readonly sidecar: ExecutablePlanSidecar;
};

/** Opt-in compatibility seam. Existing emitGcode callers are untouched. */
export function emitGcodeWithExecutablePlan(
  project: Project,
  options: EmitGcodeOptions = {},
): EmitGcodeWithExecutablePlanResult {
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
  });
  return emitPreparedGcodeWithExecutablePlan(prepared, options);
}

/** Emits an already-prepared job and attaches a parity-verified semantic sidecar. */
export function emitPreparedGcodeWithExecutablePlan(
  prepared: PreparedOutput,
  options: EmitGcodeOptions = {},
): EmitGcodeWithExecutablePlanResult {
  const emission = emitPreparedGcode(prepared, options);
  if (!prepared.ok || emission.gcode.length === 0) {
    return { ...emission, sidecar: { kind: 'unavailable', reason: 'no-gcode' } };
  }
  const machineKind = machineKindOf(prepared.project.machine);
  const controller =
    machineKind === 'cnc' ? 'grbl-cnc' : selectOutputStrategy(prepared.project.device).id;
  const built = buildExecutablePlan(emission.gcode, {
    machineKind,
    controller,
    ...(prepared.project.device.controllerKind === undefined
      ? {}
      : { profileControllerKind: prepared.project.device.controllerKind }),
  });
  if (built.kind !== 'ok') {
    const issues = built.kind === 'error' ? built.issues : ['No emitted program was available.'];
    return {
      ...emission,
      sidecar: { kind: 'error', reason: 'plan-build-failed', issues },
    };
  }
  const parity = verifyExecutablePlanParity(built.plan, emission.gcode);
  if (!parity.ok) {
    return {
      ...emission,
      sidecar: {
        kind: 'error',
        reason: 'semantic-parity-failed',
        issues: parity.checks.filter((check) => !check.ok).map((check) => check.detail),
      },
    };
  }
  // The emitted program is returned untouched. Sourcing it from the plan would be
  // a no-op only while byteParity runs first, making byte neutrality depend on
  // check ordering instead of on never rewriting the emitter's output.
  return { ...emission, sidecar: { kind: 'ok', plan: built.plan, parity } };
}
