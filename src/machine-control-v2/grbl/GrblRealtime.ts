export const GRBL_REALTIME = {
  feedHold: '!',
  cycleStart: '~',
  statusPoll: '?',
  softReset: String.fromCharCode(0x18),
  jogCancel: String.fromCharCode(0x85),
} as const;
