import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_LAYER, type DesignLayer } from '../../../core/design/layers';
import type { CncTool } from '../../../core/scene';
import { designLayerCutSummary } from './DesignLayerRow';

const V_BIT: CncTool = {
  id: 'v90',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

describe('designLayerCutSummary', () => {
  it('does not present the ignored layer depth as a flowing V-carve limit', () => {
    const summary = designLayerCutSummary(
      {
        ...DEFAULT_DESIGN_LAYER,
        cutType: 'v-carve',
        depthMm: 1,
        vCarveFlatDepthEnabled: false,
      },
      V_BIT,
    );

    expect(summary).toContain('flowing depth');
    expect(summary).not.toContain('1 mm');
  });

  it.each([true, undefined])('labels explicit and legacy flat depth as a maximum (%s)', (flag) => {
    const configured = {
      ...DEFAULT_DESIGN_LAYER,
      cutType: 'v-carve' as const,
      depthMm: 1,
      ...(flag === undefined ? {} : { vCarveFlatDepthEnabled: flag }),
    };
    expect(
      designLayerCutSummary(
        flag === undefined ? withoutFlatDepthFlag(configured) : configured,
        V_BIT,
      ),
    ).toContain('1 mm max');
  });
});

function withoutFlatDepthFlag(layer: DesignLayer): DesignLayer {
  const { vCarveFlatDepthEnabled: _legacyAbsent, ...legacy } = layer;
  return legacy;
}
