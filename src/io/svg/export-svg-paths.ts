import type { Transform } from '../../core/scene';
import type { SvgMatrix } from './svg-curve-transform';

export function svgNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Artwork contains a non-finite coordinate.');
  // Local units and transform coefficients can be very small or very large.
  // Rounding either before multiplication changes the physical artwork size.
  // So write the exact shortest round-trip value, but as a plain decimal: a
  // 90° rotation's cosine is 6.123233995736766e-17, and SVG allows that
  // exponent while simple cutter and CAM path readers often do not (O8-P3-1).
  return plainDecimal(value);
}

function plainDecimal(value: number): string {
  const text = String(value);
  const exponentAt = text.indexOf('e');
  if (exponentAt < 0) return text;
  const exponent = Number(text.slice(exponentAt + 1));
  const fractionDigits = text.slice(0, exponentAt).split('.')[1]?.length ?? 0;
  const decimals = fractionDigits - exponent;
  // toFixed keeps every digit up to 100 decimals; beyond that (or for
  // |value| >= 1e21) the exact exponent form is the only lossless spelling.
  if (exponent > 0 || decimals > 100) return text;
  return value.toFixed(decimals);
}

export function xmlText(value: string): string {
  const valid = Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      );
    })
    .join('');
  return valid.replace(/[&<>"']/g, (char) => {
    const entities: Readonly<Record<string, string>> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char] ?? char;
  });
}

export function svgObjectMatrix(transform: Transform): SvgMatrix {
  // Match applyTransform's scale, mirror, rotation, then translation order.
  // Subtracting translated basis points would erase small scales near large offsets.
  const radians = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = transform.scaleX * (transform.mirrorX ? -1 : 1);
  const y = transform.scaleY * (transform.mirrorY ? -1 : 1);
  return {
    a: x * cos,
    b: x * sin,
    c: -y * sin,
    d: y * cos,
    e: transform.x,
    f: transform.y,
  };
}

export function svgMatrixAttribute(transform: Transform): string {
  const m = svgObjectMatrix(transform);
  return 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].map(svgNumber).join(' ') + ')';
}
