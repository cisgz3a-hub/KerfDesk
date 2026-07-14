// zero-z-guard — decides whether pressing Zero Z needs an operator
// confirmation before it overwrites an already-established work Z0.
//
// Zero Z (G92 Z0) declares the bit's CURRENT height to be Z0. Pressed while
// the bit is parked above the stock — the post-probe retract or the
// post-frame safe-Z park — it silently moves the work zero up by that
// height, and the next job cuts in the air by the same amount. When a
// current-session Z zero already exists, the bit's height above it is
// measurable from the status report, so the overwrite is warned instead of
// trusted. A first-time zero (no current evidence) stays silent: with no
// established zero the work-frame Z carries no meaning to warn about.

import { isWorkZZeroEvidenceCurrent, type WorkZZeroEvidence } from '../state/work-z-zero-evidence';

/** Below this |work Z| the bit is at the established zero (touching the
 *  stock top), so re-zeroing is a correction, not an overwrite. */
export const ZERO_Z_OVERWRITE_WARNING_THRESHOLD_MM = 0.5;

/** The confirmation to show before Zero Z, or null when no confirmation is
 *  needed and the zero may be written directly. */
export function zeroZOverwriteWarning(input: {
  readonly evidence: WorkZZeroEvidence | null;
  readonly referenceEpoch: number;
  readonly workZMm: number | null;
}): string | null {
  if (!isWorkZZeroEvidenceCurrent(input.evidence, input.referenceEpoch)) return null;
  const source = input.evidence?.source === 'probe' ? 'a touch-plate probe' : 'Zero Z';
  if (input.workZMm === null) return unknownHeightWarning(input.evidence?.source);
  if (Math.abs(input.workZMm) <= ZERO_Z_OVERWRITE_WARNING_THRESHOLD_MM) return null;
  const distance = Math.abs(input.workZMm).toFixed(1);
  const direction = input.workZMm > 0 ? 'above' : 'below';
  const consequence = input.workZMm > 0 ? 'in the air' : 'too deep';
  return (
    `Work Z0 is already set (by ${source}), and the bit is currently ${distance} mm ` +
    `${direction} that zero. Zero Z here moves the work zero to the bit's current height, ` +
    `so the next job would cut ${distance} mm ${consequence}. Only Zero Z with the bit ` +
    'touching the stock top.\n\nReplace the work zero at the current bit height?'
  );
}

// With no measurable height, only a probe-established zero is defended — it
// took a physical touch-plate cycle to earn and one click would discard it.
function unknownHeightWarning(source: WorkZZeroEvidence['source'] | undefined): string | null {
  if (source !== 'probe') return null;
  return (
    "Work Z0 was set by a touch-plate probe, and the bit's current height is unknown. " +
    "Zero Z replaces the probed zero with the bit's current height — only do this with " +
    'the bit touching the stock top.\n\nReplace the probed work zero?'
  );
}
