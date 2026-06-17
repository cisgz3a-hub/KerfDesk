import { describe, expect, it } from 'vitest';
import { importLightBurnDeviceProfile } from './lbdev-import';

const GRBL_LBDEV = `
<LightBurnDevice>
  <Name>Neotronics 4040 imported</Name>
  <Controller>GRBL</Controller>
  <Width>400</Width>
  <Height>400</Height>
  <Origin>FrontLeft</Origin>
  <SMax>1000</SMax>
  <StartScript>G21
M4</StartScript>
  <EndScript>M5</EndScript>
</LightBurnDevice>
`;

describe('LightBurn .lbdev import', () => {
  it('extracts safe GRBL-compatible fields into a review result', () => {
    const result = importLightBurnDeviceProfile(GRBL_LBDEV, { fileName: 'neotronics.lbdev' });

    expect(result.kind).toBe('review');
    if (result.kind !== 'review') return;
    expect(result.canCreateProfile).toBe(true);
    expect(result.profile.name).toBe('Neotronics 4040 imported');
    expect(result.profile.profileSource).toBe('lightburn');
    expect(result.profile.bedWidth).toBe(400);
    expect(result.profile.bedHeight).toBe(400);
    expect(result.profile.maxPowerS).toBe(1000);
    expect(result.profile.origin).toBe('front-left');
    expect(result.profile.scanningOffsets).toEqual([]);
    expect(result.profile.noGoZones).toEqual([]);
    expect(result.applied.map((field) => field.label)).toEqual([
      'Name',
      'Controller',
      'Bed width',
      'Bed height',
      'Origin',
      'Max S',
    ]);
    expect(result.ignored.map((field) => field.label)).toContain('Start script');
    expect(result.ignored.map((field) => field.label)).toContain('End script');
  });

  it('marks non-GRBL devices as review-only without creating a usable profile', () => {
    const result = importLightBurnDeviceProfile(
      `<LightBurnDevice><Name>Ruida bed</Name><Controller>Ruida</Controller><Width>600</Width><Height>400</Height></LightBurnDevice>`,
      { fileName: 'ruida.lbdev' },
    );

    expect(result.kind).toBe('review');
    if (result.kind !== 'review') return;
    expect(result.canCreateProfile).toBe(false);
    expect(result.needsReview.map((field) => field.label)).toContain('Controller');
  });

  it('returns a clear unsupported result for LightBurn bundle exports', () => {
    expect(importLightBurnDeviceProfile('PK...', { fileName: 'devices.lbzip' })).toEqual({
      kind: 'unsupported-bundle',
      reason:
        'LightBurn .lbzip bundles are not imported yet. Export a legacy .lbdev device instead.',
    });
  });

  it('rejects malformed legacy files without guessing machine dimensions', () => {
    expect(importLightBurnDeviceProfile('<LightBurnDevice><Name>Broken')).toEqual({
      kind: 'invalid',
      reason: 'missing bed width or height',
    });
  });
});
