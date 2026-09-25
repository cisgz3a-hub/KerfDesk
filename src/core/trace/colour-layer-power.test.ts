import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type TracedImage } from '../scene';
import { hexOkLightness } from './colour-oklab';
import { colourLayerPowers, withColourLayerPowers } from './colour-layer-power';

// Black, mid grey and a pale grey: OKLab darkness 1, ~0.40 and ~0.09.
const COLOURS = ['#000000', '#808080', '#e0e0e0'];

describe('colour-layer power rule', () => {
  it('cut-out: power follows darkness relative to the darkest colour, floored at 25 %', () => {
    const powers = colourLayerPowers(COLOURS, 80, 'cut-out');
    const darkness = (hex: string): number => 1 - hexOkLightness(hex);
    expect(powers.get('#000000')).toBe(80);
    expect(powers.get('#808080')).toBeCloseTo(80 * darkness('#808080'), 1);
    // The pale grey's share (~9 %) is below the floor.
    expect(darkness('#e0e0e0')).toBeLessThan(0.25);
    expect(powers.get('#e0e0e0')).toBe(20);
  });

  it('stacked: each layer adds its darkness step, so the doses sum to the cut-out target', () => {
    // Every darkness step here is above the 10 % floor.
    const stacked = colourLayerPowers(['#000000', '#808080', '#c0c0c0'], 100, 'stacked');
    const lightest = stacked.get('#c0c0c0') as number;
    const middle = stacked.get('#808080') as number;
    const darkest = stacked.get('#000000') as number;
    // Stacked from the lightest up: black areas are burned by all three.
    expect(lightest + middle + darkest).toBeCloseTo(100, 0);
    expect(lightest + middle).toBeCloseTo(100 * (1 - hexOkLightness('#808080')), 0);
    expect(lightest).toBeCloseTo(100 * (1 - hexOkLightness('#c0c0c0')), 0);
  });

  it('never gives a near-duplicate tone a zero-power stacked operation', () => {
    const powers = colourLayerPowers(['#000000', '#010101'], 50, 'stacked');
    expect(powers.get('#000000')).toBe(5);
  });

  it('keeps the base power when every colour is white, and clamps the base', () => {
    expect(colourLayerPowers(['#ffffff'], 70, 'cut-out').get('#ffffff')).toBe(70);
    expect(colourLayerPowers(['#000000'], 140, 'cut-out').get('#000000')).toBe(100);
  });

  it('sets each colour operation from the colour its paths are bound to', () => {
    const object: TracedImage = {
      kind: 'traced-image',
      id: 'trace',
      source: 'logo.png',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: COLOURS.map((color, i) => ({ color, polylines: [], operationIds: [`op${i}`] })),
    };
    const operation = (id: string) => ({ ...createLayer({ id, color: '#123456' }), power: 60 });
    const operations = COLOURS.map((_, i) => operation(`op${i}`));
    const unbound = operation('other');
    const out = withColourLayerPowers(object, [...operations, unbound], 'cut-out');
    expect(out.map((operation) => operation.power)).toEqual([60, 24, 15, 60]);
    // No colour-layer output, or a CNC machine: operations stay as created.
    expect(withColourLayerPowers(object, operations, undefined)).toBe(operations);
    expect(withColourLayerPowers(object, operations, 'cut-out', { kind: 'cnc' })).toBe(operations);
  });
});
