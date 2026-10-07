import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check'))
  throw new Error('Use generate-scanner-decoder.mjs with no arguments or --check.');
const source = new URL(import.meta.resolve('@nuintun/qrcode'));
const manifest = JSON.parse(await readFile(new URL('../package.json', source), 'utf8'));
const sourceHash = createHash('sha256')
  .update(await readFile(source))
  .digest('hex');
if (
  manifest.version !== '5.0.3' ||
  manifest.license !== 'MIT' ||
  sourceHash !== '0d6e689e702ae2bca5302fce195b739b9ef04a467cf1e96e7732f152fd94eee1'
)
  throw new Error('QR decoder entry differs from the reviewed @nuintun/qrcode 5.0.3 distribution.');
const result = await build({
  absWorkingDir: directory,
  entryPoints: ['scripts/scanner-decoder-entry.js'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  charset: 'ascii',
  banner: {
    js: '// Generated from @nuintun/qrcode 5.0.3 (MIT) and its tslib dependency. Full licences: /third-party-notices.txt.\n// Regenerate with pnpm generate:scanner; do not edit this bundle.',
  },
});
if (result.outputFiles.length !== 1) throw new Error('Expected one self-contained QR decoder.');
const expected = result.outputFiles[0].text;
const destination = new URL('../public/control-scanner-decoder.js', import.meta.url);
if (check) {
  if ((await readFile(destination, 'utf8')) !== expected)
    throw new Error('QR decoder asset is stale. Run pnpm generate:scanner.');
} else await writeFile(destination, expected);
console.log(`QR decoder: reviewed @nuintun/qrcode 5.0.3; ${check ? 'current' : 'generated'}.`);
