// Publish only the existing privacy notice on the app origin. Keep the policy
// in website/pages/privacy.mjs; --check catches stale generated content in CI.
import { readFileSync, readdirSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { assetResolver, contentHash } from '../website/lib/assets.mjs';
import { renderAppPrivacyDocument } from '../website/lib/layout.mjs';
import { page } from '../website/pages/privacy.mjs';
import { site } from '../website/site.config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(root, 'public');
const output = join(publicRoot, 'privacy');
export async function appPrivacyFiles() {
  const expected = new Map();
  const manifest = new Map();
  for (const name of ['site.css', 'social-card.png']) {
    const bytes = readFileSync(join(root, 'website', 'assets', name));
    const extension = extname(name);
    const published = `${name.slice(0, -extension.length)}.${contentHash(bytes)}${extension}`;
    expected.set(join('assets', published), bytes);
    manifest.set(name, `/privacy/assets/${published}`);
  }
  const policy = {
    ...page,
    description:
      'Read what KerfDesk sends for updates, licensing, aggregate download statistics and optional phone or MCP access. Ordinary use needs no account.',
  };
  const context = {
    site,
    appPrivacy: true,
    siteUrl: site.appUrl,
    asset: assetResolver(manifest),
    contentSecurityPolicy:
      "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  };
  const formatOptions = JSON.parse(readFileSync(join(root, '.prettierrc'), 'utf8'));
  const document = await format(renderAppPrivacyDocument(policy, page.render(context), context), {
    ...formatOptions,
    parser: 'html',
  });
  expected.set('index.html', Buffer.from(document));
  const lucide = dirname(createRequire(import.meta.url).resolve('lucide-static/package.json'));
  expected.set('lucide-license.txt', readFileSync(join(lucide, 'LICENSE')));
  return expected;
}

function assetFiles(directory) {
  const files = readdirSync(join(directory, 'assets'), { withFileTypes: true });
  for (const file of files) {
    if (
      !file.isFile() ||
      !/^(?:site\.[a-f0-9]{10}\.css|social-card\.[a-f0-9]{10}\.png)$/.test(file.name)
    ) {
      throw new Error(`Unexpected file in generated privacy assets: ${file.name}`);
    }
  }
  return files;
}

export function checkPrivacyFiles(directory, expected) {
  for (const [name, bytes] of expected) {
    let current;
    try {
      current = readFileSync(join(directory, name));
    } catch {
      throw new Error(`Missing privacy output: ${name}. Run pnpm generate:privacy.`);
    }
    if (!bytes.equals(current)) {
      throw new Error(`Stale privacy output: ${name}. Run pnpm generate:privacy.`);
    }
  }
  for (const file of assetFiles(directory)) {
    if (!expected.has(join('assets', file.name)))
      throw new Error(`Obsolete privacy asset: ${file.name}. Run pnpm generate:privacy.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.slice(2).some((arg) => arg !== '--check')) {
    throw new Error('Usage: node scripts/generate-privacy-page.mjs [--check]');
  }
  const expected = await appPrivacyFiles();
  const check = process.argv.includes('--check');
  if (check) {
    checkPrivacyFiles(output, expected);
  } else {
    for (const [name, bytes] of expected) {
      const target = join(output, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    // Delete only obsolete assets this generator owns. Never clear public/ or
    // an arbitrary output directory; the fixed target must remain in public/.
    const assets = join(output, 'assets');
    if (!assets.startsWith(`${publicRoot}${sep}`))
      throw new Error('Invalid privacy asset directory');
    for (const file of assetFiles(output)) {
      if (!expected.has(join('assets', file.name))) unlinkSync(join(assets, file.name));
    }
  }
  console.log(
    `${check ? 'Checked' : 'Generated'} ${expected.size} privacy files from website/pages/privacy.mjs.`,
  );
}
