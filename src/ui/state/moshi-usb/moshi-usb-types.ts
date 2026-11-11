// What the Moshi USB store (ADR-705) drives: an open CH341 EPP link to the
// board, and the compiled job it sends. The link is built from the shared USB
// foundation (ADR-702) by moshi-usb-link.ts; tests hand the store the scripted
// board directly.

import type { MoshiFootprint } from '../../../core/controllers/moshi/moshi-frame';
import type { MoshiEppPort } from '../../../core/controllers/moshi/moshi-link-session';

export type MoshiUsbConnection = MoshiEppPort & {
  /** What the panel names the device by (e.g. "CH341 chip version 48"). */
  readonly label: string;
  /** Once, when the device goes away (unplugged, or the OS took it). */
  readonly onDisconnect: (handler: () => void) => () => void;
  readonly close: () => Promise<void>;
};

/** Asks for the board (a device picker the first time) and opens it. */
export type MoshiUsbOpener = () => Promise<MoshiUsbConnection>;

/** A compiled job: the exact programs Start sends, and where they run. */
export type MoshiUsbJob = {
  readonly programs: ReadonlyArray<Uint8Array>;
  readonly footprint: MoshiFootprint;
  readonly advisories: ReadonlyArray<string>;
  /** The profile's framing feed (mm/min), for the Frame program. */
  readonly framingFeedMmPerMin: number;
  /** Runs once the board reports the job finished (variable advance). */
  readonly completed?: () => void;
};
