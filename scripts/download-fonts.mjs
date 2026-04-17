/**
 * Downloads the bundled font set from github.com/google/fonts.
 * Run with: node scripts/download-fonts.mjs
 *
 * Each entry: [family, slug, category, copyright, licenseDir, staticFilename, licenseFilename]
 *   licenseDir:       'ofl' or 'apache' (for Roboto)
 *   staticFilename:   exact TTF filename inside {licenseDir}/{slug}/static/ (or root)
 *   licenseFilename:  'OFL.txt' for OFL fonts, 'LICENSE.txt' for Apache
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, '..');
const fontDir = join(projectRoot, 'public', 'fonts');
const licenseDir = join(fontDir, 'LICENSES');

mkdirSync(fontDir, { recursive: true });
mkdirSync(licenseDir, { recursive: true });

const MANIFEST = [
  // family, slug, category, copyright, licenseDir, staticFilename, licenseFilename
  ['Roboto',            'roboto',          'sans',       'Copyright 2011 Google LLC',                      'ofl',    'Roboto-Regular.ttf',          'OFL.txt'],
  ['Open Sans',         'opensans',        'sans',       'Copyright (c) The Open Sans Project Authors',    'ofl',    'OpenSans-Regular.ttf',        'OFL.txt'],
  ['Montserrat',        'montserrat',      'sans',       'Copyright (c) The Montserrat Project Authors',   'ofl',    'Montserrat-Regular.ttf',      'OFL.txt'],
  ['Lato',              'lato',            'sans',       'Copyright (c) 2010-2015 by tyPoland Lukasz Dziedzic',   'ofl', 'Lato-Regular.ttf',        'OFL.txt'],
  ['DM Sans',           'dmsans',          'sans',       'Copyright (c) The DM Sans Project Authors',      'ofl',    'DMSans-Regular.ttf',          'OFL.txt'],
  ['Playfair Display',  'playfairdisplay', 'serif',      'Copyright (c) The Playfair Project Authors',     'ofl',    'PlayfairDisplay-Regular.ttf', 'OFL.txt'],
  ['Merriweather',      'merriweather',    'serif',      'Copyright (c) The Merriweather Project Authors', 'ofl',    'Merriweather-Regular.ttf',    'OFL.txt'],
  ['Lora',              'lora',            'serif',      'Copyright (c) The Lora Project Authors',         'ofl',    'Lora-Regular.ttf',            'OFL.txt'],
  ['EB Garamond',       'ebgaramond',      'serif',      'Copyright (c) The EB Garamond Project Authors', 'ofl',    'EBGaramond-Regular.ttf',      'OFL.txt'],
  ['Bebas Neue',        'bebasneue',       'display',    'Copyright (c) The Bebas Neue Project Authors',   'ofl',    'BebasNeue-Regular.ttf',       'OFL.txt'],
  ['Anton',             'anton',           'display',    'Copyright (c) The Anton Project Authors',        'ofl',    'Anton-Regular.ttf',           'OFL.txt'],
  ['Oswald',            'oswald',          'display',    'Copyright (c) The Oswald Project Authors',       'ofl',    'Oswald-Regular.ttf',          'OFL.txt'],
  ['Pacifico',          'pacifico',        'script',     'Copyright (c) The Pacifico Project Authors',     'ofl',    'Pacifico-Regular.ttf',        'OFL.txt'],
  ['Dancing Script',    'dancingscript',   'script',     'Copyright (c) The Dancing Script Project Authors','ofl',   'DancingScript-Regular.ttf',   'OFL.txt'],
  ['Caveat',            'caveat',          'script',     'Copyright (c) The Caveat Project Authors',       'ofl',    'Caveat-Regular.ttf',          'OFL.txt'],
  ['JetBrains Mono',    'jetbrainsmono',   'mono',       'Copyright 2020 The JetBrains Mono Project Authors','ofl',  'JetBrainsMono-Regular.ttf',   'OFL.txt'],
  ['Fira Code',         'firacode',        'mono',       'Copyright (c) 2014 The Fira Code Project Authors','ofl',   'FiraCode-Regular.ttf',        'OFL.txt'],
  ['Stardos Stencil',   'stardosstencil',  'stencil',    'Copyright (c) The Stardos Stencil Project Authors','ofl',  'StardosStencil-Regular.ttf',  'OFL.txt'],
  ['Press Start 2P',    'pressstart2p',    'display',    'Copyright (c) The Press Start 2P Project Authors','ofl',   'PressStart2P-Regular.ttf',    'OFL.txt'],
];

const BASE = 'https://raw.githubusercontent.com/google/fonts/main';
const GITHUB_API = 'https://api.github.com/repos/google/fonts/contents';

async function fetchBinary(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function listDir(path) {
  const r = await fetch(`${GITHUB_API}/${path}`);
  if (!r.ok) return [];
  const json = await r.json();
  return Array.isArray(json) ? json : [];
}

function scoreFontCandidate(name, expected) {
  const lower = name.toLowerCase();
  const expectedLower = expected.toLowerCase();
  if (lower === expectedLower) return 100;
  if (lower.includes('italic')) return -10;
  if (lower.includes('regular') && !lower.includes('italic')) return 90;
  if (lower.includes('[wght]')) return 85;
  if (lower.includes('[wdth,wght]')) return 84;
  if (lower.includes('[opsz,wght]')) return 83;
  if (lower.includes('variablefont') && lower.includes('wght')) return 80;
  if (lower.endsWith('.ttf')) return 60;
  return 0;
}

async function discoverFontDownload(licDir, slug, expectedFile) {
  const dirs = [`${licDir}/${slug}/static`, `${licDir}/${slug}`];
  let best = null;
  for (const dir of dirs) {
    const entries = await listDir(dir);
    for (const entry of entries) {
      if (!entry || entry.type !== 'file') continue;
      const name = String(entry.name || '');
      if (!name.toLowerCase().endsWith('.ttf')) continue;
      const score = scoreFontCandidate(name, expectedFile);
      if (!best || score > best.score) {
        best = { score, name, downloadUrl: String(entry.download_url || ''), dir };
      }
    }
  }
  if (!best || !best.downloadUrl) return null;
  return best;
}

let ok = 0;
const failed = [];

for (const [family, slug, _category, _copyright, licDir, staticFile, licFile] of MANIFEST) {
  const outTtf = join(fontDir, staticFile);
  const outLic = join(licenseDir, `${slug}-${licFile}`);

  const candidates = [
    `${BASE}/${licDir}/${slug}/static/${staticFile}`,
    `${BASE}/${licDir}/${slug}/${staticFile}`,
  ];

  let buf = null;
  for (const url of candidates) {
    try {
      buf = await fetchBinary(url);
      break;
    } catch {
      // try next
    }
  }
  if (!buf) {
    const discovered = await discoverFontDownload(licDir, slug, staticFile);
    if (discovered) {
      try {
        buf = await fetchBinary(discovered.downloadUrl);
        console.log(`  i ${family}: resolved ${discovered.name} from ${discovered.dir}/`);
      } catch {
        // keep as failure below
      }
    }
  }
  if (!buf) {
    console.error(`  ✗ ${family}: could not find ${staticFile} in ${licDir}/${slug}/`);
    failed.push(family);
    continue;
  }
  writeFileSync(outTtf, buf);

  try {
    const licBuf = await fetchBinary(`${BASE}/${licDir}/${slug}/${licFile}`);
    writeFileSync(outLic, licBuf);
  } catch (e) {
    console.warn(`  ⚠ ${family}: license not fetched (${e.message})`);
  }
  console.log(`  ✓ ${family}`);
  ok++;
}

console.log(`\nDone: ${ok} OK, ${failed.length} failed`);
if (failed.length > 0) {
  console.log('Failed families (manual intervention needed):', failed.join(', '));
  process.exit(1);
}
