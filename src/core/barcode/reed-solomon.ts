// Reed-Solomon error-correction codewords over GF(256), shared by QR Code and
// Data Matrix. The two symbologies differ only in the field's primitive
// polynomial and in the first root of the generator polynomial:
//   QR Code (ISO/IEC 18004):        x^8+x^4+x^3+x^2+1 (0x11d), roots α^0..α^(n-1)
//   Data Matrix (ISO/IEC 16022):    x^8+x^5+x^3+x^2+1 (0x12d), roots α^1..α^n

export type GaloisField = {
  readonly exp: Uint8Array;
  readonly log: Uint8Array;
};

export const QR_FIELD = galoisField(0x11d);
export const DATA_MATRIX_FIELD = galoisField(0x12d);

export function galoisField(primitive: number): GaloisField {
  const exp = new Uint8Array(510);
  const log = new Uint8Array(256);
  let value = 1;
  for (let power = 0; power < 255; power += 1) {
    exp[power] = value;
    log[value] = power;
    value <<= 1;
    if (value > 0xff) value ^= primitive;
  }
  // A doubled table lets a product index log(a)+log(b) without a modulo.
  for (let power = 255; power < 510; power += 1) exp[power] = exp[power - 255] ?? 0;
  return { exp, log };
}

export function gfMultiply(field: GaloisField, left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return field.exp[(field.log[left] ?? 0) + (field.log[right] ?? 0)] ?? 0;
}

/** Coefficients of Π(x - α^(firstRoot+i)), highest degree first, leading 1 dropped. */
export function reedSolomonGenerator(
  field: GaloisField,
  degree: number,
  firstRoot: number,
): Uint8Array {
  let poly: number[] = [1];
  for (let index = 0; index < degree; index += 1) {
    const root = field.exp[(firstRoot + index) % 255] ?? 0;
    const next = new Array<number>(poly.length + 1).fill(0);
    poly.forEach((coefficient, power) => {
      next[power] = (next[power] ?? 0) ^ coefficient;
      next[power + 1] = (next[power + 1] ?? 0) ^ gfMultiply(field, coefficient, root);
    });
    poly = next;
  }
  return Uint8Array.from(poly.slice(1));
}

/** Remainder of data(x)·x^n divided by the generator: the n check codewords. */
export function reedSolomonRemainder(
  field: GaloisField,
  data: Iterable<number>,
  generator: Uint8Array,
): Uint8Array {
  const remainder = new Uint8Array(generator.length);
  for (const value of data) {
    const factor = value ^ (remainder[0] ?? 0);
    remainder.copyWithin(0, 1);
    remainder[remainder.length - 1] = 0;
    for (let term = 0; term < generator.length; term += 1) {
      remainder[term] = (remainder[term] ?? 0) ^ gfMultiply(field, generator[term] ?? 0, factor);
    }
  }
  return remainder;
}
