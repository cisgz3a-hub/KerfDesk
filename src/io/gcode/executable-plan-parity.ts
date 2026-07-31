import {
  buildExecutablePlan,
  serializeExecutablePlan,
  type ExecutablePlanPoint,
  type ExecutablePlanV1,
} from '../../core/execution-plan';
import type { ToolpathStep } from '../../core/job';
import { parseGcodeProgram } from './parse-gcode-program';

export const EXECUTABLE_PLAN_PARITY_TOLERANCE_MM = 1e-6;

export type ExecutablePlanParityCheck = {
  readonly name:
    | 'byte-exact-serialization'
    | 'raw-line-accounting'
    | 'clean-room-endpoint-sequence'
    | 'deterministic-rebuild';
  readonly ok: boolean;
  readonly detail: string;
};

export type ExecutablePlanParityResult = {
  readonly ok: boolean;
  readonly toleranceMm: number;
  readonly checks: ReadonlyArray<ExecutablePlanParityCheck>;
};

type EndpointPair = {
  readonly start: ExecutablePlanPoint;
  readonly end: ExecutablePlanPoint;
};

export function verifyExecutablePlanParity(
  plan: ExecutablePlanV1,
  currentGcode: string,
): ExecutablePlanParityResult {
  const checks: ExecutablePlanParityCheck[] = [];
  checks.push(byteParity(plan, currentGcode));
  const parsed = parseGcodeProgram(currentGcode);
  if (parsed.kind === 'error') {
    checks.push({
      name: 'raw-line-accounting',
      ok: false,
      detail: `Clean-room parser failed: ${parsed.reason}`,
    });
    checks.push({
      name: 'clean-room-endpoint-sequence',
      ok: false,
      detail: 'Endpoint comparison was unavailable because clean-room parsing failed.',
    });
  } else {
    checks.push({
      name: 'raw-line-accounting',
      ok: parsed.summary.lineCount === plan.source.rawLineCount,
      detail: `${parsed.summary.lineCount} parsed lines; ${plan.source.rawLineCount} planned lines.`,
    });
    checks.push(endpointParity(plan, parsed.toolpath.steps));
  }
  checks.push(determinismParity(plan, currentGcode));
  return {
    ok: checks.every((check) => check.ok),
    toleranceMm: EXECUTABLE_PLAN_PARITY_TOLERANCE_MM,
    checks,
  };
}

function byteParity(plan: ExecutablePlanV1, gcode: string): ExecutablePlanParityCheck {
  const serialized = serializeExecutablePlan(plan);
  return {
    name: 'byte-exact-serialization',
    ok: serialized === gcode,
    detail:
      serialized === gcode
        ? `Exact ${plan.source.utf8ByteLength}-byte UTF-8 program retained.`
        : 'Plan serialization differs from the current emitted program.',
  };
}

function endpointParity(
  plan: ExecutablePlanV1,
  steps: ReadonlyArray<ToolpathStep>,
): ExecutablePlanParityCheck {
  const simulator = simulatorEndpoints(steps);
  if (simulator.length !== plan.motions.length) {
    return {
      name: 'clean-room-endpoint-sequence',
      ok: false,
      detail: `${simulator.length} simulator moves; ${plan.motions.length} planned moves.`,
    };
  }
  for (let index = 0; index < simulator.length; index += 1) {
    const pair = simulator[index];
    const motion = plan.motions[index];
    const start = motion?.pointsMm[0];
    const end = motion?.pointsMm.at(-1);
    if (
      pair === undefined ||
      start === undefined ||
      end === undefined ||
      !samePoint(pair.start, start) ||
      !samePoint(pair.end, end)
    ) {
      return {
        name: 'clean-room-endpoint-sequence',
        ok: false,
        detail: `Independent geometry differs at motion ${index + 1}.`,
      };
    }
  }
  return {
    name: 'clean-room-endpoint-sequence',
    ok: true,
    detail: `${simulator.length} ordered motion endpoints agree within tolerance.`,
  };
}

function simulatorEndpoints(steps: ReadonlyArray<ToolpathStep>): ReadonlyArray<EndpointPair> {
  const endpoints: EndpointPair[] = [];
  let z = 0;
  for (const step of steps) {
    const projected = simulatorStepEndpoints(step, z);
    if (projected === null) continue;
    endpoints.push(projected.pair);
    z = projected.endZ;
  }
  return endpoints;
}

function simulatorStepEndpoints(
  step: ToolpathStep,
  currentZ: number,
): { readonly pair: EndpointPair; readonly endZ: number } | null {
  if (step.kind === 'plunge') {
    return {
      pair: {
        start: { x: step.at.x, y: step.at.y, z: step.fromZ },
        end: { x: step.at.x, y: step.at.y, z: step.toZ },
      },
      endZ: step.toZ,
    };
  }
  const planar =
    step.kind === 'travel'
      ? { from: step.from, to: step.to }
      : { from: step.polyline[0], to: step.polyline.at(-1) };
  if (planar.from === undefined || planar.to === undefined) return null;
  const fromZ = step.z?.from ?? currentZ;
  const toZ = step.z?.to ?? currentZ;
  return {
    pair: {
      start: { x: planar.from.x, y: planar.from.y, z: fromZ },
      end: { x: planar.to.x, y: planar.to.y, z: toZ },
    },
    endZ: toZ,
  };
}

function samePoint(left: ExecutablePlanPoint, right: ExecutablePlanPoint): boolean {
  return (
    Math.abs(left.x - right.x) <= EXECUTABLE_PLAN_PARITY_TOLERANCE_MM &&
    Math.abs(left.y - right.y) <= EXECUTABLE_PLAN_PARITY_TOLERANCE_MM &&
    Math.abs(left.z - right.z) <= EXECUTABLE_PLAN_PARITY_TOLERANCE_MM
  );
}

function determinismParity(plan: ExecutablePlanV1, gcode: string): ExecutablePlanParityCheck {
  const rebuilt = buildExecutablePlan(gcode, {
    machineKind: plan.machineKind,
    controller: plan.controller.emitter,
    ...(plan.controller.profileControllerKind === null
      ? {}
      : { profileControllerKind: plan.controller.profileControllerKind }),
  });
  const ok = rebuilt.kind === 'ok' && JSON.stringify(rebuilt.plan) === JSON.stringify(plan);
  return {
    name: 'deterministic-rebuild',
    ok,
    detail: ok ? 'A second pure build produced the same plan.' : 'A second build changed the plan.',
  };
}
