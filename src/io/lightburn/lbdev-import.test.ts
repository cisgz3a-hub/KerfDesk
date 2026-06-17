import { describe, expect, it } from 'vitest';
import { importLightBurnDeviceProfile } from './lbdev-import';

const grblLbdev = `
<LightBurnDevice>
  <Name>Shop 4040</Name>
  <Controller>GRBL</Controller>
  <XSize>400</XSize>
  <YSize>390</YSize>
  <Origin>Front Left</Origin>
  <AutoHome>true</AutoHome>
  <SValueMax>1000</SValueMax>
  <StartScript>G21\nG90</StartScript>
  <EndScript>M5</EndScript>
</LightBurnDevice>`;

describe('LightBurn .lbdev import', () => {
  it('parses safe GRBL-compatible fields into a review result', () => {
    const result = importLightBurnDeviceProfile(grblLbdev, 'shop.lbdev');

    expect(result.kind).toBe('review');
    if (result.kind !== 'review') return;
    expect(result.canCreateProfile).toBe(true);
    expect(result.profile).toMatchObject({
      name: 'Shop 4040',
      bedWidth: 400,
      bedHeight: 390,
      maxPowerS: 1000,
      origin: 'front-left',
      homing: { enabled: true, direction: 'front-left' },
      profileSource: 'imported-lightburn',
    });
    expect(result.applied.map((row) => row.label)).toContain('Work area');
    expect(result.needsReview.map((row) => row.label)).toContain('Start script');
    expect(result.ignored.map((row) => row.label)).toContain('LightBurn file');
  });

  it('keeps non-GRBL devices review-only and unable to create a LaserForge profile', () => {
    const result = importLightBurnDeviceProfile(
      '<LightBurnDevice><Name>Ruida CO2</Name><Controller>Ruida</Controller></LightBurnDevice>',
      'ruida.lbdev',
    );

    expect(result.kind).toBe('review');
    if (result.kind !== 'review') return;
    expect(result.canCreateProfile).toBe(false);
    expect(result.needsReview.some((row) => row.label === 'Controller')).toBe(true);
  });

  it('reports malformed XML and unsupported LightBurn 2.x bundle files', () => {
    expect(importLightBurnDeviceProfile('<LightBurnDevice>', 'bad.lbdev').kind).toBe('invalid');
    expect(importLightBurnDeviceProfile('PK\x03\x04bundle', 'devices.lbzip')).toEqual({
      kind: 'unsupported-bundle',
      message:
        'LightBurn .lbzip bundles are not imported yet. Export a legacy single-device .lbdev file for review-first import.',
    });
  });
});
