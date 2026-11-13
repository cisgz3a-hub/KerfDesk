// Types of the Lihuiyu USB store (ADR-703).

import type { LhyBoardSetting } from '../../../core/controllers/lihuiyu/lhy-encoder';
import type { LhyFootprint } from '../../../core/controllers/lihuiyu/lhy-frame';
import type { LhyChannel } from '../../../core/controllers/lihuiyu/lhy-link';
import type { LinkJobOutcome } from '../link-job-outcome';
import type { LhyPoint } from '../../../core/controllers/lihuiyu/lhy-motion-plan';

/** An open board: the EPP channel and the USB session's lifecycle. */
export type LihuiyuUsbConnection = {
  readonly channel: LhyChannel;
  readonly label: string;
  readonly onDisconnect: (handler: () => void) => () => void;
  readonly close: () => Promise<void>;
};

/** Opens a board (the chooser, then the CH341 bridge); null when none was chosen. */
export type LihuiyuUsbOpener = () => Promise<LihuiyuUsbConnection | null>;

export type LihuiyuUsbPhase =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'homing'
  | 'jogging'
  | 'framing'
  | 'running'
  | 'paused'
  | 'stopping';

/** A compiled job: the exact stream Start sends, and where it runs; its
 *  warnings and completion come from linkJobOutcome (ADR-705 Amendment 7). */
export type LihuiyuUsbJob = LinkJobOutcome & {
  readonly stream: Uint8Array;
  readonly footprint: LhyFootprint;
  /** Machine coordinates from home; the head must be known (after Home). */
  readonly absolute: boolean;
  readonly board: LhyBoardSetting;
  readonly framingMmPerMin: number;
};

export type LihuiyuUsbFramed = { readonly footprint: LhyFootprint; readonly absolute: boolean };

export type LihuiyuUsbState = {
  readonly phase: LihuiyuUsbPhase;
  readonly label: string | null;
  readonly message: string;
  readonly tone: 'info' | 'warning' | 'error';
  readonly statusCode: number | null;
  /** The head in 1/1000 in steps from home; null until Home, and after Abort. */
  readonly head: LhyPoint | null;
  /** The footprint the last completed Frame on this connection traced. */
  readonly framed: LihuiyuUsbFramed | null;
  /** Packets confirmed of the total while a job or frame is being sent. */
  readonly sending: { readonly sent: number; readonly total: number } | null;
  readonly advisories: ReadonlyArray<string>;
  readonly connect: (
    open: LihuiyuUsbOpener,
    pause?: (ms: number) => Promise<void>,
  ) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly home: () => Promise<void>;
  readonly jog: (dxMm: number, dyMm: number) => Promise<void>;
  readonly frame: (job: LihuiyuUsbJob) => Promise<void>;
  readonly start: (job: LihuiyuUsbJob) => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly abort: () => Promise<void>;
};
