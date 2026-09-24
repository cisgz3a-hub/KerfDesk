import { describe, expect, it } from 'vitest';
import type { BedFit } from '../../core/scene/fit-to-bed';
import { describeImportBedFit } from './import-bed-fit-notice';

function fit(overrides: Partial<BedFit> = {}): BedFit {
  return {
    scale: 0.36,
    widthMm: 1000,
    heightMm: 500,
    bedWidthMm: 400,
    bedHeightMm: 400,
    ...overrides,
  };
}

describe('describeImportBedFit', () => {
  it('says nothing when the import kept its file size', () => {
    expect(describeImportBedFit('logo.svg', { kind: 'added' })).toBeNull();
    expect(describeImportBedFit('logo.svg', undefined)).toBeNull();
    expect(
      describeImportBedFit('logo.svg', {
        kind: 'replaced',
        source: 'logo.svg',
        kept: 1,
        added: 0,
        removed: 0,
      }),
    ).toBeNull();
  });

  it('names the bed, the file size, the scale and the way back', () => {
    expect(describeImportBedFit('sign.svg', { kind: 'added', bedFit: fit() })).toEqual({
      message:
        'sign.svg is larger than the 400 × 400 mm bed (1000 × 500 mm), so it was scaled to 36% ' +
        'to fit. Undo restores the original size.',
      variant: 'warning',
    });
  });

  it('keeps fractional sizes and tiny scales readable', () => {
    const notice = describeImportBedFit('photo.jpg', {
      kind: 'added',
      bedFit: fit({ scale: 0.000253125, widthMm: 1422.24, heightMm: 1066.8, bedWidthMm: 406.5 }),
    });

    expect(notice?.message).toContain('the 406.5 × 400 mm bed (1422.2 × 1066.8 mm)');
    expect(notice?.message).toContain('scaled to 0.0253% to fit');
  });
});
