/**
 * Execution contract for compiled jobs (phase 1: constructed at compile time;
 * later phases gate streaming against this ticket).
 */

import type { MachineTransformResult } from '../plan/MachineTransform';
import type { AABB } from '../types';
import type { GcodeStartMode } from '../output/GcodeOrigin';
import type { ControllerId } from '../../controllers/ControllerRegistry';
import type { BurnEnvelopeDivergenceReport } from '../output/burnEnvelopeDivergence';
import type { SpoolHandle } from '../output/GcodeStreaming';
import type { JobFingerprint } from './JobFingerprint';

/**
 * Collision-resistant fingerprint of inputs that produced a compiled G-code
 * artifact. Used to detect mismatches between what preflight validated and
 * what is about to execute — not a security primitive.
 */
export interface ValidatedJobTicket {
  readonly ticketId: string;
  readonly sceneHash: string;
  readonly profileHash: string;
  readonly gcodeHash: string;
  /**
   * T1-246: full compile/runtime fingerprint embedded in the ticket
   * and revalidated by `MachineService.startValidatedJob`. This is the
   * service-level stale-output gate: changes to start mode, saved
   * origin, controller capability inputs ($30 / bed / origin), or
   * compile options refuse Start before any G-code streams.
   */
  readonly fingerprint: JobFingerprint;
  /**
   * T1-181 (external audit High #1 + #3): determinism gate.
   * Hash of the entitlement-policy snapshot read at compile time
   * (the 6 boolean feature flags from `canUseFeature`). The
   * validator recomputes the live hash at start time and refuses
   * if the entitlement state changed since compile — without this
   * hash, a license-state flip between compile and start could
   * silently change the running G-code's feature semantics
   * (e.g. tabs dropped at compile when the license expired,
   * license restored before start, user thinks tabs are active).
   */
  readonly entitlementPolicyHash: string;
  /**
   * T1-181: hash of every material preset referenced by any scene
   * layer at compile time. Covers the preset's full definition (not
   * just ID) so a preset MUTATION between compile and start is
   * detected. Without this hash, editing a material preset's power
   * curve between compile and start would silently change the
   * running G-code's burn characteristics.
   */
  readonly materialPresetsHash: string;
  /**
   * T1-182 (external audit High #2 + #8): burn envelope derived
   * from the EMITTED gcode (not from the upstream `Plan`). The
   * audit's framing was "the user may approve a preview that is
   * not the actual program" — the preview consumes `Plan`, but
   * footer return motion / template g-code / modal quirks could
   * make the emitted bytes' burn region differ from the plan's.
   * This field is the canonical post-emission burn AABB, derived
   * from the emitted G-code stream/spool. `null` when the emission
   * contained no burn moves (a degenerate / empty job).
   * Wiring the preview UI to consume this is deferred — this field
   * makes the data available for future consumers (validators,
   * support diagnostics, preview rebuild).
   */
  readonly emittedBurnBounds: AABB | null;
  /**
   * T1-188 (external audit High #2 + #8 wiring): compile-time
   * consistency report between the plan-derived burn envelope and
   * the emitted-gcode burn envelope. `null` when they agree within
   * tolerance (0.5 mm per AABB edge); otherwise a structured report
   * carrying the mismatch kind + deltas + move counts so support
   * tooling can diagnose encoder regressions.
   */
  readonly burnEnvelopeDivergence: BurnEnvelopeDivergenceReport | null;
  /**
   * T3-15 first production boundary: replayable G-code stream handle.
   *
   * During the transition this coexists with legacy `gcodeText` /
   * `gcodeLines`; consumers can start moving to `open()` without
   * forcing the controller migration in the same patch. Once the GRBL
   * sender, simulator fan-out, validators, and replay capture consume
   * the spool directly, the legacy full-text/full-array fields can be
   * retired.
   */
  readonly gcodeSpool?: SpoolHandle;
  readonly gcodeLines: readonly string[];
  readonly gcodeText: string;
  readonly machinePlanBounds: AABB;
  readonly machineTransform: MachineTransformResult;
  readonly controllerType: ControllerId;
  readonly startMode: GcodeStartMode;
  readonly savedOrigin: { readonly x: number; readonly y: number } | null;
  readonly createdAt: number;
}
