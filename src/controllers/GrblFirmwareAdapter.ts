/**
 * T1-194 (external audit High #15 implementation slice): GrblAdapter
 * implementing the `FirmwareAdapter` contract over existing GRBL
 * code (T1-192).
 *
 * Scope:
 *   - `capabilities()`: static GRBL advert (matches what
 *     GrblControllerApi declares today: gcode-line-stream, M4
 *     dynamic laser, G2/G3 arcs, `?` status, `$#` work-offset,
 *     host-streamed transport with buffered firmware execution).
 *   - `compileConstraints()`: GRBL planner constraints (no arc
 *     flattening, runtime accel/feed limits from live identity).
 *   - `emit(plan, job)`: thin wrapper over `GrblOutputStrategy.
 *     generateGcode()` + spool burn-envelope analysis so the
 *     `OutputArtifact` carries a replayable stream and real burn AABB.
 *   - `validate(output, live)`: minimal sanity checks — `$30`
 *     missing → warning, laser-mode mismatch → error. The full
 *     MachinePreflight battery still runs through the preflight
 *     rule system; this is the adapter-level second line that
 *     doesn't depend on a full PreflightContext.
 *   - `stream(output)`: explicitly returns a stub session that
 *     immediately rejects. Real streaming still goes through
 *     `GrblController.executeJob` / `MachineService.startValidatedJob`
 *     — wiring those into the FirmwareAdapter contract is the
 *     deferred multi-week step (T1-197 or later).
 *   - `recover(event)`: maps each `MachineFaultKind` to a sensible
 *     default `RecoveryPlan` (matches the recovery flows already
 *     coded in T1-122 / T1-175 / T1-176).
 *
 * Wiring:
 *   - `getGrblFirmwareAdapter()` returns the singleton. No
 *     production code is required to consume it yet; the audit
 *     wanted a real implementation of the contract to prove the
 *     interface is satisfiable, and T1-194 ships that.
 *
 * The deferred follow-up (T1-197+) replaces `controllerType: 'grbl'`
 * on the ticket with `firmware: FirmwareAdapter['id']` and routes
 * `MachineService.startValidatedJob` through `adapter.stream()` —
 * a multi-week refactor of every compile / start call site.
 */
import type {
  AdapterFinding,
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
import { GrblOutputStrategy } from '../core/output/GrblStrategy';
import { analyzeEmittedBurnEnvelopeFromChunks } from '../core/output/emittedBurnEnvelope';
import { buildReplayableGcodeSpool } from '../core/output/GcodeStreaming';
import { generateTicketId } from '../core/job/ticketHashing';

const GRBL_CAPABILITIES: FirmwareCapabilities = Object.freeze({
  id: 'grbl',
  name: 'GRBL 1.1',
  protocol: 'gcode-line-stream',
  supportsDynamicLaserPower: true,
  supportsArcs: true,
  supportsRealtimeStatusQuery: true,
  supportsWorkOffsetQuery: true,
  disconnectStopsJob: false,
  // Real value comes from `$30` at connect time. Null here means
  // "must be filled in from the live identity"; `validate()` checks
  // for the live value.
  maxSpindleStatic: null,
});

const GRBL_PLANNER_CONSTRAINTS: PlannerConstraints = Object.freeze({
  flattenArcsToLines: false,
  maxAccelMmPerS2: null,
  maxFeedMmPerMin: null,
});

class GrblFirmwareAdapter implements FirmwareAdapter {
  readonly id = 'grbl' as const;

  capabilities(): FirmwareCapabilities {
    return GRBL_CAPABILITIES;
  }

  compileConstraints(): PlannerConstraints {
    return GRBL_PLANNER_CONSTRAINTS;
  }

  async emit(plan: Plan, job: Job): Promise<OutputArtifact> {
    // Reuse the existing GRBL streaming emitter so the adapter
    // artifact can be consumed without splitting a fully materialized
    // text blob. The adapter adds the burn envelope (T1-182) so
    // downstream consumers can run the T1-188 divergence check.
    const strategy = new GrblOutputStrategy();
    const generatedAt = new Date().toISOString();
    const spool = await buildReplayableGcodeSpool(
      generateTicketId(),
      options => strategy.generateGcode(plan, job, {
        ...options,
        clock: () => generatedAt,
      }),
    );
    const envelope = await analyzeEmittedBurnEnvelopeFromChunks(spool.open());
    return {
      kind: 'gcode-stream',
      firmware: 'grbl',
      spool,
      burnBounds: envelope.burnBounds,
    };
  }

  validate(output: OutputArtifact, live: LiveMachineIdentity): AdapterFindings {
    const findings: AdapterFinding[] = [];
    if (output.firmware !== 'grbl') {
      findings.push({
        severity: 'error',
        code: 'GRBL_ADAPTER_WRONG_FIRMWARE',
        message: `GrblAdapter cannot validate output from firmware '${output.firmware}'.`,
        fix: 'Route the output through the matching firmware adapter.',
      });
      return { findings };
    }
    if (live.maxSpindle == null) {
      findings.push({
        severity: 'warning',
        code: 'GRBL_MAX_SPINDLE_UNKNOWN',
        message: 'Controller has not reported `$30` (max spindle). Power scaling may be incorrect.',
        fix: 'Reconnect; the controller should emit `$30` during the post-connect settings dump.',
      });
    }
    if (live.laserMode === false) {
      findings.push({
        severity: 'error',
        code: 'GRBL_LASER_MODE_DISABLED',
        message: 'Controller has `$32=0` (CNC / spindle mode). LaserForge requires `$32=1`.',
        fix: 'Run `$32=1` in the console then reconnect.',
      });
    }
    return { findings };
  }

  stream(_output: OutputArtifact): StreamSession {
    // T1-194 explicitly does NOT wire streaming into the existing
    // `GrblController.executeJob` path; that's the multi-week
    // refactor (T1-197+). Calling `stream()` today returns a
    // session that immediately rejects so callers know the path
    // is not yet wired. The supervisor / UI continues to use the
    // pre-T1-192 control surface (`MachineService.startValidatedJob`).
    const sessionId = `grbl-${Date.now().toString(36)}`;
    return {
      sessionId,
      completed: Promise.reject(
        new Error(
          'GrblFirmwareAdapter.stream() is not yet wired (T1-197+). '
          + 'Use `MachineService.startValidatedJob(ticket)` for the '
          + 'production streaming path.',
        ),
      ),
      cancel(_reason: string): void {},
      pause(): void {},
      resume(): void {},
    };
  }

  recover(event: MachineFault): RecoveryPlan {
    // Maps the audit-named fault kinds to the recovery flows
    // already coded in T1-122 (recovery state) / T1-175 (E-stop
    // preserves unsafe state) / T1-176 (failed-start preserves
    // when streamed) / T1-174 (placement uncertain).
    const steps: RecoveryStep[] = [];
    switch (event.kind) {
      case 'alarm':
        steps.push({ kind: 'inspect-machine', required: true, message: 'GRBL reported an alarm — physically inspect the head and material before clearing.' });
        steps.push({ kind: 'clear-alarm', required: true, message: 'Send `$X` to clear the alarm state.' });
        steps.push({ kind: 're-home', required: true, message: 'Re-home the machine before the next job.' });
        break;
      case 'transport-error':
        steps.push({ kind: 'inspect-machine', required: true, message: 'Transport disconnected mid-stream — inspect the workpiece and head position.' });
        steps.push({ kind: 'reconnect', required: true, message: 'Reconnect the controller. The connect handshake will check the safe state (T1-25).' });
        break;
      case 'safety-off-failed':
        steps.push({ kind: 'inspect-machine', required: true, message: 'Laser-off contract was indeterminate. Treat the laser as potentially on until confirmed off.' });
        steps.push({ kind: 'soft-reset', required: true, message: 'Send `0x18` (Ctrl-X soft reset) to force the controller into a known state.' });
        steps.push({ kind: 'reconnect', required: true, message: 'Reconnect to verify the safe state.' });
        break;
      case 'placement-uncertain':
        steps.push({ kind: 'reconnect', required: true, message: 'WCS state is uncertain. Disconnect and reconnect so the placement consent flow can run.' });
        steps.push({ kind: 're-home', required: false, message: 'Re-home if the WCS reset will move the work coordinate frame.' });
        break;
      case 'firmware-mismatch':
        steps.push({ kind: 'reconnect', required: true, message: 'The live firmware identity differs from the compile-time snapshot. Reconnect and recompile.' });
        break;
    }
    return {
      faultKind: event.kind,
      steps,
      advisoryOnly: false,
    };
  }
}

const SINGLETON = new GrblFirmwareAdapter();

/**
 * Return the GRBL firmware adapter singleton. Future code that
 * resolves an adapter by `FirmwareAdapter['id']` (via a registry
 * shipped in T1-197+) will go through this for the GRBL case.
 */
export function getGrblFirmwareAdapter(): FirmwareAdapter {
  return SINGLETON;
}
