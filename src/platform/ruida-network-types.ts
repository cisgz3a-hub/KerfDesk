// The Ruida UDP link the desktop platform offers (ADR-697), kept beside
// types.ts, whose PlatformAdapter carries it as `ruidaNetwork`.

/** One open Ruida UDP link (ADR-697): datagrams to the controller's port 50200,
 * replies from it. Delivery is never retried here; the session above decides. */
export type RuidaDatagramLink = {
  /** Sends one framed datagram. Rejects when the link is closed or the send
   * could not be handed to the OS; never resent. */
  readonly send: (datagram: Uint8Array) => Promise<void>;
  /** Every datagram the controller sends, in arrival order. */
  readonly onDatagram: (handler: (datagram: Uint8Array) => void) => () => void;
  /** Once, when the link closes for any reason; `reason` when it failed. */
  readonly onClose: (handler: (reason?: string) => void) => () => void;
  readonly close: () => Promise<void>;
};

export type RuidaNetworkAdapter = {
  /** Explicit private-network IPv4 address; no discovery, no auto-reconnect.
   * `magic` is the controller's swizzle magic, for the stop the desktop sends
   * on a session its window can no longer reach. */
  readonly open: (host: string, magic: number) => Promise<RuidaDatagramLink>;
  /** Calls `expire` after `ms` of time this thread was running, so a stalled
   * window does not read its own stall as a silent controller. */
  readonly deadline: (ms: number, expire: () => void) => () => void;
};
