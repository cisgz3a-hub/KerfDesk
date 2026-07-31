import { describe, expect, it } from 'vitest';

import { DEFAULT_DESIGN_LAYER } from '../../../core/design/layers';
import type { Sketch } from '../../../core/design';
import { canvasTheme } from '../../theme/canvas-theme';
import { buildViewportOverlay, OVERLAY_LIFT_MM } from './viewport-overlay';

const FRAME = { originMm: { x: 100, y: 50 }, widthMm: 200, heightMm: 100 };

const LAYERS = [
  { ...DEFAULT_DESIGN_LAYER, id: 'vee', color: '#dc2626', cutType: 'v-carve' },
] as const;

const sketch: Sketch = {
  entities: [
    {
      id: 'r',
      kind: 'rect',
      origin: { x: 120, y: 60 },
      widthMm: 40,
      heightMm: 20,
      cornerRadiusMm: 0,
      layerId: 'vee',
    },
    {
      id: 'guide',
      kind: 'line',
      start: { x: 100, y: 50 },
      end: { x: 300, y: 50 },
      construction: true,
    },
  ],
  layers: LAYERS,
};

describe('buildViewportOverlay', () => {
  it('buckets by layer colour, dashes construction, and floats above the stock', () => {
    const overlay = buildViewportOverlay({
      sketch,
      selectedIds: new Set(),
      draft: null,
      snapMm: null,
      frame: FRAME,
    });
    const colors = overlay.buckets.map((bucket) => `${bucket.color}${bucket.dashed ? '|d' : ''}`);
    expect(colors).toContain('#dc2626');
    expect(colors).toContain(`${canvasTheme.designConstruction}|d`);
    for (const bucket of overlay.buckets) {
      expect(bucket.positions.length % 6).toBe(0); // xyz pairs per segment
      for (let i = 2; i < bucket.positions.length; i += 3) {
        expect(bucket.positions[i]).toBeCloseTo(OVERLAY_LIFT_MM, 6);
      }
    }
  });

  it('maps scene mm into the centred, Y-mirrored local frame', () => {
    const overlay = buildViewportOverlay({
      sketch: { entities: sketch.entities.slice(0, 1), layers: LAYERS },
      selectedIds: new Set(),
      draft: null,
      snapMm: null,
      frame: FRAME,
    });
    const positions = overlay.buckets[0]?.positions ?? new Float32Array();
    // Rect corner (120,60) scene → local x = 120-100-100 = -80, y = -(60-50)+50 = 40.
    const xs = [...positions].filter((_v, i) => i % 3 === 0);
    const ys = [...positions].filter((_v, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeCloseTo(-80, 5);
    expect(Math.max(...ys)).toBeCloseTo(40, 5);
  });

  it('selection colour beats the layer colour and the draft renders', () => {
    const overlay = buildViewportOverlay({
      sketch,
      selectedIds: new Set(['r']),
      draft: {
        tool: 'rect',
        anchorMm: { x: 110, y: 55 },
        pointerMm: { x: 130, y: 70 },
        modifiers: { constrain: false, fromCentre: false },
      },
      snapMm: { x: 110, y: 55 },
      frame: FRAME,
    });
    const selected = overlay.buckets.find((bucket) => bucket.color === canvasTheme.selection);
    expect(selected).toBeDefined();
    expect(overlay.buckets.some((bucket) => bucket.color === '#dc2626')).toBe(false);
    expect(overlay.snapLocal).not.toBeNull();
    expect(overlay.snapLocal?.x).toBeCloseTo(110 - 100 - 100, 5);
  });
});
