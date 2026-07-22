// generate-third-party-notices.mjs — builds public/third-party-notices.txt
// from the real license sources: each direct package.json dependency's LICENSE
// file in node_modules, plus bundled font copyright records with the canonical
// Apache-2.0 / OFL-1.1 texts (scripts/license-texts/). The output
// ships inside dist/web (vite publicDir), which electron-builder also packs,
// so both distributions carry this direct-dependency/font notice input. ADR-248
// separately requires transitive/Electron/Chromium/asset closure per artifact.
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

const CNC_STROKE_FONTS = [
  {
    name: 'Relief SingleLine',
    file: 'ReliefSingleLineSVG-Regular.svg',
    source:
      'https://github.com/isdat-type/Relief-SingleLine/tree/' +
      '01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d',
    sha256: '75f05a5b64ed6039c9816628ee051d98e16c19148a8268c63f5eccf8382479e2',
    attribution: [
      'Source SVG notice: Copyright 2021 The Relief SingleLine Project Authors',
      'OFL distribution notice: Copyright 2022 The Relief SingleLine Project Authors',
      'Authors: François Chastanet, Noëlie Dayma, Élisa Garzelli',
    ],
  },
  {
    name: 'EMS Nixish',
    file: 'EMSNixish.svg',
    source:
      'https://gitlab.com/oskay/svg-fonts/-/tree/' +
      '8c71f2d9e1a5292047bb88e5595a766241b82cc6/fonts/EMS',
    sha256: '418b9986220ebce947396af4f918d20266cd42d22d4d141fdd52c8ea20980ec6',
    attribution: [
      'Created by Sheldon B. Michaels; SVG font conversion by Windell H. Oskay',
      'Derivative of Nixie One; designer Jovanny Lemonad',
    ],
  },
  {
    name: 'EMS Decorous Script',
    file: 'EMSDecorousScript.svg',
    source:
      'https://gitlab.com/oskay/svg-fonts/-/tree/' +
      '8c71f2d9e1a5292047bb88e5595a766241b82cc6/fonts/EMS',
    sha256: '131fc9b7cead71f7a907aa793b7a862be2acef041209e7a2dedc233a2d53ebfc',
    attribution: [
      'Created by Sheldon B. Michaels; SVG font conversion by Windell H. Oskay',
      'Derivative of Petit Formal Script; designer Impallari Type',
    ],
  },
  {
    name: 'EMS Casual Hand',
    file: 'EMSCasualHand.svg',
    source:
      'https://gitlab.com/oskay/svg-fonts/-/tree/' +
      '8c71f2d9e1a5292047bb88e5595a766241b82cc6/fonts/EMS',
    sha256: 'e8c64afb9739ff78b3cd0ae1bfb95d21fb1077eda569e0eef5d262b64da38041',
    attribution: [
      'Created by Sheldon B. Michaels; SVG font conversion by Windell H. Oskay',
      'Derivative of Covered By Your Grace; designer Kimberly Geswein',
    ],
  },
];

const LICENSE_TEXTS = {
  'Apache-2.0': fs.readFileSync(path.join(root, 'scripts/license-texts/Apache-2.0.txt'), 'utf8'),
  'OFL-1.1': fs.readFileSync(path.join(root, 'scripts/license-texts/OFL-1.1.txt'), 'utf8'),
};

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
  const cncStrokeFonts = CNC_STROKE_FONTS.map((font) =>
    [
      `--- Font: ${font.name} (OFL-1.1) ---`,
      `Source file: ${font.file}`,
      ...font.attribution,
      `Pinned source snapshot: ${font.source}`,
      `Canonical source SHA-256: ${font.sha256}`,
      'Full license text: see the OFL-1.1 section at the end of this file.',
    ].join('\n'),
  );
  return [...outlineFonts, ...cncStrokeFonts];
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
  "The application's first-party software and documentation, in source and",
  'compiled/bundled form, are MIT-licensed (see LICENSE). This file covers the',
  'direct dependencies and fonts below; it is not complete artifact closure.',
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
