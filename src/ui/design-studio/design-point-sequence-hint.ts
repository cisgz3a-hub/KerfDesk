import type { DesignPointSequence } from './design-point-sequence';

export function designPointSequenceHint(sequence: DesignPointSequence): string {
  if (sequence.kind === 'arc') {
    return sequence.startMm === null
      ? 'Centre set. Click the arc start point.'
      : 'Start set. Click the arc end point; the preview shows the sweep.';
  }
  const cornerCount = sequence.points.length;
  if (cornerCount < 2) return 'First corner set. Click the next corner.';
  if (cornerCount < 3) return 'Click the next corner, or double-click to finish open.';
  return 'Click the next corner, double-click to finish open, or click the start to close.';
}
