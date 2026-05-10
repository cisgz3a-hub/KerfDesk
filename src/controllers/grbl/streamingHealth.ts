/**
 * Streaming health (buffer fill + ok-ack rate) for GRBL jobs.
 * Pure logic — testable without a serial port.
 *
 * T1-125 (audit Sprint 5 #17): pre-T1-125 the rate computation was
 * `recentEvents.length / windowSeconds`. That assumed the producer
 * buffered enough timestamps to span the full 5-second window — but
 * GrblController held a fixed 100-sample ring (`ACK_RATE_WINDOW_SIZE
 * = 100`). At 200 Hz the buffer captured the most-recent 0.5 s of
 * events, then `count / 5` reported ~20 Hz when reality was ~200 Hz.
 * The metric *under-reported* rate by up to 5×, masking degraded
 * streams as "healthy" because the false low rate matched the false
 * low expected rate. The audit's recommended fix was endpoint-based
 * rate (`(count-1) / (last - first)`) — implemented here. Producer
 * buffer size also bumped (T1-125 in GrblController.ts) so the
 * window stays meaningful for trend detection.
 */

export const STREAMING_ACK_WINDOW_MS = 5000;

export type StreamingHealthStatus = 'healthy' | 'warning' | 'saturated';

export interface StreamingHealthFields {
  healthStatus: StreamingHealthStatus;
  ackRateHz: number | null;
  expectedAckRateHz: number | null;
}

/**
 * Endpoint-based rate: how many events occurred per second over the
 * actual span captured by the buffer? Robust against producer buffer
 * truncation (the `count / WINDOW` formula assumed every event in the
 * window made it into the buffer, which a ring with capacity < rate ×
 * window violates). With ≥2 timestamps we have one or more inter-event
 * intervals; `(N-1)` intervals divided by `(last - first)` seconds
 * gives the correct mean rate over the captured span.
 *
 * Returns null when fewer than 3 events are present (matches the
 * pre-T1-125 minimum-samples threshold) OR when the span is zero
 * (all timestamps coincide — degenerate, no rate to report).
 */
function rateFromTimestamps(timestamps: readonly number[]): number | null {
  if (timestamps.length < 3) return null;
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  const spanSeconds = (last - first) / 1000;
  if (spanSeconds <= 0) return null;
  return (timestamps.length - 1) / spanSeconds;
}

export function computeStreamingHealth(params: {
  now: number;
  ackTimestamps: readonly number[];
  sendTimestamps: readonly number[];
  bufferFill: number;
  grblBufferCapacity: number;
  isJobRunning: boolean;
}): StreamingHealthFields {
  const { now, ackTimestamps, sendTimestamps, bufferFill, grblBufferCapacity, isJobRunning } =
    params;
  const cutoff = now - STREAMING_ACK_WINDOW_MS;
  const recentAcks = ackTimestamps.filter(t => t >= cutoff);
  const recentSends = sendTimestamps.filter(t => t >= cutoff);

  const ackRateHz = rateFromTimestamps(recentAcks);
  const expectedAckRateHz = rateFromTimestamps(recentSends);

  const bufferFillRatio = grblBufferCapacity > 0 ? bufferFill / grblBufferCapacity : 0;

  if (!isJobRunning) {
    return { healthStatus: 'healthy', ackRateHz, expectedAckRateHz };
  }

  let healthStatus: StreamingHealthStatus = 'healthy';

  if (ackRateHz !== null && expectedAckRateHz !== null) {
    const ackDeficit = ackRateHz < expectedAckRateHz * 0.5;
    const bufferSaturated = bufferFillRatio > 0.9;
    if (ackDeficit && bufferSaturated) {
      healthStatus = 'saturated';
    } else if (bufferFillRatio > 0.75 || ackRateHz < expectedAckRateHz * 0.7) {
      healthStatus = 'warning';
    }
  } else if (bufferFillRatio > 0.75) {
    healthStatus = 'warning';
  }

  return { healthStatus, ackRateHz, expectedAckRateHz };
}
