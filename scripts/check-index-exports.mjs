// index.ts public-export-count RATCHET (ADR-015: 10 soft / 20 hard).
//
// Wired into release:check. New barrels are hard-capped at 20 symbols; legacy
// over-cap barrels are pinned to scripts/index-export-baseline.json and may
// only shrink: growth past a baseline entry fails (exit 1), and once a barrel
// shrinks, a baseline entry higher than the live count also fails until the
// baseline is lowered in the same change — that is what makes it a ratchet
// rather than a static ceiling (rolling audit 2026-07-17-0450 P3-2).
// `export *` re-exports can't be counted without resolving the target module,
// so a barrel using them is flagged and its printed count is a lower bound.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOFT_CAP = 10;
const HARD_CAP = 20;
const SCAN_ROOT = 'src';
const BARREL_NAME = 'index.ts';
const BASELINE_PATH = 'scripts/index-export-baseline.json';
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

function portablePath(path) {
  return path.replaceAll('\\', '/');
}

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
  barrels.push({ path: portablePath(relative(process.cwd(), path)), count, starReexports });
}
barrels.sort((a, b) => b.count - a.count);

const overHard = barrels.filter((b) => b.count > HARD_CAP);
const overSoft = barrels.filter((b) => b.count > SOFT_CAP && b.count <= HARD_CAP);

console.log(
  `index.ts export-count gate (ADR-015: ${SOFT_CAP} soft / ${HARD_CAP} hard; legacy no-growth ratchet).`,
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

const regressions = overHard.filter((barrel) => barrel.count > (baseline[barrel.path] ?? HARD_CAP));
const staleBaseline = Object.keys(baseline).filter(
  (path) => !barrels.some((barrel) => barrel.path === path && barrel.count > HARD_CAP),
);
// A shrink must LOCK IN: a baseline entry above the live count leaves silent
// regrowth headroom (the audit's "static ceiling" gap), so it fails until the
// baseline is lowered to the new count in the same change.
const slackBaseline = barrels.filter(
  (barrel) => barrel.count > HARD_CAP && (baseline[barrel.path] ?? HARD_CAP) > barrel.count,
);

if (regressions.length > 0) {
  console.error('Public-export ratchet failed:');
  for (const barrel of regressions) {
    console.error(
      `  ${barrel.path}: ${barrel.count} exports (allowed ${baseline[barrel.path] ?? HARD_CAP})`,
    );
  }
  process.exit(1);
}

if (slackBaseline.length > 0) {
  console.error('Public-export ratchet failed — lock in the shrink by lowering the baseline:');
  for (const barrel of slackBaseline) {
    console.error(
      `  ${barrel.path}: baseline ${baseline[barrel.path]} > current ${barrel.count} — set the baseline to ${barrel.count}`,
    );
  }
  process.exit(1);
}

if (staleBaseline.length > 0) {
  console.error(
    'Public-export ratchet failed — baseline entries now at/below the hard cap (remove them):',
  );
  for (const path of staleBaseline) console.error(`  ${path}`);
  process.exit(1);
}

console.log(
  `Public-export ratchet passed: ${overHard.length} legacy over-cap barrels did not grow; ` +
    `new barrels are capped at ${HARD_CAP}.`,
);
