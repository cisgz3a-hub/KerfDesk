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
  // Marlin prints a bare `start` on boot; M115 answers FIRMWARE_NAME:Marlin.
  { kind: 'marlin', pattern: /^start$/ },
  { kind: 'marlin', pattern: /FIRMWARE_NAME:\s*Marlin/i },
  { kind: 'marlin', pattern: /^Marlin\b/ },
  // Smoothieware greets with "Smoothie ..." and answers M115 with its name.
  { kind: 'smoothieware', pattern: /^Smoothie\b/i },
  { kind: 'smoothieware', pattern: /FIRMWARE_NAME:\s*Smoothie/i },
];

// grblHAL built with COMPATIBILITY_LEVEL >= 1 ("reporting itself as Grbl",
// config.h:89) prints the stock banner with its own GRBL_VERSION, which is
// "1.1f" at every level: "Grbl 1.1f ['$' for help]" (report.c:310-314,
// grbl.h:38-43). That banner therefore fits stock GRBL 1.1f and such a grblHAL
// build alike, and a grblHAL profile it arrives on is not contradicted by it
// (audit HF-8). Any other "Grbl x.y" banner still identifies stock GRBL:
// grblHAL never prints "1.1h".
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L310-L314
const GRBLHAL_COMPATIBILITY_BANNER = /^Grbl 1\.1f(?:\s|$)/i;

/**
 * The firmware family a welcome banner identifies. `activeKind` is the driver
 * the session runs: the one ambiguous banner ("Grbl 1.1f", stock GRBL or
 * grblHAL at COMPATIBILITY_LEVEL >= 1) resolves to grblHAL when that driver is
 * grblHAL, and to stock GRBL otherwise.
 */
export function detectControllerFromBanner(
  line: string,
  activeKind?: ControllerKind,
): ControllerKind | null {
  const trimmed = line.trim();
  if (activeKind === 'grblhal' && GRBLHAL_COMPATIBILITY_BANNER.test(trimmed)) return 'grblhal';
  for (const matcher of BANNER_MATCHERS) {
    if (matcher.pattern.test(trimmed)) return matcher.kind;
  }
  return null;
}
