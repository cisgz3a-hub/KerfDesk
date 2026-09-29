// Static asset publishing: content-hashed copies under /assets/ (served with an
// immutable cache header) plus the few files browsers expect at fixed root paths.

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';

export function contentHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(path);
    else if (entry.isFile()) yield path;
  }
}

function hashedName(logicalPath, bytes) {
  const ext = extname(logicalPath);
  return `${logicalPath.slice(0, -ext.length)}.${contentHash(bytes)}${ext}`;
}

function publishOne(outDir, manifest, logicalPath, bytes) {
  const published = hashedName(logicalPath, bytes);
  const target = join(outDir, 'assets', ...published.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  manifest.set(logicalPath, `/assets/${published}`);
}

// Publishes every file under `assetDir` (logical path = path relative to it)
// and each `shared` entry ({ from, as }) taken from elsewhere in the repo.
// Returns a Map of logical path -> published URL path.
export function publishAssets({ assetDir, shared, outDir }) {
  const manifest = new Map();
  for (const file of walkFiles(assetDir)) {
    const logical = relative(assetDir, file).split(sep).join('/');
    publishOne(outDir, manifest, logical, readFileSync(file));
  }
  for (const { from, as } of shared) {
    publishOne(outDir, manifest, as, readFileSync(from));
  }
  return manifest;
}

// Files that must keep a fixed, unhashed URL (favicons, touch icons).
export function copyRootFiles(files, outDir) {
  for (const { from, as } of files) {
    copyFileSync(from, join(outDir, as));
  }
}

export function assetResolver(manifest) {
  return (logicalPath) => {
    const url = manifest.get(logicalPath);
    if (!url) throw new Error(`Unknown website asset: ${logicalPath}`);
    return url;
  };
}
