// Builds the KerfDesk website into website/dist (or --out <dir>).
//
//   node website/build.mjs [--out <dir>] [--site-url https://example.com]
//
// --site-url (or KERFDESK_SITE_URL) is the origin the site will be served
// from. Without it the build still succeeds but omits canonical links, Open
// Graph URLs and the sitemap, which all require absolute URLs.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commerce } from './commerce.config.mjs';
import { assetResolver, copyRootFiles, publishAssets } from './lib/assets.mjs';
import { assertValidCommerce } from './lib/commerce.mjs';
import { renderDocument } from './lib/layout.mjs';
import { headersFile, robotsFile, sitemapFile } from './lib/meta-files.mjs';
import { pages } from './pages/index.mjs';
import { site } from './site.config.mjs';

const WEBSITE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_PUBLIC = join(WEBSITE_DIR, '..', 'public');

const SHARED_ASSETS = [
  { from: join(REPO_PUBLIC, 'startup-craft.webp'), as: 'brand/startup-craft.webp' },
];
const LUCIDE_LICENSE = join(
  dirname(createRequire(import.meta.url).resolve('lucide-static/package.json')),
  'LICENSE',
);
// Fixed-URL files. The icon license travels with the inlined icons (ISC/MIT notice).
const ROOT_FILES = [
  ...['favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png'].map((name) => ({
    from: join(REPO_PUBLIC, name),
    as: name,
  })),
  { from: LUCIDE_LICENSE, as: 'lucide-license.txt' },
];

function normalizeSiteUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`--site-url must be https: ${value}`);
  return url.origin;
}

function outputPathFor(page) {
  if (page.path.endsWith('.html')) return page.path.slice(1);
  return join(page.path.slice(1), 'index.html');
}

function assertPages(list) {
  const paths = new Set();
  for (const page of list) {
    if (!page.path?.startsWith('/')) throw new Error(`Page path must start with /: ${page.path}`);
    if (paths.has(page.path)) throw new Error(`Duplicate page path: ${page.path}`);
    paths.add(page.path);
    if (!page.title || !page.description)
      throw new Error(`${page.path} needs a title and description`);
    if (typeof page.render !== 'function') throw new Error(`${page.path} needs render()`);
  }
}

export function buildSite({ outDir = join(WEBSITE_DIR, 'dist'), siteUrl = null } = {}) {
  assertValidCommerce(commerce);
  assertPages(pages);
  const origin = normalizeSiteUrl(siteUrl);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const manifest = publishAssets({
    assetDir: join(WEBSITE_DIR, 'assets'),
    shared: SHARED_ASSETS,
    outDir,
  });
  copyRootFiles(ROOT_FILES, outDir);

  const ctx = { site, commerce, siteUrl: origin, asset: assetResolver(manifest) };
  const written = [];
  for (const page of pages) {
    const target = join(outDir, outputPathFor(page));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderDocument(page, page.render(ctx), ctx));
    written.push(page.path);
  }

  writeFileSync(join(outDir, '_headers'), headersFile());
  writeFileSync(join(outDir, 'robots.txt'), robotsFile(origin));
  if (origin) writeFileSync(join(outDir, 'sitemap.xml'), sitemapFile(origin, pages));
  return { outDir, pages: written, siteUrl: origin };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outArg = argValue('--out');
  const result = buildSite({
    outDir: outArg ? resolve(outArg) : undefined,
    siteUrl: argValue('--site-url') ?? process.env.KERFDESK_SITE_URL ?? null,
  });
  const where = result.siteUrl ?? 'no --site-url: canonical links and sitemap omitted';
  console.log(`Built ${result.pages.length} pages into ${result.outDir} (${where})`);
}
