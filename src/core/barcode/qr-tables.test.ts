import { describe, expect, it } from 'vitest';

import {
  PUBLISHED_ALIGNMENT_CENTRES,
  PUBLISHED_EC_ROWS,
  PUBLISHED_FORMAT_STRINGS,
  PUBLISHED_VERSION_STRINGS,
} from '../../__fixtures__/barcode/qr-published-tables';
import { qrFormatBits, qrVersionBits } from './qr-matrix';
import { QR_ERROR_CORRECTION_BITS, qrAlignmentCentres, qrBlockLayout, qrSize } from './qr-tables';

describe('QR Code tables against the published ISO/IEC 18004 tables', () => {
  it('covers all 160 version and level combinations', () => {
    expect(PUBLISHED_EC_ROWS).toHaveLength(160);
  });

  it.each(PUBLISHED_EC_ROWS.map((row) => [`${row.version}-${row.level}`, row] as const))(
    'block structure %s',
    (_label, row) => {
      const layout = qrBlockLayout(row.version, row.level);
      expect(layout.dataCodewords).toBe(row.dataCodewords);
      expect(layout.eccPerBlock).toBe(row.eccPerBlock);
      expect(layout.blocks).toBe(row.group1Blocks + row.group2Blocks);
      const published =
        row.group1Blocks * (row.group1Data + row.eccPerBlock) +
        row.group2Blocks * (row.group2Data + row.eccPerBlock);
      expect(layout.totalCodewords).toBe(published);
    },
  );

  it('places alignment patterns at the published centres for versions 1-40', () => {
    for (let version = 1; version <= 40; version += 1) {
      expect(qrAlignmentCentres(version), `version ${version}`).toEqual(
        PUBLISHED_ALIGNMENT_CENTRES[version],
      );
    }
  });

  it('sizes symbols from 21 to 177 modules', () => {
    expect(qrSize(1)).toBe(21);
    expect(qrSize(40)).toBe(177);
  });

  it('computes all 32 masked format words', () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      for (let mask = 0; mask < 8; mask += 1) {
        const word = qrFormatBits(QR_ERROR_CORRECTION_BITS[level], mask);
        expect(word.toString(2).padStart(15, '0'), `${level} mask ${mask}`).toBe(
          PUBLISHED_FORMAT_STRINGS[level][mask],
        );
      }
    }
  });

  it('computes the version words for versions 7-40', () => {
    for (let version = 7; version <= 40; version += 1) {
      expect(qrVersionBits(version).toString(2).padStart(18, '0'), `version ${version}`).toBe(
        PUBLISHED_VERSION_STRINGS[version],
      );
    }
  });
});
