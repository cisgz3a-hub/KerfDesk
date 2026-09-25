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
        'LightBurn .lbzip bundles are not imported yet. Export the device as a .lbdev file instead.',
    });
  });

  it('rejects malformed legacy files without guessing machine dimensions', () => {
    expect(importLightBurnDeviceProfile('<LightBurnDevice><Name>Broken')).toEqual({
      kind: 'invalid',
      reason: 'missing bed width or height',
    });
  });
});

// OR-5 (2026-09-25 controller audit): LightBurn writes device files as JSON.
// Adapted from src/__audit_repro__/OR/lbdev-json-import.test.ts. The keys and
// values are those of xTool's official D1 Pro file
// (https://xtool.zendesk.com/hc/article_attachments/7316804567447/xTool-D1ProV3.lbdev).
const XTOOL_D1_PRO_LBDEV = JSON.stringify(
  {
    DeviceList: [
      {
        DisplayName: 'xTool D1 Pro',
        Height: 400,
        HomeOnStartup: false,
        MirrorX: false,
        MirrorY: true,
        Name: 'GRBL',
        Settings: {
          AirAssistM7: false,
          BaudRate: 230400,
          EnableGrblJCommand: false,
          S_Scale: 1000,
          StartGCode: 'M106 S0',
          TransferMode: 0,
        },
        Type: 'Serial',
        Width: 430,
      },
    ],
  },
  null,
  4,
);

describe('LightBurn JSON .lbdev import', () => {
  it("imports xTool's official D1 Pro device file for review", () => {
    const result = importLightBurnDeviceProfile(XTOOL_D1_PRO_LBDEV, {
      fileName: 'xTool-D1ProV3.lbdev',
    });
    expect(result.kind).toBe('review');
    if (result.kind !== 'review') return;
    expect(result.canCreateProfile).toBe(true);
    expect(result.profile).toMatchObject({
      name: 'xTool D1 Pro',
      profileSource: 'lightburn',
      bedWidth: 430,
      bedHeight: 400,
      maxPowerS: 1000,
      baudRate: 230400,
      origin: 'rear-left',
      airAssistCommand: 'M8',
    });
    expect(result.applied.map((field) => field.label)).toEqual([
      'Name',
      'Controller',
      'Bed width',
      'Bed height',
      'Origin',
      'Max S',
      'Baud rate',
      'Air assist',
    ]);
    expect(result.needsReview.map((field) => field.label)).toEqual(['Jogging']);
    expect(result.needsReview[0]?.note).toContain('not compatible with $J= jogging');
    expect(result.ignored.map((field) => field.label)).toEqual(['Start script']);
  });

  it.each([
    [false, false, 'front-left'],
    [true, false, 'front-right'],
    [false, true, 'rear-left'],
    [true, true, 'rear-right'],
  ] as const)('maps MirrorX %s / MirrorY %s to a %s origin', (mirrorX, mirrorY, origin) => {
    const result = importLightBurnDeviceProfile(
      JSON.stringify({
        DeviceList: [{ Name: 'GRBL', Width: 300, Height: 200, MirrorX: mirrorX, MirrorY: mirrorY }],
      }),
    );
    expect(result.kind === 'review' && result.profile.origin).toBe(origin);
  });

  it('reads the GRBL-LPC Falcon entry, and flags extra devices', () => {
    const falcon = {
      Name: 'GRBL-LPC',
      DisplayName: 'Falcon A1 Pro',
      Width: 358,
      Height: 268,
      Settings: { BaudRate: 115200, S_Scale: 1000, AirAssistM7: false },
    };
    const result = importLightBurnDeviceProfile(
      JSON.stringify({ DeviceList: [falcon, { ...falcon, DisplayName: 'Second' }] }),
    );
    if (result.kind !== 'review') throw new Error(result.kind);
    expect(result.canCreateProfile).toBe(true);
    expect(result.profile).toMatchObject({ name: 'Falcon A1 Pro', bedWidth: 358, bedHeight: 268 });
    // No mirror keys: the origin is not mapped, and the default stays.
    expect(result.profile.origin).toBe('front-left');
    expect(result.applied.map((field) => field.label)).not.toContain('Origin');
    expect(result.needsReview.map((field) => field.label)).toContain('Devices in file');
  });

  it('reads a file that starts with a byte-order mark', () => {
    const result = importLightBurnDeviceProfile(`\uFEFF${XTOOL_D1_PRO_LBDEV}`);
    expect(result.kind === 'review' && result.profile.bedWidth).toBe(430);
  });

  it('keeps a non-GRBL JSON device review-only', () => {
    const result = importLightBurnDeviceProfile(
      JSON.stringify({ DeviceList: [{ Name: 'Ruida', Width: 600, Height: 400 }] }),
    );
    expect(result.kind === 'review' && result.canCreateProfile).toBe(false);
  });

  it('rejects unreadable or empty JSON without guessing', () => {
    expect(importLightBurnDeviceProfile('{"DeviceList": [')).toEqual({
      kind: 'invalid',
      reason: 'not a readable LightBurn device file',
    });
    expect(importLightBurnDeviceProfile('{"DeviceList": []}')).toEqual({
      kind: 'invalid',
      reason: 'no device in the LightBurn DeviceList',
    });
    expect(
      importLightBurnDeviceProfile(JSON.stringify({ DeviceList: [{ Name: 'GRBL', Width: 300 }] })),
    ).toEqual({ kind: 'invalid', reason: 'missing bed width or height' });
  });
});
