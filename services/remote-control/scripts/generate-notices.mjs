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
        .filter((name) => /^(?:licen[cs]e|copying|notice)(?:\.[a-z]+)?$/i.test(name))
        .sort();
      if (files.length === 0) throw new Error(`Missing licence text for ${manifest.name}.`);
      const notices = files.map((name) => {
        const content = readFileSync(join(location, name), 'utf8').replace(/\r\n/g, '\n').trim();
        if (!content || content.includes('\uFFFD')) {
          throw new Error(`Invalid licence text for ${manifest.name}.`);
        }
        return `${name}\n${content}`;
      });
      entries.push({ id: `${manifest.name}@${manifest.version}`, license, notices });
    }
  }
}
entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
if (entries.length === 0 || new Set(entries.map((entry) => entry.id)).size !== entries.length) {
  throw new Error('Production licence inventory is empty or contains duplicate identities.');
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
