import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const destination = join(directory, 'public', 'third-party-notices.txt');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check')) {
  throw new Error('Use generate-notices.mjs with no arguments or --check.');
}
// LICENSE, LICENSE.md, LICENSE-MIT, COPYING, NOTICE and the like (O11-P3-3).
const LICENSE_FILE_NAME = /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i;
// Upstream code a package ports without naming it in its own licence file
// (O11-P3-12). The Apache-2.0 text these point to ships with the MCP packages.
const UPSTREAM_ORIGINS = {
  '@nuintun/qrcode':
    'Upstream origin: its QR decoder ports ZXing ("Zebra Crossing",\n' +
    'https://github.com/zxing/zxing), Copyright the ZXing authors, licensed under\n' +
    'the Apache License, Version 2.0, whose full text appears in this file.',
};
const packages = JSON.parse(
  execSync('pnpm licenses list --prod --json', {
    cwd: directory,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 16 * 1024 * 1024,
  }),
);
const entries = [];
for (const [license, dependencies] of Object.entries(packages)) {
  for (const dependency of dependencies) {
    for (const location of dependency.paths ?? []) {
      const manifest = JSON.parse(readFileSync(join(location, 'package.json'), 'utf8'));
      if (manifest.name !== dependency.name || !dependency.versions.includes(manifest.version)) {
        throw new Error('Production dependency identity does not match its licence inventory.');
      }
      const files = readdirSync(location)
        .filter((name) => LICENSE_FILE_NAME.test(name))
        .sort();
      if (files.length === 0) throw new Error(`Missing licence text for ${manifest.name}.`);
      const notices = files.map((name) => {
        const content = readFileSync(join(location, name), 'utf8').replace(/\r\n/g, '\n').trim();
        if (!content || content.includes('\uFFFD')) {
          throw new Error(`Invalid licence text for ${manifest.name}.`);
        }
        return `${name}\n${content}`;
      });
      const origin = UPSTREAM_ORIGINS[manifest.name];
      if (origin !== undefined) notices.unshift(origin);
      entries.push({ id: `${manifest.name}@${manifest.version}`, license, notices });
    }
  }
}
entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
if (entries.length === 0 || new Set(entries.map((entry) => entry.id)).size !== entries.length) {
  throw new Error('Production licence inventory is empty or contains duplicate identities.');
}
for (const name of Object.keys(UPSTREAM_ORIGINS)) {
  if (!entries.some(({ id }) => id.startsWith(`${name}@`))) {
    throw new Error(`Upstream origin listed for ${name}, which is no longer a dependency.`);
  }
}
if (!entries.some(({ notices }) => notices.some((text) => text.includes('Apache License')))) {
  throw new Error('An Apache-2.0 upstream origin needs the Apache License text in the notices.');
}
const expected = [
  'KerfDesk phone control: third-party notices',
  '',
  'First-party KerfDesk code is proprietary. The notices below apply only to the',
  'listed production dependencies and preserve their separate licence terms.',
  '',
  ...entries.map(
    ({ id, license, notices }) =>
      `${id}\nPackage metadata licence: ${license}\nApplicable terms are preserved in full below.\n\n${notices.join('\n\n')}`,
  ),
  '',
].join('\n');
if (check) {
  if (readFileSync(destination, 'utf8') !== expected) {
    throw new Error('Third-party notices are stale. Run pnpm generate:notices.');
  }
} else {
  writeFileSync(destination, expected);
}
console.log(
  `third-party notices: ${entries.length} production packages; ${check ? 'current' : 'generated'}.`,
);
