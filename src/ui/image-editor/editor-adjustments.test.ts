import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { ADJUSTMENTS, adjustmentById, defaultParams, runAdjustment } from './editor-adjustments';

describe('adjustment catalog', () => {
  it('every entry resolves by id and defaults sit inside its ranges', () => {
    for (const spec of ADJUSTMENTS) {
      expect(adjustmentById(spec.id)).toBe(spec);
      for (const param of spec.params) {
        expect(param.defaultValue).toBeGreaterThanOrEqual(param.min);
        expect(param.defaultValue).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it('splits into the two menus with the parameterless entries in Adjust', () => {
    const adjust = ADJUSTMENTS.filter((a) => a.menu === 'adjust');
    const filter = ADJUSTMENTS.filter((a) => a.menu === 'filter');
    expect(adjust.length + filter.length).toBe(ADJUSTMENTS.length);
    expect(adjust.some((a) => a.params.length === 0)).toBe(true);
    expect(filter.every((a) => a.params.length > 0)).toBe(true);
  });
});

describe('runAdjustment', () => {
  it('dispatches invert per channel', () => {
    const doc = createRgbaBuffer(2, 2);
    runAdjustment('invert', {}, doc, null, null);
    expect(doc.data[0]).toBe(0);
    expect(doc.data[3]).toBe(255); // alpha untouched
  });

  it('dispatches threshold through the luma path', () => {
    const doc = createRgbaBuffer(1, 1);
    doc.data[0] = 200;
    doc.data[1] = 10;
    doc.data[2] = 10;
    // luma(200,10,10) = 67 -> below default level 128 -> black
    runAdjustment('threshold', defaultParams(adjustmentById('threshold')), doc, null, null);
    expect([doc.data[0], doc.data[1], doc.data[2]]).toEqual([0, 0, 0]);
  });

  it('runs every catalog entry at defaults without corrupting the buffer', () => {
    for (const spec of ADJUSTMENTS) {
      const doc = createRgbaBuffer(8, 8);
      doc.data[0] = 40;
      runAdjustment(spec.id, defaultParams(spec), doc, null, null);
      expect(doc.data.length).toBe(8 * 8 * 4);
      for (let i = 3; i < doc.data.length; i += 4) expect(doc.data[i]).toBe(255);
    }
  });

  it('falls back to spec defaults for missing params', () => {
    const doc = createRgbaBuffer(1, 1);
    doc.data[0] = 100;
    doc.data[1] = 100;
    doc.data[2] = 100;
    runAdjustment('brightness-contrast', {}, doc, null, null); // defaults = identity
    expect(doc.data[0]).toBe(100);
  });
});
