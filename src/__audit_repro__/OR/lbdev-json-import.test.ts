// Audit track OR, finding OR-5 (repro; expected to FAIL on current code).
//
// Correct behaviour: Machine Setup's LightBurn device import should read a real
// LightBurn `.lbdev` device file: bed size, S scale, baud rate and origin
// mirroring, or at least report which fields it could not read.
//
// Evidence: xTool's own LightBurn device file for the D1 Pro, the source the
// catalog's xTool profile cites (brand-laser-profiles.ts:65-69,
// https://xtool.zendesk.com/hc/article_attachments/7316804567447/xTool-D1ProV3.lbdev,
// downloaded 2026-09-25, sha256 d03e302114e6bfcd81d6d3a7c82958ff8d04e5d4ecc76424b9e4c58a7fad73f4)
// is JSON: {"DeviceList":[{"DisplayName":"xTool D1 Pro","Name":"GRBL",
// "Width":430,"Height":400,"MirrorY":true,"Settings":{"S_Scale":1000,
// "BaudRate":230400,"EnableGrblJCommand":false,...},"Type":"Serial"}]}.
// Creality's Falcon A1 Pro bundle records the same keys ("Width", "Height",
// "S_Scale", "BaudRate"; docs/audits/2026-09-19-machine-compatibility-fixes/
// falcon-vendor-configuration.json). lbdev-import.ts:66-100 and :226-231 only
// match XML tags (`<Width>...</Width>`, `<SMax>`, `<Origin>`), so every such
// file is rejected as "missing bed width or height".

import { describe, expect, it } from 'vitest';
import { importLightBurnDeviceProfile } from '../../io/lightburn';

// The relevant keys of xTool's file, verbatim structure and values.
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

describe('OR-5: LightBurn .lbdev import reads the vendor files LightBurn actually writes', () => {
  it("imports xTool's official D1 Pro device file", () => {
    const result = importLightBurnDeviceProfile(XTOOL_D1_PRO_LBDEV, {
      fileName: 'xTool-D1ProV3.lbdev',
    });
    expect(result.kind).toBe('review');
    if (result.kind !== 'review') return;
    expect(result.profile.bedWidth).toBe(430);
    expect(result.profile.bedHeight).toBe(400);
    expect(result.profile.maxPowerS).toBe(1000);
  });
});
