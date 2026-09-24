import { describe, expect, it } from 'vitest';
import { BIT_PHOTO_ASSETS } from '../tutorials/bit-photo-assets';
import { MODELED_CNC_BIT_CATALOG } from './cnc-bit-catalog';
import { cncBitPicture } from './cnc-bit-picture';
import { cncToolFamilyLabel } from './CncToolOptions';

describe('CNC bit picture mapping', () => {
  it('covers every modeled catalog family with an existing family-specific asset', () => {
    const families = new Set<string>();
    for (const entry of MODELED_CNC_BIT_CATALOG) {
      const picture = cncBitPicture(entry.tool);
      expect(picture.geometryOnly, entry.id).not.toBe(true);
      expect(BIT_PHOTO_ASSETS[picture.key], entry.id).toBeDefined();
      families.add(picture.key);
    }
    expect(families.size).toBe(13);
    expect(families).toContain('bit-o-flute-ball-nose');
    const oBall = MODELED_CNC_BIT_CATALOG.find((entry) => entry.family === 'o-flute-ball-nose');
    expect(oBall).toBeDefined();
    if (oBall === undefined) throw new Error('O-flute ball-nose catalog fixture missing');
    expect(cncToolFamilyLabel({ ...oBall.tool, id: 'test' })).toBe('O-flute ball-nose bits');
    // Amana's O-flute ball-nose bits are single-flute (ToolsToday 51814, 51818).
    expect(oBall.tool.fluteCount).toBe(1);
  });

  it('never lets an unknown or conflicting custom family override its geometry kind', () => {
    expect(cncBitPicture({ kind: 'end-mill', family: 'constructor' })).toMatchObject({
      key: 'bit-straight',
      geometryOnly: true,
      label: 'Flat-end geometry',
    });
    expect(cncBitPicture({ kind: 'ball-nose', family: 'upcut' })).toMatchObject({
      key: 'bit-ball-nose',
      geometryOnly: true,
    });
    expect(cncBitPicture({ kind: 'v-bit', family: 'ball-nose' }).key).toBe('bit-v-groove');
    expect(cncBitPicture({ kind: 'end-mill' }).geometryOnly).toBe(true);
  });

  it('distinguishes the engraving point from a positive tip flat without changing the tool', () => {
    expect(cncBitPicture({ kind: 'engraving' }).key).toBe('bit-engraving-point');
    expect(cncBitPicture({ kind: 'engraving', tipDiameterMm: 0 }).key).toBe('bit-engraving-point');
    const flat = Object.freeze({ kind: 'engraving' as const, tipDiameterMm: 0.2 });
    expect(cncBitPicture(flat).key).toBe('bit-engraving-flat');
    expect(flat).toEqual({ kind: 'engraving', tipDiameterMm: 0.2 });
  });
});
