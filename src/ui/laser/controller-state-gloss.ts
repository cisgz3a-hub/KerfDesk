// Plain words beside a GRBL hold state. KerfDesk's own Pause sends the
// safety-door byte so the beam goes dark (ADR-212), so a beginner with no door
// saw "Door:0" and wondered what had opened (UX audit U4-P3-1). Substates are
// grbl 1.1's: Door:0 closed and ready to resume, Door:1 stopped with the door
// still ajar, Door:2 opened and stopping, Door:3 closed and restoring; Hold:0
// complete, Hold:1 in progress.

export function controllerStateGloss(
  state: string,
  subState: number | null,
  machineKind: 'laser' | 'cnc',
): string | null {
  const off = machineKind === 'cnc' ? 'spindle off' : 'laser off';
  if (state === 'Door') {
    switch (subState) {
      case 0:
        return `paused, ${off}, ready to resume`;
      case 1:
        return `paused, ${off}; a door or lid input is still open`;
      case 2:
        return `stopping, ${off}`;
      case 3:
        return 'resuming';
      default:
        return `paused, ${off}`;
    }
  }
  if (state === 'Hold') return subState === 1 ? 'pausing' : 'paused, ready to resume';
  return null;
}
