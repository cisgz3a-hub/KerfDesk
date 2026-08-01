import { buildGcodeRenderModel, type GcodeRenderModel, type ProgramEvent } from '../gcode-view';
// Deep import: core/job's legacy barrel is CI-ratcheted at 85 exports and may only shrink.
import { buildMotionManifest } from '../job/motion-manifest';
import { alignPlanMotions } from './align-plan-motions';
import { assembleExecutablePlan } from './assemble-executable-plan';
import {
  type BuildExecutablePlanOptions,
  type BuildExecutablePlanResult,
  type ExecutablePlanBuildIssue,
} from './executable-plan-types';

/** Builds a deterministic v1 semantic sidecar from one exact G-code program. */
export function buildExecutablePlan(
  gcode: string,
  options: BuildExecutablePlanOptions,
): BuildExecutablePlanResult {
  if (gcode.length === 0) return { kind: 'unavailable', reason: 'no-program' };
  const rendered = buildGcodeRenderModel(gcode);
  if (rendered.kind === 'error') {
    return {
      kind: 'error',
      reason: 'parse-error',
      issues: [{ code: 'render-parse-error', message: rendered.reason }],
    };
  }
  if (rendered.model.skippedMotions.length > 0) {
    return {
      kind: 'error',
      reason: 'parse-error',
      issues: rendered.model.skippedMotions.map((skipped) => ({
        code: 'skipped-motion' as const,
        message: skipped.reason,
        rawLineIndex: skipped.line,
      })),
    };
  }
  const cannedCycle = unsupportedCannedCycle(rendered.model.events);
  if (cannedCycle !== null) {
    return { kind: 'error', reason: 'unsupported-input', issues: [cannedCycle] };
  }
  return buildAlignedPlan(gcode, rendered.model, options);
}

/**
 * The Inspector expands one canned-cycle word into a whole drilling sequence
 * (ADR-255 stage 12) while the controller manifest models that line as a single
 * move, so the readers can never agree on it. Naming the input class keeps a
 * drilling program from surfacing as an opaque mode disagreement; the class was
 * already refused before it was named.
 */
function unsupportedCannedCycle(
  events: ReadonlyArray<ProgramEvent>,
): ExecutablePlanBuildIssue | null {
  const event = events.find((candidate) => candidate.kind === 'canned-cycle');
  if (event === undefined || event.kind !== 'canned-cycle') return null;
  return {
    code: 'canned-cycle-unsupported',
    message: `Raw line ${event.line}: canned cycle G${event.code} is not representable in ExecutablePlan v1.`,
    rawLineIndex: event.line,
  };
}

function buildAlignedPlan(
  gcode: string,
  model: GcodeRenderModel,
  options: BuildExecutablePlanOptions,
): BuildExecutablePlanResult {
  const manifest = buildMotionManifest(gcode, { machineKind: options.machineKind });
  const aligned = alignPlanMotions(model, manifest.blocks);
  if (aligned.motions === null) {
    return { kind: 'error', reason: 'semantic-mismatch', issues: aligned.issues };
  }
  return {
    kind: 'ok',
    plan: assembleExecutablePlan({
      gcode,
      model,
      options,
      motions: aligned.motions,
      sendableLineCount: manifest.sendableLineCount,
    }),
  };
}
