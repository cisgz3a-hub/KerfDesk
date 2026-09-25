import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type TracedImage } from '../scene';
import { hexOkLightness } from './colour-oklab';
import { colourLayerSettings, withColourLayerPowers } from './colour-layer-power';

// Black, mid grey and a pale grey: OKLab darkness 1, ~0.40 and ~0.09.
const COLOURS = ['#000000', '#808080', '#e0e0e0'];
const darkness = (hex: string): number => 1 - hexOkLightness(hex);
const power = (settings: ReturnType<typeof colourLayerSettings>, hex: string): number | undefined =>
  settings.get(hex)?.power;

describe('colour-layer power rule', () => {
  it('cut-out: power follows darkness relative to the darkest colour, floored at 25 %', () => {
    const settings = colourLayerSettings(COLOURS, 80, { output: 'cut-out' });
    expect(power(settings, '#000000')).toBe(80);
    expect(power(settings, '#808080')).toBeCloseTo(80 * darkness('#808080'), 1);
    // The pale grey's share (~9 %) is below the floor.
    expect(darkness('#e0e0e0')).toBeLessThan(0.25);
    expect(power(settings, '#e0e0e0')).toBe(20);
    expect([...settings.values()].every((setting) => setting.output)).toBe(true);
  });

  it('stacked: each layer adds its darkness step, so the doses sum to the cut-out target', () => {
    // Every darkness step here is above the 10 % floor.
    const stacked = colourLayerSettings(['#000000', '#808080', '#c0c0c0'], 100, {
      output: 'stacked',
    });
    const lightest = power(stacked, '#c0c0c0') as number;
    const middle = power(stacked, '#808080') as number;
    const darkest = power(stacked, '#000000') as number;
    // Stacked from the lightest up: black areas are burned by all three.
    expect(lightest + middle + darkest).toBeCloseTo(100, 0);
    expect(lightest + middle).toBeCloseTo(100 * darkness('#808080'), 0);
    expect(lightest).toBeCloseTo(100 * darkness('#c0c0c0'), 0);
  });

  it('never gives a near-duplicate tone a zero-power stacked operation', () => {
    const settings = colourLayerSettings(['#000000', '#010101'], 50, { output: 'stacked' });
    expect(power(settings, '#000000')).toBe(5);
  });

  it('reads darkness absolutely: a lone pale layer is not promoted to full power', () => {
    // Mid-dark or darker keeps the full power...
    expect(power(colourLayerSettings(['#000000'], 60, { output: 'cut-out' }), '#000000')).toBe(60);
    expect(darkness('#606060')).toBeGreaterThan(0.5);
    expect(power(colourLayerSettings(['#606060'], 60, { output: 'cut-out' }), '#606060')).toBe(60);
    // ...a lone light grey or pale tint gets a share of it.
    const grey = colourLayerSettings(['#b0b0b0'], 100, { output: 'cut-out' });
    expect(power(grey, '#b0b0b0')).toBeCloseTo((100 * darkness('#b0b0b0')) / 0.5, 0);
    expect(power(grey, '#b0b0b0')).toBeLessThan(60);
    const stackedGrey = colourLayerSettings(['#b0b0b0'], 100, { output: 'stacked' });
    expect(power(stackedGrey, '#b0b0b0')).toBe(power(grey, '#b0b0b0'));
    // The base is clamped to 0..100.
    expect(power(colourLayerSettings(['#000000'], 140, { output: 'cut-out' }), '#000000')).toBe(
      100,
    );
  });

  it('never burns white: a near-white colour starts with output off and no power', () => {
    for (const output of ['cut-out', 'stacked'] as const) {
      const settings = colourLayerSettings(['#ffffff', '#fff8dc', '#000000'], 70, { output });
      expect(settings.get('#ffffff')).toEqual({ power: 0, output: false });
      expect(settings.get('#fff8dc')).toEqual({ power: 0, output: false });
      expect(settings.get('#000000')).toEqual({ power: 70, output: true });
    }
    // A lone white layer (light-on-dark art traced with no paper) stays off.
    expect(colourLayerSettings(['#ffffff'], 70, { output: 'cut-out' }).get('#ffffff')).toEqual({
      power: 0,
      output: false,
    });
    // Pure yellow is ink, not paper: it still marks.
    expect(colourLayerSettings(['#ffff00'], 100, { output: 'cut-out' }).get('#ffff00')).toEqual({
      power: 25,
      output: true,
    });
  });

  it('turns the traced paper off when "Trace background colour" is on', () => {
    // Kraft paper (#c8a06e) is not near-white, but it is the traced paper.
    const colours = ['#c8a06e', '#3c2814'];
    for (const output of ['cut-out', 'stacked'] as const) {
      const kept = colourLayerSettings(colours, 80, { output, paperTraced: true });
      expect(kept.get('#c8a06e')).toEqual({ power: 0, output: false });
      expect(kept.get('#3c2814')?.output).toBe(true);
    }
    // Without the paper flag the same tone is ink and burns.
    expect(colourLayerSettings(colours, 80, { output: 'cut-out' }).get('#c8a06e')?.output).toBe(
      true,
    );
    // A dark lightest colour is never taken for paper (no paper was detected).
    const dark = colourLayerSettings(['#1428a0', '#000000'], 80, {
      output: 'cut-out',
      paperTraced: true,
    });
    expect(dark.get('#1428a0')?.output).toBe(true);
  });

  it('sets each colour operation from the colour its paths are bound to', () => {
    const colours = [...COLOURS, '#ffffff'];
    const object: TracedImage = {
      kind: 'traced-image',
      id: 'trace',
      source: 'logo.png',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: colours.map((color, i) => ({ color, polylines: [], operationIds: [`op${i}`] })),
    };
    const operation = (id: string) => ({ ...createLayer({ id, color: '#123456' }), power: 60 });
    const operations = colours.map((_, i) => operation(`op${i}`));
    const unbound = operation('other');
    const out = withColourLayerPowers(object, [...operations, unbound], { output: 'cut-out' });
    expect(out.map((o) => o.power)).toEqual([60, 24, 15, 0, 60]);
    expect(out.map((o) => o.output)).toEqual([true, true, true, false, true]);
    // No colour-layer commit: operations stay as created.
    expect(withColourLayerPowers(object, operations, undefined)).toBe(operations);
    // A CNC keeps every power; only the paper's output-off applies.
    const cnc = withColourLayerPowers(object, operations, { output: 'cut-out' }, { kind: 'cnc' });
    expect(cnc.map((o) => o.power)).toEqual([60, 60, 60, 60]);
    expect(cnc.map((o) => o.output)).toEqual([true, true, true, false]);
  });
});
