// What a jog, Frame or move control says before any status report. With no
// machine connected nothing will report, so "wait for Idle" would leave a
// beginner stuck; it says to connect instead (UX audit U1-P2-4). Wording only:
// both answers block the command.

export const CONNECT_MACHINE_FIRST = 'Connect your machine first.';
export const UNKNOWN_IDLE_STATUS_MESSAGE =
  'Controller status is not known yet. Wait for an Idle status report before jogging or framing.';

export function noStatusReportMessage(state: {
  readonly connection: { readonly kind: string };
}): string {
  return state.connection.kind === 'connected'
    ? UNKNOWN_IDLE_STATUS_MESSAGE
    : CONNECT_MACHINE_FIRST;
}
