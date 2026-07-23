// Builds public/third-party-notices.txt from the complete pnpm production
// dependency closure, bundled font records, and pinned OpenClipart artwork.
// Deterministic: sorted package input, pinned asset order, and no timestamps.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  CNC_STROKE_FONTS,
  OPENCLIPART_ASSETS,
  OUTLINE_FONTS,
  REPO_ROOT,
  collectElectronPackage,
  collectProductionPackages,
  verifyOpenClipartAssets,
} from './third-party-closure.mjs';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const DEFAULT_OUT_PATH = path.join(REPO_ROOT, 'public', 'third-party-notices.txt');

const LICENSE_TEXTS = {
  'Apache-2.0': fs.readFileSync(
    path.join(REPO_ROOT, 'scripts/license-texts/Apache-2.0.txt'),
    'utf8',
  ),
  'OFL-1.1': fs.readFileSync(path.join(REPO_ROOT, 'scripts/license-texts/OFL-1.1.txt'), 'utf8'),
};

function fontNameEntry(font, key) {
  // opentype.js >=2 nests name records per platform; older versions are flat.
  const entry = font.names.windows?.[key] ?? font.names.macintosh?.[key] ?? font.names[key];
  if (entry === undefined) return null;
  return entry.en ?? Object.values(entry)[0] ?? null;
}

function outlineFontSections(rootDir) {
  return OUTLINE_FONTS.map(({ file, name, spdx }) => {
    const abs = path.join(rootDir, file);
    if (!fs.existsSync(abs)) throw new Error(`font file missing: ${file}`);
    const data = fs.readFileSync(abs);
    const font = opentype.parse(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
    const copyright = fontNameEntry(font, 'copyright');
    if (copyright === null) throw new Error(`font ${name} has no copyright record`);
    const license = fontNameEntry(font, 'license');
    const licenseUrl = fontNameEntry(font, 'licenseURL');
    return [
      `--- Font: ${name} (${spdx}) ---`,
      `Bundled file: ${file}`,
      copyright,
      ...(license === null ? [] : [license]),
      ...(licenseUrl === null ? [] : [`License URL: ${licenseUrl}`]),
      `Full license text: see the ${spdx} section at the end of this file.`,
    ].join('\n');
  });
}

function cncStrokeFontSections() {
  return CNC_STROKE_FONTS.map((font) =>
    [
      `--- Font: ${font.name} (OFL-1.1) ---`,
      `Source file: ${font.file}`,
      ...font.attribution,
      `Pinned source snapshot: ${font.source}`,
      `Canonical source SHA-256: ${font.sha256}`,
      'Full license text: see the OFL-1.1 section at the end of this file.',
    ].join('\n'),
  );
}

function openClipartSections(rootDir) {
  verifyOpenClipartAssets(rootDir);
  return OPENCLIPART_ASSETS.map((asset) =>
    [
      `--- Artwork: ${asset.name} (CC0-1.0 / Public Domain) ---`,
      `Bundled file: ${asset.file}`,
      `Source: ${asset.source}`,
      `SHA-256: ${asset.sha256}`,
      'Openclipart states submitted clipart is released to the public domain under CC0.',
    ].join('\n'),
  );
}

function dependencySection(dependency) {
  return [
    `--- Package: ${dependency.name}@${dependency.version} (${dependency.license}) ---`,
    `License source(s): ${dependency.sourceFiles.join(', ')}`,
    dependency.text,
  ].join('\n');
}

function dependencySections(rootDir) {
  return collectProductionPackages(rootDir).map((dependency) => dependencySection(dependency));
}

function electronSection(rootDir) {
  const electron = collectElectronPackage(rootDir);
  return [
    dependencySection(electron),
    'Electron embeds Chromium and other upstream runtime components. Desktop',
    'packaging retains the Electron package license in these generated notices',
    'and explicitly bundles the Electron and Chromium runtime license files.',
  ].join('\n');
}

export function buildThirdPartyNotice(rootDir = REPO_ROOT) {
  const header = [
    'Third-Party Notices',
    '===================',
    '',
    'This application bundles the open-source components listed below. Each',
    'remains under its own license, reproduced here as those licenses require.',
    "The application's first-party software and documentation are MIT-licensed",
    '(see LICENSE). This file covers the complete installed dependency closure',
    'reported by `pnpm licenses list --prod`, the Electron package license,',
    'bundled fonts, and the eight pinned OpenClipart CC0 assets.',
    '',
    'Desktop artifacts also embed the Electron/Chromium runtime. Its upstream',
    'Electron package license is reproduced below; Electron/Chromium',
    'artifact-level license files are explicitly bundled and required by',
    'desktop package verification.',
  ].join('\n');
  const standardTexts = Object.entries(LICENSE_TEXTS)
    .map(([spdx, text]) => `=== ${spdx} full license text ===\n\n${text.trim()}`)
    .join('\n\n');
  return [
    header,
    '== Bundled fonts ==',
    ...outlineFontSections(rootDir),
    ...cncStrokeFontSections(),
    '== Bundled OpenClipart artwork ==',
    ...openClipartSections(rootDir),
    '== pnpm production dependency closure ==',
    ...dependencySections(rootDir),
    '== Electron desktop runtime package ==',
    electronSection(rootDir),
    standardTexts,
  ]
    .join('\n\n')
    .replace(/[ \t]+$/gm, '');
}

export function writeThirdPartyNotice(outPath = DEFAULT_OUT_PATH, rootDir = REPO_ROOT) {
  const output = buildThirdPartyNotice(rootDir);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${output}\n`);
  return { length: output.length, outPath };
}

function parseOutputArgument(args) {
  if (args.length === 0) return DEFAULT_OUT_PATH;
  if (args.length === 2 && args[0] === '--output') return path.resolve(args[1]);
  throw new Error('usage: node scripts/generate-third-party-notices.mjs [--output <file>]');
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = writeThirdPartyNotice(parseOutputArgument(process.argv.slice(2)));
    process.stdout.write(
      `wrote ${path.relative(REPO_ROOT, result.outPath)} (${result.length} chars)\n`,
    );
  } catch (error) {
    process.stderr.write(`generate-third-party-notices: ${error.message}\n`);
    process.exitCode = 1;
  }
}
