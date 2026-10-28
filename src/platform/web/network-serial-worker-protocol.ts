// Messages between the window and the worker that streams a desktop network
// session (ADR-675). The desktop main process owns the TCP socket; the window
// opens the session, then hands its id to this worker, which reads and writes
// it through the same app:// routes the window would use. So the refill no
// longer waits for the window's thread, as on a USB port (ADR-354).

import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';

export type NetworkSessionRoute = { readonly url: string; readonly header: string };

/** How long the worker's first read may take before it answers
 * `network-unavailable`; the window waits a little longer for that answer. */
export const NETWORK_ATTACH_READ_TIMEOUT_MS = 2_500;

export type NetworkSerialWorkerRequest =
  | Exclude<SerialWorkerRequest, { readonly kind: 'attach' | 'reattach-readable' }>
  /** Take the session. The worker's first read proves it can reach the route
   *  before the window gives up its own path to the session. */
  | {
      readonly kind: 'network-attach';
      readonly id: number;
      readonly sessionId: string;
      readonly route: NetworkSessionRoute;
    }
  /** Begin forwarding lines; sent once the window has subscribed. */
  | { readonly kind: 'network-start' };

export type NetworkSerialWorkerResponse =
  | SerialWorkerResponse
  /** The first read succeeded; the session is the worker's from here. */
  | { readonly kind: 'network-ready'; readonly id: number }
  /** The first read failed cleanly: nothing was read, so the window can
   *  stream the session itself. */
  | { readonly kind: 'network-unavailable'; readonly id: number; readonly reason: string };
