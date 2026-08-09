import { parseReliefInputCode } from './relief-input-code';

/** Smallest mask byte threshold represented by the canonical heightfield mapping. */
export const MIN_RELIEF_MASK_THRESHOLD = 1;

/** Largest mask byte threshold represented by the canonical heightfield mapping. */
export const MAX_RELIEF_MASK_THRESHOLD = 0xff;

/** Parses an exact decimal mask threshold without rounding, clamping, or floating-point loss. */
export function parseReliefMaskThreshold(input: string, priorValue: number): number {
  const parsed = parseReliefInputCode(input, priorValue);
  return parsed >= MIN_RELIEF_MASK_THRESHOLD && parsed <= MAX_RELIEF_MASK_THRESHOLD
    ? parsed
    : priorValue;
}
