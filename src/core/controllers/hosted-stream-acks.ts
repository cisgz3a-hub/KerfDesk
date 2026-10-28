/** The reply grammar a worker-hosted refill reads (ADR-675): GRBL's `ok` /
 * `error:N` / `ALARM:N`, or Marlin's ping-pong `ok` (marlin/hosted-refill.ts).
 * The store names it each time it arms the refill. */
export type HostedStreamAcks = 'grbl' | 'marlin';
