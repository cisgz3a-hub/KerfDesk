/**
 * Execution contract for compiled jobs (phase 1: constructed at compile time;
 * later phases gate streaming against this ticket).
 */

import type { MachineTransformResult } from '../plan/MachineTransform';
import type { AABB } from '../types';
import type { GcodeStartMode } from '../output/GcodeOrigin';
import type { ControllerId } from '../../controllers/ControllerRegistry';

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
  readonly gcodeLines: readonly string[];
  readonly gcodeText: string;
  readonly machinePlanBounds: AABB;
  readonly machineTransform: MachineTransformResult;
  readonly controllerType: ControllerId;
  readonly startMode: GcodeStartMode;
  readonly savedOrigin: { readonly x: number; readonly y: number } | null;
  readonly createdAt: number;
}
