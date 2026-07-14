import type { ControllerKind } from '../../core/devices';

export type TerminalResponseOwnership = 'owned' | 'ambiguous' | 'unexpected' | 'not-monitored';

export type TerminalResponseOwnershipInput = {
  readonly controllerKind: ControllerKind;
  readonly responseKind: string;
  readonly streamInFlight: number;
  readonly pendingUntrackedAcks: number;
  readonly pendingTransportWrites: number;
  readonly controllerCommandConsumed: boolean;
  readonly autofocusBusy: boolean;
};

const MONITORED_CONTROLLERS: ReadonlySet<ControllerKind> = new Set([
  'grbl-v1.1',
  'grblhal',
  'fluidnc',
]);

export function classifyTerminalResponseOwnership(
  input: TerminalResponseOwnershipInput,
): TerminalResponseOwnership {
  if (!MONITORED_CONTROLLERS.has(input.controllerKind)) return 'not-monitored';
  if (input.responseKind !== 'ok' && input.responseKind !== 'error') return 'not-monitored';
  if (
    input.streamInFlight > 0 ||
    input.pendingUntrackedAcks > 0 ||
    input.controllerCommandConsumed ||
    input.autofocusBusy
  ) {
    return 'owned';
  }
  // A response can arrive before the transport Promise settles. Without a
  // reserved ack token, that window is evidence of uncertainty, not proof
  // that another sender owns the controller.
  if (input.pendingTransportWrites > 0) return 'ambiguous';
  return 'unexpected';
}
