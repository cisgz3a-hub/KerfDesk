// Canonical vector: public/app-icon.svg. No fonts or external artwork.
// Rebuild every browser, desktop and remote icon: pnpm generate:icons.
// --check renders in memory and verifies the committed outputs with this browser.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { format } from 'prettier';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check'))
  throw new Error('Use generate-brand-icons.mjs with no arguments or --check.');
const source = await readFile(new URL('public/app-icon.svg', root), 'utf8');
const formatOptions = JSON.parse(await readFile(new URL('.prettierrc', root), 'utf8'));
const maskable = source.replace(
  /(<\/defs>)([\s\S]*)(<\/svg>)/,
  '$1<rect width="512" height="512" fill="#101113" /><g transform="translate(51.2 51.2) scale(.8)">$2</g>$3',
);
// At taskbar/favicon sizes, omit the fine lamination lines. The silhouette and
// kerf between the ivory stem and brass ribbon remain identical.
const compact = source.replace(/  <g fill="none"[\s\S]*?<\/g>\n/, '');
const outputs = new Map([
  ['public/favicon.svg', Buffer.from(compact)],
  ['public/app-icon-maskable.svg', Buffer.from(maskable)],
  ['services/remote-control/app/static/icon.svg', Buffer.from(source)],
  ['services/remote-control/app/static/icon-maskable.svg', Buffer.from(maskable)],
]);
const browser = await chromium.launch(
  process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' },
);
const bitmaps = new Map();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(svg, size) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    return page.screenshot({ omitBackground: true, animations: 'disabled' });
  }
  for (const size of [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024])
    bitmaps.set(size, await render(size <= 48 ? compact : source, size));
  for (const [name, size] of [
    ['favicon-32x32.png', 32],
    ['apple-touch-icon.png', 180],
    ['app-icon-192x192.png', 192],
    ['app-icon-512x512.png', 512],
  ])
    outputs.set(`public/${name}`, bitmaps.get(size));
  const maskablePng = await render(maskable, 512);
  outputs.set('public/app-icon-maskable-512x512.png', maskablePng);
  for (const size of [192, 512])
    outputs.set(`services/remote-control/public/app/icon-${size}.png`, bitmaps.get(size));
  outputs.set('services/remote-control/public/app/icon-maskable-512.png', maskablePng);
} finally {
  await browser.close();
}

// PNG-backed ICO entries preserve alpha and supply native Windows sizes rather
// than asking the packager to downsample a single large bitmap.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const directory = Buffer.alloc(6 + icoSizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(icoSizes.length, 4);
let offset = directory.length;
icoSizes.forEach((size, i) => {
  const png = bitmaps.get(size);
  const at = 6 + i * 16;
  directory[at] = size === 256 ? 0 : size;
  directory[at + 1] = directory[at];
  directory.writeUInt16LE(1, at + 4);
  directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(png.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
outputs.set(
  'public/app-icon.ico',
  Buffer.concat([directory, ...icoSizes.map((n) => bitmaps.get(n))]),
);

const chunks = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
].map(([type, size]) => {
  const png = bitmaps.get(size);
  const header = Buffer.alloc(8);
  header.write(type);
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
outputs.set('public/app-icon.icns', Buffer.concat([icnsHeader, ...chunks]));

const stale = [];
for (const [name, bytes] of outputs) {
  const content = name.endsWith('.svg')
    ? Buffer.from(await format(bytes.toString(), { ...formatOptions, parser: 'html' }))
    : bytes;
  const path = new URL(name, root);
  if (check) {
    const existing = await readFile(path).catch(() => Buffer.alloc(0));
    if (!existing.equals(content)) stale.push(name);
  } else await writeFile(path, content);
}
if (stale.length)
  throw new Error(`Stale brand icons: ${stale.join(', ')}. Run pnpm generate:icons.`);
console.log(
  `KerfDesk brand icons: ${check ? 'verified' : 'generated'} ${outputs.size} assets from ${fileURLToPath(new URL('public/app-icon.svg', root))}.`,
);
