// reportedAxisFeedLimit — shared by the laser and CNC machine-limit advisories.
// The SLOWER of the two reported axis rates ($110/$111): a job at that feed is
// firmware-clamped on the slow axis even if the fast axis could keep up. Falls
// back to the collapsed maxFeed (the GREATER of the pair) only when per-axis
// rates aren't reported (Codex re-audit R4).

import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';

/** The XY feed the controller can actually sustain on every axis, or null when unreported. */
export function reportedAxisFeedLimit(limits: ControllerSettingsSnapshot): number | null {
  const axisRates = [limits.maxFeedX, limits.maxFeedY].filter(
    (rate): rate is number => rate !== undefined,
  );
  if (axisRates.length > 0) return Math.min(...axisRates);
  return limits.maxFeed ?? null;
}
