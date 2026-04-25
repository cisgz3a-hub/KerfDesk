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
  readonly gcodeLines: readonly string[];
  readonly gcodeText: string;
  readonly machinePlanBounds: AABB;
  readonly machineTransform: MachineTransformResult;
  readonly controllerType: ControllerId;
  readonly startMode: GcodeStartMode;
  readonly savedOrigin: { readonly x: number; readonly y: number } | null;
  readonly createdAt: number;
}
