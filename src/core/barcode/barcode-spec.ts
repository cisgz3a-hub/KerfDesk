// Barcode object settings: defaults per symbology and the numeric ranges a
// spec must satisfy before it is drawn. Quiet zones default to each
// standard's minimum (QR Code 4, Code 128/39 10, EAN-13 11, UPC-A 9, EAN-8 7
// modules); Data Matrix takes 2 rather than its 1-module minimum because
// engraved edges on real stock are rarely crisp.

import type { BarcodeShape, BarcodeSymbology } from '../scene/scene-object';

export const BARCODE_LIMITS = {
  moduleMm: { min: 0.05, max: 50 },
  widthMm: { min: 1, max: 2000 },
  barHeightMm: { min: 0.5, max: 500 },
  quietZoneModules: { min: 0, max: 40 },
} as const;

const DEFAULT_QUIET_ZONE: Readonly<Record<BarcodeSymbology, number>> = {
  qr: 4,
  'data-matrix': 2,
  code128: 10,
  code39: 10,
  ean13: 11,
  upca: 9,
  ean8: 7,
};

/** The standard's minimum; smaller settings draw but earn a warning. */
export const MIN_QUIET_ZONE: Readonly<Record<BarcodeSymbology, number>> = {
  ...DEFAULT_QUIET_ZONE,
  'data-matrix': 1,
};

const SAMPLE_DATA: Readonly<Record<BarcodeSymbology, string>> = {
  qr: 'https://example.com',
  'data-matrix': 'KERF-0001',
  code128: 'KERF-0001',
  code39: 'KERF-0001',
  ean13: '5901234123457',
  upca: '036000291452',
  ean8: '96385074',
};

export function isMatrixSymbology(symbology: BarcodeSymbology): boolean {
  return symbology === 'qr' || symbology === 'data-matrix';
}

export function defaultBarcodeSpec(symbology: BarcodeSymbology = 'qr'): BarcodeShape {
  const matrix = isMatrixSymbology(symbology);
  return {
    kind: 'barcode',
    symbology,
    data: SAMPLE_DATA[symbology],
    errorCorrection: 'M',
    sizeMode: 'module',
    moduleMm: matrix ? 0.6 : 0.33,
    widthMm: matrix ? 25 : 40,
    barHeightMm: 15,
    quietZoneModules: DEFAULT_QUIET_ZONE[symbology],
    invert: false,
    showText: true,
  };
}
