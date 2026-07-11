// index.ts public-export-count reporter (ADR-015: 10 soft / 20 hard).
//
// ADR-015 caps a module barrel's public API "enforced by ESLint", but no rule
// or script actually checks it, so the caps drifted (several core barrels are
// well over 20 symbols). This walks every src/**/index.ts, counts the public
// symbols each re-exports or declares, and REPORTS the over-cap barrels.
//
// Report-only for now (exit 0) so it can land without first splitting the
// over-cap barrels — a later change flips hard-cap violations to exit 1 and
// wires it into release:check (ARC-06 PR5). `export *` re-exports can't be
// counted without resolving the target module, so a barrel that uses them is
// flagged and its printed count is a lower bound.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOFT_CAP = 10;
const HARD_CAP = 20;
const SCAN_ROOT = 'src';
const BARREL_NAME = 'index.ts';

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && entry.name === BARREL_NAME) {
      yield path;
    }
  }
}

// Strip block comments and whole-line // comments so commented-out exports and
// doc blocks are not counted. Barrels rarely carry trailing inline comments, so
// this is deliberately simple rather than a full tokenizer.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function countExportedSymbols(src) {
  const clean = stripComments(src);
  const names = new Set();

  // export { a, b as c, type d } [from '...'] and export type { A, B } [from '...']
  const blockRe = /export\s+(?:type\s+)?\{([\s\S]*?)\}/g;
  let match;
  while ((match = blockRe.exec(clean)) !== null) {
    for (const raw of match[1].split(',')) {
      const part = raw.trim().replace(/^type\s+/, '');
      if (part === '') continue;
      const aliased = /\s+as\s+([A-Za-z0-9_$]+)/.exec(part);
      names.add((aliased ? aliased[1] : part).trim());
    }
  }

  // export const/let/var/function/class/enum/interface/type NAME
  const declRe =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|enum|interface|type)\s+([A-Za-z0-9_$]+)/g;
  while ((match = declRe.exec(clean)) !== null) names.add(match[1]);

  const defaultExports = (clean.match(/export\s+default\b/g) ?? []).length;
  const starReexports = (clean.match(/export\s+\*/g) ?? []).length;

  return { count: names.size + defaultExports, starReexports };
}

const barrels = [];
for (const path of walk(SCAN_ROOT)) {
  const { count, starReexports } = countExportedSymbols(readFileSync(path, 'utf8'));
  barrels.push({ path: relative(process.cwd(), path), count, starReexports });
}
barrels.sort((a, b) => b.count - a.count);

const overHard = barrels.filter((b) => b.count > HARD_CAP);
const overSoft = barrels.filter((b) => b.count > SOFT_CAP && b.count <= HARD_CAP);

console.log(
  `index.ts export-count report (ADR-015: ${SOFT_CAP} soft / ${HARD_CAP} hard). Report-only.`,
);
console.log(`Scanned ${barrels.length} barrels under ${SCAN_ROOT}/.\n`);

if (overHard.length > 0) {
  console.log(`OVER HARD CAP (> ${HARD_CAP} symbols) — split these barrels:`);
  for (const b of overHard) {
    const star = b.starReexports > 0 ? ` (+${b.starReexports} export * — lower bound)` : '';
    console.log(`  ${b.path}: ${b.count}${star}`);
  }
  console.log('');
}
if (overSoft.length > 0) {
  console.log(`Over soft cap (> ${SOFT_CAP} symbols):`);
  for (const b of overSoft) console.log(`  ${b.path}: ${b.count}`);
  console.log('');
}

console.log(
  `${overHard.length} over hard cap, ${overSoft.length} over soft cap. ` +
    `Report-only — not gating the build yet (ARC-06 PR5 will).`,
);
