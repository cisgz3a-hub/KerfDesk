// Built-in JCZ LMC fiber galvo profiles (ADR-704): one per common F-theta lens
// field, 110, 150 and 200 mm square. The bed is the lens field and the origin
// is its centre. The galvo setup carries MeerK40t's defaults (galvo-setup.ts).
// Experimental: simulator-tested only, not qualified on a real board.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import { DEFAULT_GALVO_SETUP, galvoSetupIssue } from './galvo-setup';

const GALVO_CATALOG_VERSION = '2026-11-11';

/** Galvo mark speeds run to thousands of mm/s; 10,000 mm/s is the cap. */
const GALVO_MAX_FEED_MM_PER_MIN = 600_000;

const GALVO_EVIDENCE_NOTE =
  'EXPERIMENTAL: the LMC list protocol, USB ids and command sequences follow MeerK40t’s MIT-licensed balormk driver (d511944e). Output decodes back through this app’s own decoder and runs against a scripted board, but NO program has been run on a real JCZ board by KerfDesk. Frame with the red pointer, then test on scrap at low power.';

function fiberGalvoProfile(fieldMm: 110 | 150 | 200): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    profileId: `generic-jcz-fiber-galvo-${fieldMm}`,
    catalogVersion: GALVO_CATALOG_VERSION,
    vendor: 'Generic',
    model: `JCZ LMC fiber galvo, ${fieldMm} mm lens`,
    name: `Generic JCZ fiber galvo ${fieldMm}×${fieldMm} (USB, experimental)`,
    machineFamily: 'generic-jcz-galvo',
    controllerKind: 'jcz-lmc',
    bedWidth: fieldMm,
    bedHeight: fieldMm,
    origin: 'center',
    maxFeed: GALVO_MAX_FEED_MM_PER_MIN,
    framingFeedMmPerMin: GALVO_MAX_FEED_MM_PER_MIN,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false },
    capabilities: ['laser-output'],
    laserSubProfile: {
      model: 'Fiber laser source (Q-switched)',
      technology: 'fiber',
      metadataConfidence: 'unverified',
      wavelengthNm: 1064,
      focusMode: 'manual',
      airAssist: 'none',
    },
    galvo: DEFAULT_GALVO_SETUP,
    evidence: [
      {
        label: 'JCZ LMC galvo protocol (MeerK40t balormk)',
        status: 'experimental',
        note: GALVO_EVIDENCE_NOTE,
      },
    ],
  };
}

export const GENERIC_JCZ_GALVO_PROFILES: ReadonlyArray<DeviceProfile> = [
  fiberGalvoProfile(110),
  fiberGalvoProfile(150),
  fiberGalvoProfile(200),
];

/** Why a profile cannot drive a galvo: a 'jcz-lmc' profile needs a valid
 *  galvo setup and a square bed, which is its lens field. */
export function galvoProfileIssues(
  profile: Pick<DeviceProfile, 'controllerKind' | 'galvo' | 'bedWidth' | 'bedHeight'>,
): ReadonlyArray<string> {
  if (profile.controllerKind !== 'jcz-lmc') return [];
  const issues: string[] = [];
  if (profile.galvo === undefined) issues.push('a jcz-lmc profile needs a galvo setup');
  else {
    const issue = galvoSetupIssue(profile.galvo);
    if (issue !== null) issues.push(issue);
  }
  if (profile.bedWidth !== profile.bedHeight)
    issues.push('a galvo bed is its square lens field: bedWidth must equal bedHeight');
  return issues;
}
