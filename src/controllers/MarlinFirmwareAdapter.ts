/**
 * T1-196 (external audit High #15 contract validation slice): a
 * declared-not-yet-supported `MarlinFirmwareAdapter` stub.
 *
 * Purpose: prove that the `FirmwareAdapter` type contract (T1-192)
 * is satisfiable by a non-GRBL adapter without requiring a full
 * Marlin implementation. The audit's framing was: "Output formats
 * include `marlin`, `smoothie`, `ruida`, and `custom`, but the
 * ticket is still `controllerType: 'grbl'`. Output-format
 * abstraction is ahead of actual firmware abstraction."
 *
 * What this stub provides:
 *   - `capabilities()`: declares Marlin's KNOWN-DIFFERENT semantics
 *     (`supportsDynamicLaserPower: false` — Marlin has no M4 dynamic
 *     mode; `supportsArcs: true` — Marlin supports G2/G3;
 *     `supportsRealtimeStatusQuery: false` — Marlin uses M114
 *     polling, not GRBL's `?`; `supportsWorkOffsetQuery: false`
 *     — Marlin uses M114 + G92 differently; `disconnectStopsJob:
 *     true` — Marlin is host-streamed like GRBL).
 *   - `compileConstraints()`: `flattenArcsToLines: false`
 *     (Marlin supports arcs); accel/feed null (live).
 *   - `emit()`: throws `MarlinNotYetSupportedError`. A real
 *     implementation will translate the canonical Plan to Marlin-
 *     dialect g-code (different M-codes for laser on/off, different
 *     S-value semantics, possibly absolute vs. relative spindle).
 *   - `validate()`: returns a single error finding stating Marlin
 *     support is declared but not implemented.
 *   - `stream()`: rejecting session matching the GrblAdapter
 *     "not yet wired" pattern.
 *   - `recover()`: matches the GrblAdapter recovery flows; the
 *     fault taxonomy is firmware-independent at the type level.
 *
 * What a real Marlin adapter implementation would need (deferred):
 *   - Marlin-dialect emitter (a new `MarlinOutputStrategy` extending
 *     `BaseGCodeStrategy` with `encodeLaserOn(power) => 'M3 S<v>'`
 *     or `'M106 P0 S<v>'` depending on Marlin laser-mode firmware).
 *   - Marlin streaming protocol (M114 polling instead of `?`;
 *     line-by-line ack via "ok" but different stalling semantics).
 *   - Marlin-specific preflight rules (no $30/$32; check M150/M151
 *     laser-mode availability; check `M85` watchdog).
 *   - Marlin-specific recovery (different alarm taxonomy; no `$X`).
 *
 * The stub exists so the type contract is exercised by TWO
 * implementations at compile time — if a future contract change
 * breaks Marlin's shape, the typecheck catches it.
 */
import type {
  AdapterFindings,
  FirmwareAdapter,
  FirmwareCapabilities,
  LiveMachineIdentity,
  MachineFault,
  OutputArtifact,
  PlannerConstraints,
  RecoveryPlan,
  RecoveryStep,
  StreamSession,
} from './FirmwareAdapter';
import type { Plan } from '../core/plan/Plan';
import type { Job } from '../core/job/Job';

/**
 * Thrown when production code attempts to emit Marlin output before
 * the real Marlin adapter is implemented. Carries the
 * `MARLIN_NOT_IMPLEMENTED` code so support bundles can attribute
 * the failure cleanly.
 */
export class MarlinNotYetSupportedError extends Error {
  readonly code = 'MARLIN_NOT_IMPLEMENTED' as const;
  constructor(operation: 'emit' | 'stream') {
    super(
      `MarlinFirmwareAdapter.${operation}() is a T1-196 stub. A real `
      + 'Marlin implementation is deferred (separate firmware-support arc). '
      + 'Use the GRBL adapter for production output until then.',
    );
    this.name = 'MarlinNotYetSupportedError';
  }
}

const MARLIN_CAPABILITIES: FirmwareCapabilities = Object.freeze({
  id: 'marlin',
  name: 'Marlin (declared, not implemented)',
  protocol: 'gcode-line-stream',
  supportsDynamicLaserPower: false, // Marlin has no M4 dynamic mode
  supportsArcs: true,                // Marlin supports G2/G3
  supportsRealtimeStatusQuery: false, // Marlin uses M114 polling
  supportsWorkOffsetQuery: false,    // Marlin uses M114 + G92 differently
  disconnectStopsJob: true,          // host-streamed like GRBL
  maxSpindleStatic: null,
});

const MARLIN_PLANNER_CONSTRAINTS: PlannerConstraints = Object.freeze({
  flattenArcsToLines: false,
  maxAccelMmPerS2: null,
  maxFeedMmPerMin: null,
});

class MarlinFirmwareAdapter implements FirmwareAdapter {
  readonly id = 'marlin' as const;

  capabilities(): FirmwareCapabilities {
    return MARLIN_CAPABILITIES;
  }

  compileConstraints(): PlannerConstraints {
    return MARLIN_PLANNER_CONSTRAINTS;
  }

  async emit(_plan: Plan, _job: Job): Promise<OutputArtifact> {
    // Real Marlin adapter: translate plan → Marlin-dialect g-code.
    throw new MarlinNotYetSupportedError('emit');
  }

  validate(_output: OutputArtifact, _live: LiveMachineIdentity): AdapterFindings {
    return {
      findings: [
        {
          severity: 'error',
          code: 'MARLIN_NOT_IMPLEMENTED',
          message: 'Marlin firmware support is declared but not implemented. The adapter type contract is in place; a real emitter / streamer / validator is deferred to a future ticket arc.',
          fix: 'Use a GRBL controller for production output until the Marlin adapter is implemented.',
        },
      ],
    };
  }

  stream(_output: OutputArtifact): StreamSession {
    const sessionId = `marlin-stub-${Date.now().toString(36)}`;
    return {
      sessionId,
      completed: Promise.reject(new MarlinNotYetSupportedError('stream')),
      cancel(_reason: string): void {},
      pause(): void {},
      resume(): void {},
    };
  }

  recover(event: MachineFault): RecoveryPlan {
    // The recovery taxonomy is firmware-independent at the type
    // level. Marlin would have slightly different alarm-clear and
    // status-query commands (M999 instead of $X; M114 instead of ?)
    // but the user-facing steps are the same.
    const steps: RecoveryStep[] = [
      { kind: 'inspect-machine', required: true, message: 'Marlin controller faulted — inspect the head and material before next start.' },
      { kind: 'reconnect', required: true, message: 'Reconnect the controller. The connect handshake will verify the safe state.' },
    ];
    return {
      faultKind: event.kind,
      steps,
      advisoryOnly: false,
    };
  }
}

const SINGLETON = new MarlinFirmwareAdapter();

/**
 * Return the (stub) Marlin firmware adapter singleton. Production
 * code SHOULD NOT consume this for emit / stream paths — those
 * throw `MarlinNotYetSupportedError`. The accessor exists so a
 * future `FirmwareRegistry` can register both GRBL and Marlin
 * adapters during the multi-firmware-support refactor.
 */
export function getMarlinFirmwareAdapter(): FirmwareAdapter {
  return SINGLETON;
}
