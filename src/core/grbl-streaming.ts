export const DEFAULT_GRBL_RX_BUFFER_BYTES = 120;
export const MAX_GRBL_RX_BUFFER_BYTES = 4096;
// grblHAL's core falls back to a 1024-byte serial receive ring (grblHAL/core
// stream.h: `#ifndef RX_BUFFER_SIZE / #define RX_BUFFER_SIZE 1024`), eight times
// stock GRBL's 128. Streaming a grblHAL controller through the stock 120-byte
// window leaves only ~8 raster lines in flight, so any host or USB round trip
// longer than those few milliseconds of motion can drain the planner and stop
// the machine mid-burn (simulator-shown, ADR-331). A grblHAL profile therefore
// requests this window; the Start boundary still bounds it by the capacity the
// controller itself reports, so a build with a smaller ring narrows the window
// instead of overflowing it.
export const GRBLHAL_DEFAULT_RX_BUFFER_BYTES = 1024;
// Headroom kept below a controller-reported receive capacity — the same 8-byte
// margin CNCjs keeps under stock GRBL's 128-byte ring (120 usable), so a stock
// `Bf:15,128` report resolves to exactly the historical default window.
export const RX_WINDOW_SAFETY_MARGIN_BYTES = 8;
// A reported receive capacity above this is not a ring size KerfDesk can use.
// grblHAL prints its stream's free count as a uint16, so 65535 is just the
// largest value the field holds (a Falcon A1 Pro idles at `Bf:512,65535`), and
// a stream may report a fixed size whatever its buffer holds
// (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L1342-L1347,
// stream.h#L211-L214, stream.c#L865-L868). Such a report proves no more than
// grblHAL's default 1024-byte ring (stream.h#L52-L53), not 4096 bytes
// (controller audit P-3/S-2, ADR-375).
export const MAX_PLAUSIBLE_REPORTED_RX_BYTES =
  MAX_GRBL_RX_BUFFER_BYTES + RX_WINDOW_SAFETY_MARGIN_BYTES;

export type GrblStreamingMode = 'char-counted' | 'ping-pong';

export function isGrblStreamingMode(value: unknown): value is GrblStreamingMode {
  return value === 'char-counted' || value === 'ping-pong';
}

export function normalizeGrblStreamingMode(value: unknown): GrblStreamingMode {
  return isGrblStreamingMode(value) ? value : 'char-counted';
}

export function isGrblRxBufferBytes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_GRBL_RX_BUFFER_BYTES
  );
}

export function normalizeGrblRxBufferBytes(value: unknown): number {
  return isGrblRxBufferBytes(value) ? value : DEFAULT_GRBL_RX_BUFFER_BYTES;
}

/** True for a reported capacity too large to be a usable ring size. */
export function isOversizedRxCapacityReport(reportedBytes: number): boolean {
  return reportedBytes > MAX_PLAUSIBLE_REPORTED_RX_BYTES;
}

/**
 * Usable character-counting window for a receive capacity the controller
 * reported itself: the status `Bf:` free-byte count observed while the host
 * had nothing in flight, or the RX size in a stock `$I` OPT response. Keeps
 * the safety margin below the report and never exceeds the streamer's hard
 * cap; an oversized report counts as grblHAL's default ring. Null when the
 * value cannot bound a window at all.
 */
export function rxWindowFromReportedCapacity(reportedBytes: unknown): number | null {
  if (typeof reportedBytes !== 'number' || !Number.isInteger(reportedBytes)) return null;
  const capacity = isOversizedRxCapacityReport(reportedBytes)
    ? GRBLHAL_DEFAULT_RX_BUFFER_BYTES
    : reportedBytes;
  const usable = Math.min(MAX_GRBL_RX_BUFFER_BYTES, capacity - RX_WINDOW_SAFETY_MARGIN_BYTES);
  return usable > 0 ? usable : null;
}
