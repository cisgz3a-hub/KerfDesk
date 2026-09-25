// Complete QR Code symbols produced by an independent, widely deployed encoder
// (ZXing core/src/test/java/com/google/zxing/qrcode/encoder/EncoderTestCase.java,
// Apache-2.0). Rows run top to bottom, '1' is a dark module. Both symbols were
// chosen by that encoder's own mask evaluation, so they also pin mask choice.

export type ReferenceQrSymbol = {
  readonly text: string;
  readonly errorCorrection: 'L' | 'M' | 'Q' | 'H';
  readonly version: number;
  readonly mask: number;
  readonly rows: readonly string[];
};

export const REFERENCE_QR_SYMBOLS: readonly ReferenceQrSymbol[] = [
  {
    text: 'ABCDEF',
    errorCorrection: 'H',
    version: 1,
    mask: 0,
    rows: [
      '111111101111001111111',
      '100000100111001000001',
      '101110100101101011101',
      '101110101110101011101',
      '101110100111001011101',
      '100000100100001000001',
      '111111101010101111111',
      '000000000010100000000',
      '001011101100110001001',
      '101110010001010000000',
      '001100101000101010110',
      '110101011101010000010',
      '001101111000101011110',
      '000000001001110101000',
      '111111100010101100001',
      '100000101111010111101',
      '101110101011010100001',
      '101110100110111101010',
      '101110101000101011101',
      '100000100110110100011',
      '111111100000000010101',
    ],
  },
  {
    text: '0123',
    errorCorrection: 'M',
    version: 1,
    mask: 0,
    rows: [
      '111111100000101111111',
      '100000101101001000001',
      '101110100110001011101',
      '101110100010001011101',
      '101110101011101011101',
      '100000100101001000001',
      '111111101010101111111',
      '000000000110000000000',
      '101010100000100010010',
      '000000011011010101010',
      '010101111001011101010',
      '011100000011110111010',
      '000111111111011100101',
      '000000001100001000110',
      '111111100100100010001',
      '100000100100001000100',
      '101110101100101010101',
      '101110100111010101010',
      '101110101011011101101',
      '100000100011110111000',
      '111111101011011101101',
    ],
  },
];

export function referenceModules(rows: readonly string[]): Uint8Array {
  return Uint8Array.from(rows.join(''), (char) => (char === '1' ? 1 : 0));
}
