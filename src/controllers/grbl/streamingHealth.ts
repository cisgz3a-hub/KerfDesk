/**
 * Streaming health (buffer fill + ok-ack rate) for GRBL jobs.
 * Pure logic — testable without a serial port.
 */

export const STREAMING_ACK_WINDOW_MS = 5000;

export type StreamingHealthStatus = 'healthy' | 'warning' | 'saturated';

export interface StreamingHealthFields {
  healthStatus: StreamingHealthStatus;
  ackRateHz: number | null;
  expectedAckRateHz: number | null;
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
  const windowSeconds = STREAMING_ACK_WINDOW_MS / 1000;

  const ackRateHz = recentAcks.length >= 3 ? recentAcks.length / windowSeconds : null;
  const expectedAckRateHz = recentSends.length >= 3 ? recentSends.length / windowSeconds : null;

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
