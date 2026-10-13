// Operation colour palettes for outside design software (LightBurn offers its
// layer palette as downloads). Drawing in these colours elsewhere means the
// imported artwork lands on matching KerfDesk operations. Three formats:
//   .gpl  GIMP / Inkscape / Krita palette (text);
//   .ase  Adobe Swatch Exchange (Illustrator, Photoshop, InDesign; binary,
//         big-endian, RGB float swatches);
//   .xml  CorelDRAW custom palette (RGB tints 0..1).

export type PaletteColor = { readonly name: string; readonly hex: string };
export type PaletteFormat = 'gpl' | 'ase' | 'xml';

function rgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function writeGimpPalette(title: string, colors: ReadonlyArray<PaletteColor>): string {
  const rows = colors.map((color) => {
    const [r, g, b] = rgb(color.hex);
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${color.name}`;
  });
  return ['GIMP Palette', `Name: ${title}`, 'Columns: 8', '#', ...rows, ''].join('\n');
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function writeCorelPalette(title: string, colors: ReadonlyArray<PaletteColor>): string {
  const rows = colors.map((color) => {
    const tints = rgb(color.hex)
      .map((channel) => (channel / 255).toFixed(6))
      .join(',');
    return `      <color cs="RGB" tints="${tints}" name="${escapeXml(color.name)}"/>`;
  });
  return [
    '<?xml version="1.0"?>',
    `<palette name="${escapeXml(title)}">`,
    '  <colors>',
    '    <page>',
    ...rows,
    '    </page>',
    '  </colors>',
    '</palette>',
    '',
  ].join('\n');
}

/** Adobe Swatch Exchange 1.0: "ASEF", version, block count, then one colour entry block per swatch. */
export function writeAdobeSwatchExchange(colors: ReadonlyArray<PaletteColor>): Uint8Array {
  const blocks = colors.map((color) => {
    const name = `${color.name}\u0000`;
    const length = 2 + name.length * 2 + 4 + 12 + 2;
    const bytes = new DataView(new ArrayBuffer(6 + length));
    bytes.setUint16(0, 0x0001); // colour entry
    bytes.setUint32(2, length);
    bytes.setUint16(6, name.length);
    let at = 8;
    for (let index = 0; index < name.length; index += 1, at += 2) {
      bytes.setUint16(at, name.charCodeAt(index));
    }
    for (const char of 'RGB ') bytes.setUint8(at++, char.charCodeAt(0));
    for (const channel of rgb(color.hex)) {
      bytes.setFloat32(at, channel / 255);
      at += 4;
    }
    bytes.setUint16(at, 2); // normal (not global or spot)
    return new Uint8Array(bytes.buffer);
  });
  const header = new DataView(new ArrayBuffer(12));
  'ASEF'.split('').forEach((char, index) => header.setUint8(index, char.charCodeAt(0)));
  header.setUint16(4, 1);
  header.setUint16(6, 0);
  header.setUint32(8, blocks.length);
  const total = 12 + blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(total);
  out.set(new Uint8Array(header.buffer), 0);
  let offset = 12;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

export function writePalette(
  format: PaletteFormat,
  title: string,
  colors: ReadonlyArray<PaletteColor>,
): string | Uint8Array {
  if (format === 'ase') return writeAdobeSwatchExchange(colors);
  return format === 'gpl' ? writeGimpPalette(title, colors) : writeCorelPalette(title, colors);
}
