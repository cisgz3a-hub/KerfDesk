// generate-third-party-notices.mjs — builds public/third-party-notices.txt
// from the real license sources: each production dependency's LICENSE file in
// node_modules, plus the bundled fonts' name-table copyright records with the
// canonical Apache-2.0 / OFL-1.1 texts (scripts/license-texts/). The output
// ships inside dist/web (vite publicDir), which electron-builder also packs,
// so both distributions carry the notices their licenses require.
//
// Deterministic: sorted dependency order, no timestamps. Fails loudly when a
// license source is missing so a new dependency cannot ship un-attributed.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OUT_PATH = path.join(root, 'public', 'third-party-notices.txt');

const FONTS = [
  { file: 'src/ui/text/fonts/Roboto-Regular.ttf', name: 'Roboto', spdx: 'Apache-2.0' },
  { file: 'src/ui/text/fonts/Inconsolata-Regular.ttf', name: 'Inconsolata', spdx: 'OFL-1.1' },
  { file: 'src/ui/text/fonts/Pacifico-Regular.ttf', name: 'Pacifico', spdx: 'OFL-1.1' },
  { file: 'src/ui/text/fonts/DancingScript-Regular.ttf', name: 'Dancing Script', spdx: 'OFL-1.1' },
];

const EMS_STROKE_FONTS = [
  {
    name: 'EMS Allure',
    derivative: 'Allura',
    designer: 'Rob Leuschke, TypeSETit',
  },
  {
    name: 'EMS Delight',
    derivative: 'Delius',
    designer: 'Natalia Raices',
  },
  {
    name: 'EMS Tech',
    derivative: 'Architects Daughter',
    designer: 'Kimberly Geswein, Kimberly Geswein Fonts',
  },
  {
    name: 'EMS Osmotron',
    derivative: 'Orbitron (Regular)',
    designer: 'Matt McInerney, the League of Moveable Type',
  },
];

const LICENSE_TEXTS = {
  'Apache-2.0': fs.readFileSync(path.join(root, 'scripts/license-texts/Apache-2.0.txt'), 'utf8'),
  'OFL-1.1': fs.readFileSync(path.join(root, 'scripts/license-texts/OFL-1.1.txt'), 'utf8'),
};

const HERSHEY_NOTICE = fs
  .readFileSync(path.join(root, 'scripts/license-texts/Hershey.txt'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .join('\n');

function fail(message) {
  process.stderr.write(`generate-third-party-notices: ${message}\n`);
  process.exit(1);
}

function fontNameEntry(font, key) {
  // opentype.js ≥2 nests name records per platform; older versions are flat.
  const entry = font.names.windows?.[key] ?? font.names.macintosh?.[key] ?? font.names[key];
  if (entry === undefined) return null;
  return entry.en ?? Object.values(entry)[0] ?? null;
}

function fontSections() {
  const outlineFonts = FONTS.map(({ file, name, spdx }) => {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) fail(`font file missing: ${file}`);
    const data = fs.readFileSync(abs);
    const font = opentype.parse(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
    const copyright = fontNameEntry(font, 'copyright');
    if (copyright === null) fail(`font ${name} has no copyright record in its name table`);
    const license = fontNameEntry(font, 'license');
    const licenseUrl = fontNameEntry(font, 'licenseURL');
    return [
      `--- Font: ${name} (${spdx}) ---`,
      copyright,
      ...(license === null ? [] : [license]),
      ...(licenseUrl === null ? [] : [`License URL: ${licenseUrl}`]),
      `Full license text: see the ${spdx} section at the end of this file.`,
    ].join('\n');
  });
  const emsStrokeFonts = EMS_STROKE_FONTS.map(({ name, derivative, designer }) =>
    [
      `--- Font: ${name} (OFL-1.1) ---`,
      `Single-line derivative of ${derivative} by ${designer}.`,
      'Stroke-font creation by Sheldon B. Michaels.',
      'SVG font conversion by Windell H. Oskay.',
      'Source: https://gitlab.com/oskay/svg-fonts',
      'Full license text: see the OFL-1.1 section at the end of this file.',
    ].join('\n'),
  );
  return [
    ...outlineFonts,
    ...emsStrokeFonts,
    [
      '--- Font: Hershey Roman Simplex (Hershey redistribution terms) ---',
      'Created by Dr. A. V. Hershey at the U. S. National Bureau of Standards.',
      'Distribution format created by James Hurt, Cognition, Inc.',
      HERSHEY_NOTICE.trim(),
    ].join('\n'),
  ];
}

function findLicenseFile(depDir) {
  const candidates = fs
    .readdirSync(depDir)
    .filter((entry) => /^licen[sc]e/i.test(entry))
    .sort();
  const first = candidates[0];
  return first === undefined ? null : path.join(depDir, first);
}

function dependencySections() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const names = Object.keys(pkg.dependencies ?? {}).sort();
  return names.map((name) => {
    const depDir = path.join(root, 'node_modules', name);
    const depPkg = JSON.parse(fs.readFileSync(path.join(depDir, 'package.json'), 'utf8'));
    const licenseFile = findLicenseFile(depDir);
    if (licenseFile === null) fail(`no LICENSE file found for dependency ${name}`);
    const text = fs.readFileSync(licenseFile, 'utf8').trim();
    return [`--- Package: ${name}@${depPkg.version} (${depPkg.license}) ---`, text].join('\n');
  });
}

const header = [
  'Third-Party Notices',
  '===================',
  '',
  'This application bundles the open-source components listed below. Each',
  'remains under its own license, reproduced here as those licenses require.',
  "The application's own source code is MIT-licensed (see LICENSE); this file",
  'covers the bundled third-party components.',
].join('\n');

const standardTexts = Object.entries(LICENSE_TEXTS)
  .map(([spdx, text]) => `=== ${spdx} full license text ===\n\n${text.trim()}`)
  .join('\n\n');

const output = [
  header,
  '== Bundled fonts ==',
  ...fontSections(),
  '== npm packages ==',
  ...dependencySections(),
  standardTexts,
].join('\n\n');

fs.writeFileSync(OUT_PATH, `${output}\n`);
process.stdout.write(`wrote ${path.relative(root, OUT_PATH)} (${output.length} chars)\n`);
