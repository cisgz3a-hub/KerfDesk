/**
 * T1-153: pure type definitions for the GRBL "unsafe at connect"
 * state — the snapshot the controller captures at first status
 * report (or watchdog timeout) after a connect handshake. Pre-T1-153
 * these types lived in GrblController.ts and were imported back via
 * `import type { UnsafeAtConnectReason } from './GrblController'`
 * from `GrblSafeStateClassifier`, `unsafeAtConnectMessages`, and
 * `UnsafeAtConnectBanner`. That meant the safe-state classifier
 * pulled the 2500-line controller's type surface just to get a 6-
 * member union.
 *
 * Hoisting to a sibling type module breaks the type-side circular
 * dependency. GrblController re-exports the types so existing
 * `import { UnsafeAtConnectReason } from './GrblController'`
 * callers keep working unchanged.
 *
 * Type-only module — no runtime exports. `import type` from it costs
 * zero at runtime.
 */
import type { MachineStatus } from '../ControllerInterface';

/**
 * T1-25: reasons the controller's first post-connect status report
 * can mark the machine unsafe to operate. A non-null verdict from
 * `getUnsafeAtConnect()` causes the UI to refuse job start, frame,
 * jog, and test-fire (the spec's "machineControlAllowed: false").
 *
 * - alarm: hardware alarm; `$X` unlock required.
 * - run: head was moving when we connected; let it finish.
 * - hold: feed-hold engaged; release with `~`.
 * - door (T1-followup-safety-door): door / lid interlock open.
 *   Treated like alarm/hold — recovery is "close door / release
 *   e-stop", not `$X`.
 * - check: GRBL check-mode active.
 * - no-status-response: status-report watchdog timed out.
 * - unsafe-residual-spindle: idle but FS reports non-zero spindle
 *   or feed.
 */
export type UnsafeAtConnectReason =
  | 'alarm'
  | 'run'
  | 'hold'
  | 'door'
  | 'check'
  | 'no-status-response'
  | 'unsafe-residual-spindle';

/**
 * T1-25: snapshot of the controller's state captured at the first
 * status report after connect (or at watchdog timeout). A null
 * value from `getUnsafeAtConnect()` means the safe-state handshake
 * passed (idle + FS 0,0). A non-null value means job start, frame,
 * jog, and test-fire must be refused by the UI / preflight layer
 * until the user acknowledges and reconnects.
 */
export interface UnsafeAtConnectState {
  reason: UnsafeAtConnectReason;
  capturedAt: number;
  status: MachineStatus;
  alarmCode: number | null;
  feedRate: number;
  spindleSpeed: number;
}
