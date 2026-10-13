// One entry point over every supported symbology: text in, either a module
// matrix (QR Code, Data Matrix) or a bar/space sequence (1D) out, with a short
// description for the properties panel. Invalid data returns a message and
// no symbol, so a wrong code is never drawn.

import type { BarcodeSymbology } from '../scene/scene-object';
import { encodeCode128 } from './code128';
import { encodeCode39 } from './code39';
import { encodeDataMatrix, type BarcodeUse } from './data-matrix-encode';
import { encodeEanUpc } from './ean-upc';
import { encodeCodabar, encodeItf } from './codabar-itf';
import { encodeCode93 } from './code93';
import { encodeIsbn, encodeUpcE } from './upce-isbn';
import type { LinearEncodeResult, LinearSymbol } from './linear-symbol';
import { encodeQr } from './qr-encode';
import type { QrErrorCorrection } from './qr-tables';

export type MatrixBarcodeSymbol = {
  readonly kind: 'matrix';
  readonly size: number;
  /** Row-major, 1 = dark. */
  readonly modules: Uint8Array;
  readonly minQuietZoneModules: number;
  readonly description: string;
};

export type LinearBarcodeSymbol = {
  readonly kind: 'linear';
  readonly symbol: LinearSymbol;
  readonly description: string;
};

export type BarcodeSymbol = MatrixBarcodeSymbol | LinearBarcodeSymbol;

export type BarcodeSymbolResult =
  | { readonly ok: true; readonly symbol: BarcodeSymbol }
  | { readonly ok: false; readonly message: string };

export const BARCODE_SYMBOLOGY_LABELS: Readonly<Record<BarcodeSymbology, string>> = {
  qr: 'QR Code',
  'data-matrix': 'Data Matrix',
  code128: 'Code 128',
  code39: 'Code 39',
  ean13: 'EAN-13',
  upca: 'UPC-A',
  ean8: 'EAN-8',
  code93: 'Code 93',
  upce: 'UPC-E',
  codabar: 'Codabar',
  itf: 'Interleaved 2 of 5',
  isbn: 'ISBN (EAN-13)',
};

const LINEAR_ENCODERS: Readonly<
  Record<
    Exclude<BarcodeSymbology, 'qr' | 'data-matrix'>,
    readonly [(data: string) => LinearEncodeResult, string]
  >
> = {
  code128: [encodeCode128, 'Code 128'],
  code39: [(data) => encodeCode39(data), 'Code 39'],
  ean13: [(data) => encodeEanUpc('ean13', data), 'EAN-13'],
  upca: [(data) => encodeEanUpc('upca', data), 'UPC-A'],
  ean8: [(data) => encodeEanUpc('ean8', data), 'EAN-8'],
  code93: [encodeCode93, 'Code 93'],
  upce: [encodeUpcE, 'UPC-E'],
  codabar: [encodeCodabar, 'Codabar'],
  itf: [(data) => encodeItf(data), 'Interleaved 2 of 5'],
  isbn: [encodeIsbn, 'ISBN'],
};

export function encodeBarcodeSymbol(
  symbology: BarcodeSymbology,
  data: string,
  errorCorrection: QrErrorCorrection,
  use: BarcodeUse = 'edit',
): BarcodeSymbolResult {
  if (data.length === 0) return { ok: false, message: 'Enter the data to encode.' };
  if (symbology === 'qr') return qrSymbol(data, errorCorrection);
  if (symbology === 'data-matrix') return dataMatrixSymbol(data, use);
  const [encode, name] = LINEAR_ENCODERS[symbology];
  return linear(encode(data), name);
}

function qrSymbol(data: string, errorCorrection: QrErrorCorrection): BarcodeSymbolResult {
  const encoded = encodeQr(data, { errorCorrection });
  if (!encoded.ok) return encoded;
  const { version, size, modules } = encoded.symbol;
  return {
    ok: true,
    symbol: {
      kind: 'matrix',
      size,
      modules,
      minQuietZoneModules: 4,
      description: `QR Code version ${version} (${size} × ${size} modules), error correction ${errorCorrection}`,
    },
  };
}

function dataMatrixSymbol(data: string, use: BarcodeUse): BarcodeSymbolResult {
  const encoded = encodeDataMatrix(data, use);
  if (!encoded.ok) return encoded;
  const { size, modules } = encoded.symbol;
  return {
    ok: true,
    symbol: {
      kind: 'matrix',
      size,
      modules,
      minQuietZoneModules: 1,
      description: `Data Matrix ECC 200 (${size} × ${size} modules)`,
    },
  };
}

function linear(encoded: LinearEncodeResult, name: string): BarcodeSymbolResult {
  if (!encoded.ok) return encoded;
  const digits = encoded.symbol.text.map((run) => run.text).join('');
  const detail =
    /^\d+$/.test(digits) && !['Code 128', 'Code 39', 'Code 93', 'Codabar'].includes(name)
      ? ` ${digits}`
      : '';
  return {
    ok: true,
    symbol: {
      kind: 'linear',
      symbol: encoded.symbol,
      description: `${name}${detail} (${encoded.symbol.modules.length} modules wide)`,
    },
  };
}
