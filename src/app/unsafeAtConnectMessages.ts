/**
 * T3-91 (T1-25 follow-up): reason -> user-facing message mapping for
 * the unsafe-at-connect inline banner and matching preflight copy.
 *
 * This lives outside src/ui because the recovery labels deliberately name
 * concrete GRBL recovery commands. UI components render the messages, but
 * machine-command wording belongs with the app/controller boundary.
 */
import type { UnsafeAtConnectReason } from '../controllers/grbl/GrblController';

export type UnsafeAtConnectActionKind = 'reset' | 'reconnect' | 'm5';

export interface UnsafeAtConnectMessage {
  readonly headline: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly actionKind: UnsafeAtConnectActionKind;
}

export function describeUnsafeAtConnect(
  reason: UnsafeAtConnectReason,
): UnsafeAtConnectMessage {
  switch (reason) {
    case 'alarm':
      return {
        headline: 'Controller in alarm state from previous session',
        detail:
          'GRBL is reporting an alarm. Job start, frame, jog, and test-fire are blocked until the alarm clears. Inspect the machine for limit-switch contact, jam, or unexpected obstruction; then unlock to continue.',
        actionLabel: 'Reset machine',
        actionKind: 'reset',
      };
    case 'run':
      return {
        headline: 'Controller still running a previous job',
        detail:
          'GRBL reports the controller is mid-motion. The host did not initiate this run, so this is a stale state from before connect. Disconnect and reconnect once motion stops.',
        actionLabel: 'Reconnect',
        actionKind: 'reconnect',
      };
    case 'hold':
      return {
        headline: 'Controller in feed-hold state from previous session',
        detail:
          'GRBL reports a paused job from before this connect. The host has no record of the job and cannot safely resume. Reset the controller and reconnect to clear the held state.',
        actionLabel: 'Reconnect',
        actionKind: 'reconnect',
      };
    case 'door':
      return {
        headline: 'Safety interlock open',
        detail:
          'GRBL is reporting the door / lid / e-stop interlock as active. Job start, frame, jog, and test-fire are blocked until the interlock clears. Close the door (or release the e-stop) and wait for the controller to return to idle, then reconnect.',
        actionLabel: 'Reconnect',
        actionKind: 'reconnect',
      };
    case 'check':
      return {
        headline: 'Controller in check mode',
        detail:
          'GRBL is in `$C` check mode - motion is parsed but not executed. LaserForge cannot run real jobs until check mode is disabled. Reset the controller and reconnect to leave check mode.',
        actionLabel: 'Reconnect',
        actionKind: 'reconnect',
      };
    case 'no-status-response':
      return {
        headline: 'Controller did not respond to status query',
        detail:
          'The connect handshake timed out waiting for a `?` status report. The cable may be disconnected, the firmware wedged, or the device may not be GRBL. Disconnect and reconnect; if the problem persists, power-cycle the controller.',
        actionLabel: 'Reconnect',
        actionKind: 'reconnect',
      };
    case 'unsafe-residual-spindle':
      return {
        headline: 'Laser still on from previous session',
        detail:
          'GRBL reports idle, but the spindle / laser is still emitting power (FS reported a non-zero S or feed). The previous session ended without an `M5`. Send `M5 S0` to extinguish the laser before continuing.',
        actionLabel: 'Send M5 S0',
        actionKind: 'm5',
      };
  }
}
