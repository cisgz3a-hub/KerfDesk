import { DITHER_ALGORITHMS, type Layer } from '../../core/scene';

export function numberValue(value: string, min: number, max: number): number {
  return numberValueOr(value, min, min, max);
}

export function numberValueOr(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, parsed));
}

export function parseDither(value: string): Layer['ditherAlgorithm'] {
  return DITHER_ALGORITHMS.some((algorithm) => algorithm === value)
    ? (value as Layer['ditherAlgorithm'])
    : 'floyd-steinberg';
}

export function dotWidthCorrectionMax(linesPerMm: number): number {
  return 1 / Math.max(1, linesPerMm);
}

export function algorithmLabel(algorithm: Layer['ditherAlgorithm']): string {
  return algorithm
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
