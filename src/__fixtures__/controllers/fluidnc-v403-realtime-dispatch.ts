const HIGH_BYTE_START = 0x80;
const PIN_ACK = 0xb2;
const PIN_NAK = 0xb3;
const PIN_RESET = 0xb4;
const PIN_LOW_FIRST = 0x100;
const PIN_LOW_LAST = 0x13f;
const PIN_HIGH_FIRST = 0x140;
const PIN_HIGH_LAST = 0x17f;
const REALTIME_COMMAND = {
  reset: 0x18,
  statusReport: 0x3f,
  cycleStart: 0x7e,
  feedHold: 0x21,
  safetyDoor: 0x84,
  jogCancel: 0x85,
  debugReport: 0x86,
  macro0: 0x87,
  macro1: 0x88,
  macro2: 0x89,
  macro3: 0x8a,
  feedOverrideReset: 0x90,
  feedOverrideCoarsePlus: 0x91,
  feedOverrideCoarseMinus: 0x92,
  feedOverrideFinePlus: 0x93,
  feedOverrideFineMinus: 0x94,
  rapidOverrideReset: 0x95,
  rapidOverrideMedium: 0x96,
  rapidOverrideLow: 0x97,
  rapidOverrideExtraLow: 0x98,
  spindleOverrideReset: 0x99,
  spindleOverrideCoarsePlus: 0x9a,
  spindleOverrideCoarseMinus: 0x9b,
  spindleOverrideFinePlus: 0x9c,
  spindleOverrideFineMinus: 0x9d,
  spindleOverrideStop: 0x9e,
  coolantFloodToggle: 0xa0,
  coolantMistToggle: 0xa1,
} as const;

/** Handler identity for a decoded command in the pinned FluidNC channel. */
export type FluidncV403RealtimeDispatch =
  | 'reset-event'
  | 'status-report-direct'
  | 'cycle-start-event'
  | 'feed-hold-event'
  | 'safety-door-event'
  | 'motion-cancel-event-if-jogging'
  | 'debug-event'
  | 'macro-0-event'
  | 'macro-1-event'
  | 'macro-2-event'
  | 'macro-3-event'
  | 'feed-override-reset-event'
  | 'feed-override-coarse-plus-event'
  | 'feed-override-coarse-minus-event'
  | 'feed-override-fine-plus-event'
  | 'feed-override-fine-minus-event'
  | 'rapid-override-reset-event'
  | 'rapid-override-medium-event'
  | 'rapid-override-low-event'
  | 'rapid-override-extra-low-event'
  | 'spindle-override-reset-event'
  | 'spindle-override-coarse-plus-event'
  | 'spindle-override-coarse-minus-event'
  | 'spindle-override-fine-plus-event'
  | 'spindle-override-fine-minus-event'
  | 'spindle-override-stop-event'
  | 'coolant-flood-toggle-event'
  | 'coolant-mist-toggle-event'
  | 'pin-ack-channel-control'
  | 'pin-nak-channel-control'
  | 'pin-reset-channel-control'
  | 'pin-low-channel-event'
  | 'pin-high-channel-event'
  | 'undefined-no-op';

const REALTIME_COMMAND_DISPATCHES = new Map<number, FluidncV403RealtimeDispatch>([
  [REALTIME_COMMAND.reset, 'reset-event'],
  [REALTIME_COMMAND.statusReport, 'status-report-direct'],
  [REALTIME_COMMAND.cycleStart, 'cycle-start-event'],
  [REALTIME_COMMAND.feedHold, 'feed-hold-event'],
  [REALTIME_COMMAND.safetyDoor, 'safety-door-event'],
  [REALTIME_COMMAND.jogCancel, 'motion-cancel-event-if-jogging'],
  [REALTIME_COMMAND.debugReport, 'debug-event'],
  [REALTIME_COMMAND.macro0, 'macro-0-event'],
  [REALTIME_COMMAND.macro1, 'macro-1-event'],
  [REALTIME_COMMAND.macro2, 'macro-2-event'],
  [REALTIME_COMMAND.macro3, 'macro-3-event'],
  [REALTIME_COMMAND.feedOverrideReset, 'feed-override-reset-event'],
  [REALTIME_COMMAND.feedOverrideCoarsePlus, 'feed-override-coarse-plus-event'],
  [REALTIME_COMMAND.feedOverrideCoarseMinus, 'feed-override-coarse-minus-event'],
  [REALTIME_COMMAND.feedOverrideFinePlus, 'feed-override-fine-plus-event'],
  [REALTIME_COMMAND.feedOverrideFineMinus, 'feed-override-fine-minus-event'],
  [REALTIME_COMMAND.rapidOverrideReset, 'rapid-override-reset-event'],
  [REALTIME_COMMAND.rapidOverrideMedium, 'rapid-override-medium-event'],
  [REALTIME_COMMAND.rapidOverrideLow, 'rapid-override-low-event'],
  [REALTIME_COMMAND.rapidOverrideExtraLow, 'rapid-override-extra-low-event'],
  [REALTIME_COMMAND.spindleOverrideReset, 'spindle-override-reset-event'],
  [REALTIME_COMMAND.spindleOverrideCoarsePlus, 'spindle-override-coarse-plus-event'],
  [REALTIME_COMMAND.spindleOverrideCoarseMinus, 'spindle-override-coarse-minus-event'],
  [REALTIME_COMMAND.spindleOverrideFinePlus, 'spindle-override-fine-plus-event'],
  [REALTIME_COMMAND.spindleOverrideFineMinus, 'spindle-override-fine-minus-event'],
  [REALTIME_COMMAND.spindleOverrideStop, 'spindle-override-stop-event'],
  [REALTIME_COMMAND.coolantFloodToggle, 'coolant-flood-toggle-event'],
  [REALTIME_COMMAND.coolantMistToggle, 'coolant-mist-toggle-event'],
]);

const CHANNEL_CONTROL_DISPATCHES = new Map<number, FluidncV403RealtimeDispatch>([
  [PIN_ACK, 'pin-ack-channel-control'],
  [PIN_NAK, 'pin-nak-channel-control'],
  [PIN_RESET, 'pin-reset-channel-control'],
]);

/** Classifies bytes intercepted by pinned FluidNC v4.0.3 before Lineedit. */
export function isFluidncV403RealtimeByte(byte: number): boolean {
  return (
    byte >= HIGH_BYTE_START ||
    byte === REALTIME_COMMAND.reset ||
    byte === REALTIME_COMMAND.statusReport ||
    byte === REALTIME_COMMAND.cycleStart ||
    byte === REALTIME_COMMAND.feedHold
  );
}

/**
 * Names the pinned handler for one decoded realtime command without simulating
 * controller state, asynchronous execution, or physical effects.
 */
export function fluidncV403RealtimeDispatch(command: number): FluidncV403RealtimeDispatch {
  const channelControl = CHANNEL_CONTROL_DISPATCHES.get(command);
  if (channelControl !== undefined) return channelControl;
  if (command >= PIN_LOW_FIRST && command < PIN_LOW_LAST) return 'pin-low-channel-event';
  if (command >= PIN_HIGH_FIRST && command < PIN_HIGH_LAST) return 'pin-high-channel-event';
  return REALTIME_COMMAND_DISPATCHES.get(command & 0xff) ?? 'undefined-no-op';
}
