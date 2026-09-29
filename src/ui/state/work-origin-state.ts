// work-origin-state — the store's XY work-origin fields, split from
// laser-store.ts at its 400-line cap, and the origin a connection found on the
// controller instead of setting it (controller audit 2, M-4, ADR-375).
//
// An origin can be on the controller before KerfDesk sets one: grblHAL keeps
// a G92 (Set origin here) through a reset and, unless `$384=1`, saves it and
// restores it at power-up, and every GRBL-family controller keeps a saved G54.
// Machine position starts at zero at power-up, so until the machine is homed
// such an origin sits relative to wherever the head stood then, which need not
// be where it was set. The first work-offset report of a connection shows it.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L833-L838
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/grbllib.c#L358

import type { LaserState, WorkOriginSource } from './laser-store';
import type { WorkCoordinateOffset } from './origin-actions';

/** What the first accepted work-offset report of a connection showed. */
export type OriginAtConnect = {
  /** The connect attempt it belongs to (`connectionAttempt`). */
  readonly connectionAttempt: number;
  /** `workOriginVersion` then; every origin action moves it on. */
  readonly workOriginVersion: number;
  /** The XY offset, in report units, of an origin the controller already
   *  applied while KerfDesk had set none; null when there was none. */
  readonly restoredXy: { readonly x: number; readonly y: number } | null;
};

export type WorkOriginState = {
  readonly workOriginActive: boolean;
  readonly workOriginSource: WorkOriginSource;
  // Monotonic identity for XY work-origin mutations. Place Board registration
  // binds to this so a later G92/G92.1/G10 cannot silently reuse stale targets.
  readonly workOriginVersion?: number;
  /** Optional so hand-built test states stay valid; absent reads as unseen. */
  readonly originAtConnect?: OriginAtConnect | null;
};

type OriginAtConnectEvidence = Pick<
  LaserState,
  | 'originAtConnect'
  | 'connectionAttempt'
  | 'workOriginActive'
  | 'workOriginSource'
  | 'workOriginVersion'
>;

/** Records what the connection's first accepted work-offset report showed;
 *  later reports, a reset's re-learned offset included, change nothing. */
export function originAtConnectPatch(
  state: OriginAtConnectEvidence,
  originActive: boolean,
  wco: WorkCoordinateOffset,
): Partial<Pick<LaserState, 'originAtConnect'>> {
  const connectionAttempt = state.connectionAttempt ?? 0;
  if (state.originAtConnect?.connectionAttempt === connectionAttempt) return {};
  const found = originActive && state.workOriginSource === 'none';
  return {
    originAtConnect: {
      connectionAttempt,
      workOriginVersion: state.workOriginVersion ?? 0,
      restoredXy: found ? { x: wco.x, y: wco.y } : null,
    },
  };
}

/** The XY origin in effect is the one the controller had when this connection
 *  began: no origin action since, and the controller still reports the same
 *  XY offset, so one a Console G92 or G10 moved no longer counts. */
export function isRestoredWorkOrigin(
  state: OriginAtConnectEvidence & Pick<LaserState, 'wcoCache'>,
): boolean {
  const found = state.originAtConnect;
  if (found == null || !state.workOriginActive) return false;
  if (found.connectionAttempt !== (state.connectionAttempt ?? 0)) return false;
  if (found.workOriginVersion !== (state.workOriginVersion ?? 0)) return false;
  return sameXy(found.restoredXy, state.wcoCache);
}

function sameXy(
  a: { readonly x: number; readonly y: number } | null,
  b: { readonly x: number; readonly y: number } | null,
): boolean {
  return a !== null && b !== null && a.x === b.x && a.y === b.y;
}
