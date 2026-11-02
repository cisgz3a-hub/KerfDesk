// origin-status-fence — which status reports predate the last origin write.
//
// A report the controller sent before it applied a G92 or G10 still describes
// the old work frame: its WPos is measured from the old offset and its WCO is
// the old offset. Only MPos is the same in both frames. The idle poll runs
// about once a second, so for up to a second after Set origin, Reset origin or
// Restore origin the stored report is that old one. A Frame pressed then took
// its return point from it and sent the head the whole offset astray, and on
// `$10=0` (WPos only) a Current Position job burned the offset away from the
// head (rolling audit v9 R8-P1-1).
//
// GRBL-family firmware executes a line before it answers `ok` and writes its
// replies in order, so every report read after the origin line's `ok` shows
// the new origin, and every report read before it may not. The origin
// transaction records the status sequence at that acknowledgement (the fence)
// and keeps only the origin-free part of a report that predates it. Frame
// waits for a report past the fence before taking a position from it.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L102-L104

import type { LaserState } from './laser-store';

type FenceEvidence = Pick<LaserState, 'statusSequence' | 'originStatusFence'>;

/** True while the newest report was read before the last origin write was
 *  acknowledged, so its work position belongs to the old origin. */
export function statusPredatesOriginChange(laser: FenceEvidence): boolean {
  const fence = laser.originStatusFence ?? null;
  return fence !== null && laser.statusSequence <= fence;
}

/** The patch an acknowledged origin write adds: the fence, and the stored
 *  report reduced to its machine position while it predates the fence. A
 *  report the write's own patch replaces or clears is left to that patch. */
export function originStatusFencePatch(
  state: LaserState,
  patch: Partial<LaserState>,
  fence: number,
): Partial<LaserState> {
  const fencePatch: Partial<LaserState> = { originStatusFence: fence };
  if ('statusReport' in patch || state.statusSequence > fence) return fencePatch;
  const report = state.statusReport;
  if (report === null || (report.wPos === null && report.wco === null)) return fencePatch;
  return { ...fencePatch, statusReport: { ...report, wPos: null, wco: null } };
}
