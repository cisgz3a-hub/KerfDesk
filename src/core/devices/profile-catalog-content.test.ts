// ADR-322 Amendment 2 (2026-09-25 PR audit, SET-1): a preset's catalogVersion
// names its content. The G-code header, recovery provenance and every saved copy
// record catalogVersion, so content that changes under an unchanged version
// cannot be told from the old preset. This pins each preset's content hash to
// its version. Change a preset and this fails: bump its catalogVersion, then
// record the new version and hash below. A saved copy that predates a change
// that fails silently also belongs in preset-corrections.ts.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DeviceProfile } from './device-profile';
import { GRBL_MACHINE_PROFILE_CATALOG } from './profile-catalog';

const RECORDED: Readonly<Record<string, string>> = {
  'creality-falcon-a1-pro-compatible': '2026-09-19 cf1f1b29e4ab0ba4',
  'creality-falcon-a1-pro-grblhal': '2026-09-24 fab4de72b2c64f55',
  'generic-fluidnc': '2026-09-19 8b9cd18c16da218d',
  'generic-grbl-400x400': '2026-09-19 99584b14b49a75ff',
  'generic-grblhal': '2026-09-19 73f84d5af72bd78c',
  'generic-marlin-laser': '2026-09-19 33d9199ef3c16b7d',
  'generic-ruida-rd-export': '2026-09-19 6aaf6ae9e05882e6',
  'generic-smoothieware': '2026-09-19 9237f81b2f61a647',
  'neotronics-4040-max-lt4lds-v2-20w': '2026-09-19 e822e875ef5fa911',
  'ortur-laser-master-3': '2026-09-19 144d374d36d9d007',
  'ortur-laser-master-3-20w': '2026-09-19 d3d9002d042e3fcd',
  'ortur-laser-master-3-40w': '2026-09-19 3a7ef6b91a9299a3',
  'sculpfun-s30': '2026-09-24 56d376569289ede3',
  'sculpfun-s30-manual-air': '2026-09-24 4023386c426c074c',
  'xtool-d1-pro': '2026-09-24 50d18f49ace4a3a3',
  'xtool-d1-pro-10w': '2026-09-24 625580b4fe983209',
  'xtool-d1-pro-40w': '2026-09-24 2607ff341d47125b',
  'xtool-d1-pro-5w': '2026-09-24 881dc847f7589ce1',
};

describe('preset catalog versions (ADR-322 Amendment 2)', () => {
  it('pairs every preset content with the catalogVersion it was recorded under', () => {
    const current = Object.fromEntries(
      GRBL_MACHINE_PROFILE_CATALOG.map(({ profile }) => [
        profile.profileId ?? profile.name,
        `${profile.catalogVersion ?? 'unversioned'} ${contentHash(profile)}`,
      ]),
    );
    expect(
      current,
      'A preset changed. Bump its catalogVersion, then record the new version and hash here.',
    ).toEqual(RECORDED);
  });
});

function contentHash(profile: DeviceProfile): string {
  const { catalogVersion: _version, ...content } = profile;
  return createHash('sha256').update(canonicalJson(content)).digest('hex').slice(0, 16);
}

// Key order is not content: sort keys so a reordered literal hashes the same.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
