// Generates checked-in CNC open-stroke font data from pinned OFL-1.1 sources.
// Normal builds use the generated TypeScript and do not require network access.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RELIEF_COMMIT = '01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d';
const EMS_COMMIT = '8c71f2d9e1a5292047bb88e5595a766241b82cc6';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'src/core/text/cnc-stroke-font-data.ts');
const SUPPORTED_PATH_COMMANDS = new Set('MmLlHhVvCcSsZz');
const NUMBER_AT_START = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
// A declared cap-height may differ from the H by rounding, never by more than
// this share of the em; anything else is a placeholder the entry must name.
const CAP_HEIGHT_TOLERANCE_EM = 0.01;
const ATTR_PATTERN = /([:\w-]+)\s*=\s*"([\s\S]*?)"/g;
const GLYPH_PATTERN = /<glyph\b([\s\S]*?)\/>/g;

const LICENSES = [
  {
    name: 'Relief SingleLine',
    url: `https://raw.githubusercontent.com/isdat-type/Relief-SingleLine/${RELIEF_COMMIT}/OFL.txt`,
    sha256: '005834fd32a01fb021a44167cafd4fa3df8058a7b0fb7319bd19b445d2fe24a3',
    markers: [
      'Copyright 2022 The Relief SingleLine Project Authors',
      'SIL OPEN FONT LICENSE Version 1.1',
    ],
  },
  {
    name: 'EMS SVG Fonts',
    url: `https://gitlab.com/oskay/svg-fonts/-/raw/${EMS_COMMIT}/fonts/EMS/OFL.txt`,
    sha256: 'ca122f3bda0154f692817450168cb650a7fc59ef96c93582acd2e7a744d464d3',
    markers: ['SIL OPEN FONT LICENSE Version 1.1'],
  },
];

const FONTS = [
  {
    key: 'relief-single-line',
    displayName: 'Relief SingleLine',
    sourceFile: 'ReliefSingleLineSVG-Regular.svg',
    sourceSha256: '75f05a5b64ed6039c9816628ee051d98e16c19148a8268c63f5eccf8382479e2',
    sourceCommit: RELIEF_COMMIT,
    sourceUrl:
      `https://raw.githubusercontent.com/isdat-type/Relief-SingleLine/${RELIEF_COMMIT}/` +
      'fonts/open_svg/ReliefSingleLineSVG-Regular.svg',
    metadataMarkers: [
      'Copyright 2021 The Relief SingleLine Project Authors',
      'font-family="Relief SingleLine SVG"',
    ],
  },
  {
    key: 'ems-nixish',
    displayName: 'EMS Nixish',
    sourceFile: 'EMSNixish.svg',
    sourceSha256: '418b9986220ebce947396af4f918d20266cd42d22d4d141fdd52c8ea20980ec6',
    sourceCommit: EMS_COMMIT,
    sourceUrl: `https://gitlab.com/oskay/svg-fonts/-/raw/${EMS_COMMIT}/fonts/EMS/EMSNixish.svg`,
    // The EMS sources all declare cap-height="500"; their capitals rise
    // 640-880 units. Text scales by the em (ADR-682), and the generator records
    // the measured capital height instead of this attribute.
    placeholderCapHeight: 500,
    metadataMarkers: [
      'Font name:               EMS Nixish',
      'License:                 SIL Open Font License',
    ],
  },
  {
    key: 'ems-decorous-script',
    displayName: 'EMS Decorous Script',
    sourceFile: 'EMSDecorousScript.svg',
    sourceSha256: '131fc9b7cead71f7a907aa793b7a862be2acef041209e7a2dedc233a2d53ebfc',
    sourceCommit: EMS_COMMIT,
    sourceUrl:
      `https://gitlab.com/oskay/svg-fonts/-/raw/${EMS_COMMIT}/fonts/EMS/` + 'EMSDecorousScript.svg',
    placeholderCapHeight: 500,
    metadataMarkers: [
      'Font name:               EMS Decorous Script',
      'License:                 SIL Open Font License',
    ],
  },
  {
    key: 'ems-casual-hand',
    displayName: 'EMS Casual Hand',
    sourceFile: 'EMSCasualHand.svg',
    sourceSha256: 'e8c64afb9739ff78b3cd0ae1bfb95d21fb1077eda569e0eef5d262b64da38041',
    sourceCommit: EMS_COMMIT,
    sourceUrl: `https://gitlab.com/oskay/svg-fonts/-/raw/${EMS_COMMIT}/fonts/EMS/EMSCasualHand.svg`,
    placeholderCapHeight: 500,
    metadataMarkers: [
      'Font name:               EMS Casual Hand',
      'License:                 SIL Open Font License',
    ],
  },
];

function fail(message) {
  throw new Error(`generate-cnc-stroke-fonts: ${message}`);
}

function attributes(source) {
  return Object.fromEntries(
    [...source.matchAll(ATTR_PATTERN)].map((match) => [match[1], match[2]]),
  );
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)));
}

function requiredNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`invalid ${label}: ${String(value)}`);
  return parsed;
}

function validatePath(pathData, fontName, character) {
  let index = 0;
  while (index < pathData.length) {
    const separators = /^[\s,]+/.exec(pathData.slice(index));
    if (separators !== null) index += separators[0].length;
    if (index >= pathData.length) return;
    const next = pathData[index];
    if (next !== undefined && /[A-Za-z]/.test(next)) {
      if (!SUPPORTED_PATH_COMMANDS.has(next)) {
        fail(`${fontName} glyph ${JSON.stringify(character)} uses unsupported command ${next}`);
      }
      index += 1;
      continue;
    }
    const number = NUMBER_AT_START.exec(pathData.slice(index));
    if (number === null) {
      fail(`${fontName} glyph ${JSON.stringify(character)} contains invalid path data`);
    }
    index += number[0].length;
  }
}

// The highest on-curve point of a glyph's path, y-up from the baseline. Every
// command the sources use is walked so relative moves land where they draw.
function pathTop(pathData) {
  const tokens = [...pathData.matchAll(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map(
    (match) => match[0],
  );
  const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Z: 0 };
  let x = 0,
    y = 0,
    startX = 0,
    startY = 0,
    top = -Infinity,
    command = '',
    index = 0;
  while (index < tokens.length) {
    if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const values = tokens.slice(index, index + arity[upper]).map(Number);
    index += arity[upper];
    if (upper === 'Z') {
      [x, y] = [startX, startY];
      continue;
    }
    if (upper === 'H') x = (relative ? x : 0) + values[0];
    else if (upper === 'V') y = (relative ? y : 0) + values[0];
    else {
      x = (relative ? x : 0) + values[values.length - 2];
      y = (relative ? y : 0) + values[values.length - 1];
    }
    if (upper === 'M') {
      [startX, startY] = [x, y];
      // Further pairs after a moveto are linetos.
      command = relative ? 'l' : 'L';
    }
    top = Math.max(top, y);
  }
  return top;
}

// Text scales by the em (ADR-682), so the capital height is only checked and
// recorded. It is measured from the H, because a font's cap-height attribute
// can be a placeholder the glyphs never follow.
function capitalHeight(entry, faceAttrs, glyphs, unitsPerEm) {
  const label = entry.displayName;
  const path = glyphs.H?.path;
  if (path === undefined) fail(`${label} must provide an H to measure its capitals`);
  const measured = pathTop(path);
  if (!(measured > 0)) fail(`${label} H has no height above the baseline`);
  const declared = requiredNumber(faceAttrs['cap-height'], `${label} cap height`);
  const agrees = Math.abs(declared - measured) <= CAP_HEIGHT_TOLERANCE_EM * unitsPerEm;
  if (agrees && entry.placeholderCapHeight !== undefined) {
    fail(`${label} cap-height ${declared} now matches its H; remove placeholderCapHeight`);
  }
  if (!agrees && entry.placeholderCapHeight !== declared) {
    fail(
      `${label} declares cap-height ${declared} but its H rises ${measured} units; ` +
        'name the attribute as placeholderCapHeight only after checking the glyphs',
    );
  }
  return measured;
}

function parseFont(svg, entry) {
  const expectedName = entry.displayName;
  const fontAttrs = attributes(svg.match(/<font\s+([^>]+)>/)?.[1] ?? '');
  const faceAttrs = attributes(svg.match(/<font-face\b([\s\S]*?)\/>/)?.[1] ?? '');
  const defaultAdvance = requiredNumber(
    fontAttrs['horiz-adv-x'],
    `${expectedName} default advance`,
  );
  const unitsPerEm = requiredNumber(faceAttrs['units-per-em'], `${expectedName} units per em`);
  if (!(unitsPerEm > 0)) fail(`${expectedName} units per em must be positive`);
  const glyphs = {};
  for (const match of svg.matchAll(GLYPH_PATTERN)) {
    const attrs = attributes(match[1] ?? '');
    if (attrs.unicode === undefined) continue;
    const character = decodeXml(attrs.unicode);
    if (Array.from(character).length !== 1) continue;
    const pathData = attrs.d;
    if (pathData !== undefined) validatePath(pathData, expectedName, character);
    glyphs[character] = {
      advance: requiredNumber(
        attrs['horiz-adv-x'] ?? defaultAdvance,
        `${expectedName} glyph advance`,
      ),
      ...(pathData === undefined ? {} : { path: pathData }),
    };
  }
  if (glyphs['?'] === undefined || glyphs[' '] === undefined) {
    fail(`${expectedName} must provide space and fallback glyphs`);
  }
  const capHeight = capitalHeight(entry, faceAttrs, glyphs, unitsPerEm);
  return { unitsPerEm, capHeight, defaultAdvance, glyphs };
}

async function fetchPinnedText(url, expectedSha256, label) {
  const response = await fetch(url);
  if (!response.ok) fail(`${label} fetch failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    fail(`${label} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
  return bytes.toString('utf8');
}

async function verifyLicenses() {
  await Promise.all(
    LICENSES.map(async (license) => {
      const text = await fetchPinnedText(license.url, license.sha256, `${license.name} license`);
      for (const marker of license.markers) {
        if (!text.includes(marker))
          fail(`${license.name} license is missing ${JSON.stringify(marker)}`);
      }
    }),
  );
}

async function loadFont(entry) {
  const svg = await fetchPinnedText(entry.sourceUrl, entry.sourceSha256, entry.sourceFile);
  for (const marker of entry.metadataMarkers) {
    if (!svg.includes(marker)) {
      fail(`${entry.displayName} source is missing ${JSON.stringify(marker)}`);
    }
  }
  return {
    key: entry.key,
    displayName: entry.displayName,
    license: 'OFL-1.1',
    sourceFile: entry.sourceFile,
    sourceSha256: entry.sourceSha256,
    sourceCommit: entry.sourceCommit,
    sourceUrl: entry.sourceUrl,
    ...parseFont(svg, entry),
  };
}

await verifyLicenses();
const fonts = await Promise.all(FONTS.map(loadFont));
const generated = [
  '// Generated by scripts/generate-cnc-stroke-fonts.mjs. Do not edit by hand.',
  `// Relief source commit: ${RELIEF_COMMIT}`,
  `// EMS source commit: ${EMS_COMMIT}`,
  '// Every source font is distributed under SIL Open Font License 1.1.',
  '',
  '// prettier-ignore -- generated vector data stays compact and out of file-size budgets.',
  `export const CNC_STROKE_FONT_DATA = ${JSON.stringify(fonts)} as const;`,
  '',
].join('\n');

fs.writeFileSync(OUTPUT, generated);
process.stdout.write(`wrote ${path.relative(ROOT, OUTPUT)} (${generated.length} chars)\n`);
