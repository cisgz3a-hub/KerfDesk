import { describe, expect, it } from 'vitest';
import { isSendableGcodeLine } from '../controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

function group(toolTipDiameterMm?: number): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'flat-tip-layer',
    color: '#334455',
    cutType: 'v-carve',
    toolId: 'flat-engraver',
    toolName: '30 degree flat-tip engraver',
    toolKind: 'engraving',
    toolDiameterMm: 3.175,
    toolTipAngleDeg: 30,
    ...(toolTipDiameterMm === undefined ? {} : { toolTipDiameterMm }),
    feedMmPerMin: 600,
    plungeMmPerMin: 180,
    spindleRpm: 12_000,
    spindleSpinupSec: 3,
    safeZMm: 5,
    passes: [
      {
        kind: 'contour',
        zMm: -0.5,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
      },
    ],
  };
}

describe('CNC G-code flat-tip provenance', () => {
  it('emits the tip diameter as inert tool geometry without changing motion', () => {
    const pointed = cncGrblStrategy.emit({ groups: [group()] }, DEFAULT_DEVICE_PROFILE);
    const flat = cncGrblStrategy.emit({ groups: [group(0.2)] }, DEFAULT_DEVICE_PROFILE);

    expect(flat).toContain(
      '; cnc tool: engraving; diameter-mm: 3.175; angle-deg: 30.000; tip-diameter-mm: 0.200',
    );
    expect(pointed).toContain('; cnc tool: engraving; diameter-mm: 3.175; angle-deg: 30.000');
    expect(pointed).not.toContain('tip-diameter-mm');
    expect(sendableLines(flat)).toEqual(sendableLines(pointed));
  });
});

function sendableLines(gcode: string): ReadonlyArray<string> {
  return gcode.split('\n').filter(isSendableGcodeLine);
}
