/**
 * T1-192 (external audit High #15 foundation slice): the
 * `FirmwareAdapter` contract.
 *
 * The audit framed the problem as: "Output formats include `marlin`,
 * `smoothie`, `ruida`, and `custom`, but the ticket is still
 * `controllerType: 'grbl'`. Output-format abstraction is ahead of
 * actual firmware abstraction." The audit's recommended remediation
 * is a `FirmwareAdapter` contract that a real Marlin / Ruida
 * adapter must implement before its output format becomes a real
 * runtime target.
 *
 * T1-192 ships the TYPE CONTRACT only. No GRBL retrofit, no Marlin
 * skeleton, no Ruida bridge — those are multi-week implementations
 * each. T1-192 makes the contract reviewable and audit-trackable
 * so the next firmware-support effort starts with a known shape
 * rather than ad-hoc copy-paste.
 *
 * The contract is INTENTIONALLY type-only. There is no production
 * caller wired to it yet. A future ticket (T1-194 or later) will:
 *   1. Implement `GrblAdapter implements FirmwareAdapter` over the
 *      existing GrblController / GrblStrategy code.
 *   2. Replace `controllerType: 'grbl'` in ValidatedJobTicket with
 *      `firmware: FirmwareAdapter['id']`.
 *   3. Add a `FirmwareRegistry` that registers / resolves adapters
 *      by id (mirror of the OutputStrategy registry).
 *
 * Why a type-only foundation is useful NOW:
 *   - Future PRs adding Marlin / Ruida / Smoothie support have a
 *     clear interface to satisfy.
 *   - Reviewers can audit the SHAPE of multi-firmware support
 *     without merging incomplete implementations.
 *   - The contract names the safety invariants (capabilities must
 *     be queried before streaming, validate() must run on output +
 *     live identity, recover() must produce a structured plan)
 *     that the audit identified.
 */
import type { AABB } from '../core/types';
import type { Plan } from '../core/plan/Plan';
import type { Job } from '../core/job/Job';
import type { OutputFormat } from '../core/output/Output';
import type { SpoolHandle } from '../core/output/GcodeStreaming';

/**
 * Stable identifier for a firmware adapter. Used by the future
 * registry + ticket field. Matches the existing `OutputFormat`
 * enum for clean migration; future firmware-specific adapters
 * (e.g. `'marlin'`, `'ruida'`) extend the union via the strategy
 * registry.
 */
export type FirmwareAdapterId = OutputFormat | (string & { __firmwareAdapterIdBrand?: never });

/**
 * Static capability advertisement for a firmware adapter. Returned
 * by `FirmwareAdapter.capabilities()`. Compile/start gates check
 * these BEFORE attempting to emit or stream.
 *
 * Each field is intentionally narrow — the audit's framing is that
 * adding firmware support should require explicitly declaring what
 * the firmware can do, not silently inheriting GRBL assumptions.
 */
export interface FirmwareCapabilities {
  /** The adapter's stable id. Same as `FirmwareAdapter.id`. */
  readonly id: FirmwareAdapterId;
  /** Human-readable name shown in the UI. */
  readonly name: string;
  /** The protocol family (gcode-line-stream, binary, etc). */
  readonly protocol: 'gcode-line-stream' | 'gcode-text' | 'binary-stream' | 'file-upload' | 'device-native';
  /** Whether the firmware supports M4 dynamic laser mode. */
  readonly supportsDynamicLaserPower: boolean;
  /** Whether the firmware supports G2 / G3 arcs (vs. line-only). */
  readonly supportsArcs: boolean;
  /** Whether the firmware supports the GRBL realtime `?` status query. */
  readonly supportsRealtimeStatusQuery: boolean;
  /** Whether the firmware supports the GRBL `$#` work-offset query. */
  readonly supportsWorkOffsetQuery: boolean;
  /**
   * Whether the firmware physically halts an active job when the host
   * transport disconnects. This is stricter than "the host stops
   * streaming": GRBL stops receiving new lines, but can continue
   * executing already-buffered RX/planner commands, so it must not
   * advertise this as true. Used by
   * `MachineService._guardDisconnectStopsJob` to refuse or pre-stop a
   * disconnect during a running job.
   */
  readonly disconnectStopsJob: boolean;
  /**
   * Maximum spindle / PWM value (e.g. GRBL `$30`). The compile path
   * scales `powerPercent` to this value. `null` when the value must
   * be read at runtime from the live identity.
   */
  readonly maxSpindleStatic: number | null;
}

/**
 * Planner constraints that the firmware adapter EXPECTS to see in
 * the input Plan. Returned by `FirmwareAdapter.compileConstraints()`.
 * The plan optimizer applies these BEFORE emit — e.g. ruida controllers
 * need pre-segmented arcs because the binary protocol has no arc
 * primitive.
 */
export interface PlannerConstraints {
  /**
   * Whether arcs in the input Plan should be flattened to lines
   * before emit. GRBL: false (G2/G3 supported). Ruida: true.
   */
  readonly flattenArcsToLines: boolean;
  /**
   * Maximum acceleration (mm/s²) the firmware can sustain. The
   * raster velocity-curve math uses this to pick the deceleration
   * profile. `null` to read from the live machine identity.
   */
  readonly maxAccelMmPerS2: number | null;
  /**
   * Maximum feed rate (mm/min) the firmware will accept on a G1
   * line. Above this the line is rejected or clamped silently.
   */
  readonly maxFeedMmPerMin: number | null;
}

/**
 * Output artifact produced by `FirmwareAdapter.emit()`. Mirrors
 * `ControllerOutput` from `ControllerInterface.ts` but carries the
 * `firmware` id so consumers can route to the right adapter for
 * validation and streaming.
 */
export type OutputArtifact =
  | { readonly kind: 'gcode-lines'; readonly firmware: FirmwareAdapterId; readonly lines: readonly string[]; readonly burnBounds: AABB | null }
  | { readonly kind: 'gcode-stream'; readonly firmware: FirmwareAdapterId; readonly spool: SpoolHandle; readonly burnBounds: AABB | null }
  | { readonly kind: 'gcode-text'; readonly firmware: FirmwareAdapterId; readonly text: string; readonly burnBounds: AABB | null }
  | { readonly kind: 'binary-job'; readonly firmware: FirmwareAdapterId; readonly bytes: Uint8Array; readonly burnBounds: AABB | null }
  | { readonly kind: 'device-job'; readonly firmware: FirmwareAdapterId; readonly payload: unknown; readonly burnBounds: AABB | null };

/**
 * Identity snapshot returned by the live controller at validate /
 * stream time. Mirrors the existing `DeviceIdentity` interface from
 * `ControllerInterface.ts` but is included here so the
 * `FirmwareAdapter` contract is self-contained.
 */
export interface LiveMachineIdentity {
  readonly firmwareVersion: string | null;
  readonly buildOptions: string | null;
  readonly maxSpindle: number | null;
  readonly bedWidthMm: number | null;
  readonly bedHeightMm: number | null;
  readonly homingEnabled: boolean | null;
  readonly laserMode: boolean | null;
  readonly maxAccelXMmPerS2?: number | null;
  readonly maxAccelYMmPerS2?: number | null;
}

/** Structured finding from `FirmwareAdapter.validate()`. */
export type AdapterFindingSeverity = 'error' | 'warning' | 'info';

export interface AdapterFinding {
  readonly severity: AdapterFindingSeverity;
  readonly code: string;
  readonly message: string;
  readonly fix?: string;
}

export interface AdapterFindings {
  readonly findings: readonly AdapterFinding[];
}

/**
 * Handle to an in-progress streaming session, returned by
 * `FirmwareAdapter.stream()`. The session manages the protocol-
 * specific buffering and acknowledgement; the caller observes
 * progress via callbacks and can pause / resume / cancel.
 */
export interface StreamSession {
  /** Stable session id for correlation in support logs. */
  readonly sessionId: string;
  /**
   * Promise that resolves when streaming completes successfully
   * (the firmware acknowledged the final line) or rejects on
   * unrecoverable error.
   */
  readonly completed: Promise<void>;
  /** Cooperative cancel. The session resolves `completed` with a
   *  rejection naming the cancel reason. */
  cancel(reason: string): void;
  /** Pause the stream at the next safe boundary. */
  pause(): void;
  /** Resume from a previously-paused state. */
  resume(): void;
}

/** Fault event observed by the live controller (alarm, transport
 *  error, etc) that the adapter must translate into a recovery plan. */
export type MachineFaultKind =
  | 'alarm'                  // GRBL `ALARM:N`
  | 'transport-error'        // serial / wifi disconnect mid-stream
  | 'safety-off-failed'      // M5 / soft reset both failed
  | 'placement-uncertain'    // WCS query failed or G54 drifted
  | 'firmware-mismatch';     // capability snapshot diverged at start

export interface MachineFault {
  readonly kind: MachineFaultKind;
  readonly message: string;
  readonly observedAt: number; // unix-ms
}

/**
 * Structured recovery plan returned by `FirmwareAdapter.recover()`.
 * Each step is either user-facing (display + confirm) or automated
 * (the supervisor executes it). The plan composes to define what
 * the user must do before a new job can start.
 */
export type RecoveryStepKind =
  | 'inspect-machine'        // user: physically inspect head + material
  | 're-home'                // user OR auto: re-execute $H
  | 're-frame'               // user: re-run frame to confirm placement
  | 'clear-alarm'            // auto: `$X`
  | 'soft-reset'             // auto: 0x18
  | 'reconnect';             // user: disconnect + reconnect

export interface RecoveryStep {
  readonly kind: RecoveryStepKind;
  readonly required: boolean;
  readonly message: string;
}

export interface RecoveryPlan {
  readonly faultKind: MachineFaultKind;
  readonly steps: readonly RecoveryStep[];
  /** When false, the user MUST acknowledge every step before the
   *  next job can start. When true, the steps are advisory and the
   *  supervisor can authorize start after the auto steps run. */
  readonly advisoryOnly: boolean;
}

/**
 * The full adapter contract. A real firmware-support PR implements
 * EVERY method. The audit's framing: "firmware support must be a
 * complete package: planner constraints, output encoder, streaming
 * protocol, preflight rules, recovery semantics, capability
 * discovery."
 *
 * No production caller is wired to this YET (T1-192 is type-only).
 * The contract documents what a future `GrblAdapter` /
 * `MarlinAdapter` / `RuidaAdapter` MUST satisfy.
 */
export interface FirmwareAdapter {
  /** Stable id; used by ticket / registry. */
  readonly id: FirmwareAdapterId;

  /** Static capability advertisement. Called by compile gates. */
  capabilities(): FirmwareCapabilities;

  /** Planner constraints applied before emit. */
  compileConstraints(): PlannerConstraints;

  /**
   * Translate the canonical (Plan, Job) into a protocol-specific
   * OutputArtifact. Pure — no I/O, no global reads. Implementations
   * MUST attach `burnBounds` so downstream code can compare against
   * the plan's bounds (T1-188 invariant).
   */
  emit(plan: Plan, job: Job): Promise<OutputArtifact>;

  /**
   * Validate an OutputArtifact against the live machine identity.
   * Returns findings: errors block start, warnings prompt, info
   * appears in the confirm dialog (T1-183). Implementations check
   * `$30` / `$32` / bed-size mismatch and similar capability gates.
   */
  validate(output: OutputArtifact, live: LiveMachineIdentity): AdapterFindings;

  /**
   * Begin streaming the artifact to the live controller. Returns a
   * `StreamSession` whose `completed` promise tracks the run.
   * Implementations own protocol-specific buffering, acknowledgement,
   * and progress reporting.
   *
   * SECURITY CONTRACT: implementations MUST NOT bypass the operation
   * gate / mutex / recovery state. Streaming is permitted only when
   * the supervisor has authorized start.
   */
  stream(output: OutputArtifact): StreamSession;

  /**
   * Translate a fault event into a structured recovery plan. The
   * supervisor walks the plan, executing auto steps and prompting
   * the user for required steps before allowing a new job.
   */
  recover(event: MachineFault): RecoveryPlan;
}
