// Controller detection from the firmware welcome banner. Order matters:
// FluidNC banners START with "Grbl " ("Grbl 3.7 [FluidNC v3.7.x]"), so the
// more specific patterns must run before the generic GRBL match. Returns
// null for lines that are not a recognizable banner — callers keep the
// profile-selected driver and merely surface the detection.

import type { ControllerKind } from '../devices/device-profile';

type BannerMatcher = {
  readonly kind: ControllerKind;
  readonly pattern: RegExp;
};

const BANNER_MATCHERS: ReadonlyArray<BannerMatcher> = [
  { kind: 'fluidnc', pattern: /^Grbl [\d.]+ \[FluidNC/i },
  { kind: 'grblhal', pattern: /^GrblHAL [\d.]+/i },
  { kind: 'grbl-v1.1', pattern: /^Grbl [\d.]+/i },
];

export function detectControllerFromBanner(line: string): ControllerKind | null {
  const trimmed = line.trim();
  for (const matcher of BANNER_MATCHERS) {
    if (matcher.pattern.test(trimmed)) return matcher.kind;
  }
  return null;
}
