/**
 * T2-60: frame freshness invalidation key.
 *
 * Pre-T2-60 the `hasFramed` ref was reset only on (a) connect/disconnect
 * and (b) any scene mutation through the unified commit path
 * (`historyVersion`). That covered most cases but missed:
 *
 *   - startMode change (Bed → Head → Saved Origin) — frame motion
 *     reaches different physical positions per mode.
 *   - savedOrigin numeric change (user re-clicks Set Origin at a
 *     different location).
 *   - active profile change (different originCorner / bed size →
 *     different machine-space frame coordinates).
 *   - bed dimensions change (live `$130/$131` parsed from the
 *     controller after auto-detect, vs. the profile defaults).
 *   - originCorner change (the user toggled which corner the
 *     machine homes to via the Welcome Wizard).
 *
 * Each of those changes the frame path the laser would trace; the
 * previous frame motion no longer represents what the next burn
 * will do, so the frame-before-start gate (T1-59) must refuse Start
 * until a fresh frame.
 *
 * `computeFrameFreshnessKey` produces a stable string key from those
 * inputs. The `ConnectionPanelMain` wires this into a `useEffect`
 * dep array; any change to the key resets `hasFramed.current` and
 * bumps `workflowVersion`. Pure function — no React, no storage —
 * tested with arbitrary input shapes.
 *
 * The key is a deterministic concat with separators, not a real hash:
 * input space is small (six fields), the only consumer is identity
 * comparison, and this avoids pulling in a hash dependency. Numbers
 * are rounded to 1 µm so floating-point noise doesn't cause spurious
 * invalidation (a profile import that re-serializes 300.0 as
 * 299.9999999 mustn't bust the key).
 */
import type { GcodeStartMode } from '../core/output/GcodeOrigin';
import type { MachineOriginCorner } from '../core/devices/DeviceProfile';

export interface FrameFreshnessInputs {
  startMode: GcodeStartMode;
  savedOriginX: number | null;
  savedOriginY: number | null;
  profileId: string | null;
  bedWidth: number;
  bedHeight: number;
  originCorner: MachineOriginCorner;
  /** ValidatedJobTicket id from the latest compile, or null pre-compile. */
  compiledTicketId: string | null;
}

const ROUND = 1000; // 1 µm

function r(n: number | null): string {
  if (n == null) return '_';
  if (!Number.isFinite(n)) return '_';
  return String(Math.round(n * ROUND) / ROUND);
}

export function computeFrameFreshnessKey(inputs: FrameFreshnessInputs): string {
  return [
    inputs.startMode,
    r(inputs.savedOriginX),
    r(inputs.savedOriginY),
    inputs.profileId ?? '_',
    r(inputs.bedWidth),
    r(inputs.bedHeight),
    inputs.originCorner,
    inputs.compiledTicketId ?? '_',
  ].join('|');
}
