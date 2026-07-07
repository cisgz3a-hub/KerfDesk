export const DEFAULT_GRBL_RX_BUFFER_BYTES = 120;
export const MAX_GRBL_RX_BUFFER_BYTES = 4096;

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
