import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { tiffDocument } from '../../../src/__fixtures__/tiff-document.ts';

const out = path.resolve(import.meta.dirname);
fs.mkdirSync(out, { recursive: true });
function write(name, bytes) {
  fs.writeFileSync(path.join(out, name), bytes);
}
const stream = (value) => `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Resources << >> /Contents 4 0 R >>',
  stream('1 0 0 RG 1 w 10 10 m 50 10 l 50 50 l S 70 10 m 100 10 l 100 50 l s'),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  stream('0 0 1 rg BT /F1 18 Tf 10 30 Td (PDF text) Tj ET'),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('');
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
write('two-pages.pdf', pdf);
write('compatible.ai', pdf);
write('legacy.ai', '%!PS-Adobe-3.0\nshowpage\n');
write(
  'ordered-pens.plt',
  'IN;SP1;PU0,0;PD1600,0,1600,800,0,800,0,0;PU;SP2;PU400,400;PD1200,400;PU;',
);
write(
  'oriented-pages.tif',
  tiffDocument([
    { width: 2, height: 3, pixels: [0, 50, 100, 150, 200, 250], xDpi: 100, yDpi: 200 },
    {
      width: 2,
      height: 3,
      pixels: [0, 50, 100, 150, 200, 250],
      orientation: 6,
      xDpi: 100,
      yDpi: 200,
    },
  ]),
);
const bmp = Buffer.alloc(54 + 8 * 3 * 4);
bmp.write('BM');
bmp.writeUInt32LE(bmp.length, 2);
bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(8, 18);
bmp.writeInt32LE(4, 22);
bmp.writeUInt16LE(1, 26);
bmp.writeUInt16LE(24, 28);
bmp.writeInt32LE(Math.round(150 / 0.0254), 38);
bmp.writeInt32LE(Math.round(300 / 0.0254), 42);
for (let row = 0; row < 4; row++)
  for (let column = 0; column < 8; column++) {
    const offset = 54 + row * 24 + column * 3;
    bmp.fill(column < 4 ? 0 : 255, offset, offset + 3);
  }
write('density-150x300.bmp', bmp);
const gif = [...Buffer.from('GIF89a'), 64, 0, 32, 0, 0xf0, 0, 0, 0, 0, 0, 255, 255, 255];
gif.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
for (const colour of [0, 1]) {
  gif.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 64, 0, 32, 0, 0, 2);
  const codes = Array.from({ length: 64 * 32 }, () => [4, colour]).flat();
  codes.push(5);
  const packed = [];
  let buffer = 0,
    bits = 0;
  for (const code of codes) {
    buffer |= code << bits;
    bits += 3;
    if (bits >= 8) {
      packed.push(buffer & 255);
      buffer >>>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) packed.push(buffer & 255);
  for (let i = 0; i < packed.length; i += 255) {
    const block = packed.slice(i, i + 255);
    gif.push(block.length, ...block);
  }
  gif.push(0);
}
gif.push(0x3b);
write('black-then-white.gif', Buffer.from(gif));
