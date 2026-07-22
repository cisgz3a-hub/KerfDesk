import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const OUTLINE_FONTS = [
  {
    file: 'src/ui/text/fonts/Roboto-Regular.ttf',
    name: 'Roboto',
    spdx: 'Apache-2.0',
  },
  {
    file: 'src/ui/text/fonts/Inconsolata-Regular.ttf',
    name: 'Inconsolata',
    spdx: 'OFL-1.1',
  },
  {
    file: 'src/ui/text/fonts/Pacifico-Regular.ttf',
    name: 'Pacifico',
    spdx: 'OFL-1.1',
  },
  {
    file: 'src/ui/text/fonts/DancingScript-Regular.ttf',
    name: 'Dancing Script',
    spdx: 'OFL-1.1',
  },
];

export const CNC_STROKE_FONTS = [
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

export const OPENCLIPART_ASSETS = [
  {
    name: 'Circular Flourish',
    file: 'src/ui/library/assets/openclipart/circular-flourish-by-m1981-optimized.svg',
    source: 'https://openclipart.org/detail/351224/circular-flourish-by-m1981-optimized',
    sha256: 'dcb241479c0deadf1b6faf0a65a55c0c58820da24703878d33d5d275e1e5c42a',
  },
  {
    name: 'Flower',
    file: 'src/ui/library/assets/openclipart/flower.svg',
    source: 'https://openclipart.org/detail/338382/flower',
    sha256: 'aff78b765c5b06c65874de45a1d0ea8503f4a06e95575264d6bb00d2b0e2c492',
  },
  {
    name: 'Flower Cluster',
    file: 'src/ui/library/assets/openclipart/flower-cluster.svg',
    source: 'https://openclipart.org/detail/122221/flower-cluster',
    sha256: '098eb30cf383057318e0297ab4f8d705b9d6d4596442a30fba22fc1f8b20fc5b',
  },
  {
    name: 'Guitar Fretboard 25 Scale',
    file: 'src/ui/library/assets/openclipart/guitar-fretboard-25-scale.svg',
    source: 'https://openclipart.org/detail/289994/guitar-fretboard-25-scale',
    sha256: '9392c3f9ba6cc20f17b9470536f0faf45b9f4fdc08d407c77188c30185f8a32e',
  },
  {
    name: 'Laser Cutter Icon',
    file: 'src/ui/library/assets/openclipart/laser-cutter-icon.svg',
    source: 'https://openclipart.org/detail/315232/laser-cutter-icon',
    sha256: '97aed71d31ade8f305135b8166c8f68ae6bda479c5eadd2d3d5caa75311dce25',
  },
  {
    name: 'Laser In Use',
    file: 'src/ui/library/assets/openclipart/laser-in-use.svg',
    source: 'https://openclipart.org/detail/215782/laser-in-use',
    sha256: 'afda4b9826129ac45ccb8c44fe70df37ddf3b8a8f49a5c9b7b3f7c71f3451e8b',
  },
  {
    name: 'Petal Flower',
    file: 'src/ui/library/assets/openclipart/petal-flower-with-svg-mask.svg',
    source: 'https://openclipart.org/detail/295526/petal-flower-with-svg-mask',
    sha256: 'e6ca3e8eb867bcf3dd698253e5e789828a407144044e2610a3571e33c264882c',
  },
  {
    name: 'Scary Laser',
    file: 'src/ui/library/assets/openclipart/scary-laser.svg',
    source: 'https://openclipart.org/detail/20408/scary-laser',
    sha256: 'f454f30f95036c974b0c35fa05b09f645300377f17ea71308c2a7c5dbc5caa51',
  },
];

const LAZY_VAL_FALLBACK = {
  name: 'lazy-val',
  version: '1.0.5',
  license: 'MIT',
  file: 'scripts/license-texts/lazy-val-1.0.5-MIT.txt',
};

export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function packageLicenseFiles(depDir) {
  return fs
    .readdirSync(depDir)
    .filter((entry) => /^licen[sc]e(?:$|[._-])/i.test(entry))
    .sort(compareText);
}

export function readPackageLicense({ depDir, license, name, rootDir = REPO_ROOT, version }) {
  const files = packageLicenseFiles(depDir);
  if (files.length === 0) {
    const fallbackMatches =
      name === LAZY_VAL_FALLBACK.name &&
      version === LAZY_VAL_FALLBACK.version &&
      license === LAZY_VAL_FALLBACK.license;
    if (!fallbackMatches) {
      throw new Error(`no LICENSE file found for production package ${name}@${version}`);
    }
    const fallback = path.join(rootDir, LAZY_VAL_FALLBACK.file);
    if (!fs.existsSync(fallback)) {
      throw new Error(`reviewed lazy-val fallback is missing: ${LAZY_VAL_FALLBACK.file}`);
    }
    return {
      sourceFiles: [`reviewed fallback: ${LAZY_VAL_FALLBACK.file}`],
      text: fs.readFileSync(fallback, 'utf8').trim(),
    };
  }

  const blocks = files.map((file) => ({
    file,
    text: fs.readFileSync(path.join(depDir, file), 'utf8').trim(),
  }));
  if (blocks.some(({ text }) => text.length === 0)) {
    throw new Error(`empty LICENSE file found for production package ${name}@${version}`);
  }
  return {
    sourceFiles: blocks.map(({ file }) => file),
    text:
      blocks.length === 1
        ? blocks[0].text
        : blocks.map(({ file, text }) => `--- ${file} ---\n${text}`).join('\n\n'),
  };
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readPnpmLicenseInventory(rootDir) {
  const raw = execSync('pnpm licenses list --prod --json', {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  });
  const parsed = JSON.parse(raw);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('pnpm returned an invalid production-license inventory');
  }
  return parsed;
}

function webUrl(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      typeof candidate.url === 'string' &&
      candidate.url.length > 0
    ) {
      return candidate.url;
    }
  }
  return null;
}

export function collectProductionPackages(rootDir = REPO_ROOT) {
  const nodeModules = path.join(rootDir, 'node_modules');
  const packages = new Map();
  const byLicense = readPnpmLicenseInventory(rootDir);
  for (const [groupLicense, entries] of Object.entries(byLicense).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    if (!Array.isArray(entries)) throw new Error(`invalid pnpm license group: ${groupLicense}`);
    for (const entry of entries) {
      if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
        throw new Error(`pnpm returned no installed path for ${entry.name}`);
      }
      for (const rawDepDir of [...entry.paths].sort(compareText)) {
        const depDir = path.resolve(rawDepDir);
        if (!isInside(nodeModules, depDir)) {
          throw new Error(`pnpm returned a dependency outside node_modules: ${depDir}`);
        }
        const packageJsonPath = path.join(depDir, 'package.json');
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (manifest.name !== entry.name || !entry.versions?.includes(manifest.version)) {
          throw new Error(`pnpm inventory does not match ${manifest.name}@${manifest.version}`);
        }
        const license = entry.license ?? groupLicense;
        if (license !== groupLicense) {
          throw new Error(
            `pnpm returned conflicting licenses for ${manifest.name}@${manifest.version}`,
          );
        }
        const licenseRecord = readPackageLicense({
          depDir,
          license,
          name: manifest.name,
          rootDir,
          version: manifest.version,
        });
        const key = `${manifest.name}@${manifest.version}`;
        const record = {
          name: manifest.name,
          version: manifest.version,
          license,
          homepage: webUrl(manifest.homepage, entry.homepage, manifest.repository),
          ...licenseRecord,
        };
        const existing = packages.get(key);
        if (
          existing !== undefined &&
          (existing.license !== record.license || existing.text !== record.text)
        ) {
          throw new Error(`peer variants disagree on license content for ${key}`);
        }
        packages.set(key, existing ?? record);
      }
    }
  }
  if (packages.size === 0) throw new Error('pnpm reported zero production packages');
  return [...packages.values()].sort(
    (a, b) => compareText(a.name, b.name) || compareText(a.version, b.version),
  );
}

export function collectElectronPackage(rootDir = REPO_ROOT) {
  const depDir = path.join(rootDir, 'node_modules', 'electron');
  const manifestPath = path.join(depDir, 'package.json');
  if (!fs.existsSync(manifestPath)) throw new Error('installed Electron package is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== 'electron' || manifest.license !== 'MIT') {
    throw new Error('installed Electron package identity or license is unexpected');
  }
  return {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    homepage: webUrl(
      manifest.homepage,
      manifest.repository,
      'https://github.com/electron/electron',
    ),
    ...readPackageLicense({
      depDir,
      license: manifest.license,
      name: manifest.name,
      rootDir,
      version: manifest.version,
    }),
  };
}

export function verifyOpenClipartAssets(rootDir = REPO_ROOT) {
  return OPENCLIPART_ASSETS.map((asset) => {
    const file = path.join(rootDir, asset.file);
    if (!fs.existsSync(file)) throw new Error(`OpenClipart asset is missing: ${asset.file}`);
    const actual = sha256File(file);
    if (actual !== asset.sha256) {
      throw new Error(`OpenClipart asset hash changed: ${asset.file}`);
    }
    return asset;
  });
}
