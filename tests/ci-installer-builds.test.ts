/**
 * T2-98: CI must build platform installers, not just the renderer.
 *
 * Run: npx tsx tests/ci-installer-builds.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ok ${m}`);
  } else {
    failed++;
    console.error(`  fail ${m}`);
  }
}

console.log('\n=== T2-98 CI installer builds ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf-8');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
  scripts?: Record<string, string>;
};

// 1. Existing Linux test job remains.
assert(/test:\s*\n\s+runs-on:\s+ubuntu-latest/.test(ci), 'Linux test job remains');
assert(/npm audit --omit=dev --audit-level=moderate/.test(ci), 'dependency audit remains in CI');
assert(/npm test/.test(ci), 'test suite remains in CI');

// 2. Windows installer job proves electron-builder's Windows path.
assert(/build-windows:[\s\S]*?runs-on:\s+windows-latest/.test(ci), 'Windows installer job exists');
assert(/build-windows:[\s\S]*npm ci/.test(ci), 'Windows job installs dependencies');
assert(/build-windows:[\s\S]*npm run electron:compile/.test(ci), 'Windows job compiles Electron main');
assert(/build-windows:[\s\S]*npm run build/.test(ci), 'Windows job builds renderer');
assert(/build-windows:[\s\S]*npm run electron:build/.test(ci), 'Windows job builds installer');
assert(/build-windows:[\s\S]*node scripts\/generate-checksums\.mjs release/.test(ci),
  'Windows job generates SHA256SUMS for installer');
assert(/build-windows:[\s\S]*actions\/upload-artifact@v4/.test(ci), 'Windows job uploads artifact');
assert(/build-windows:[\s\S]*path:\s*\|[\s\S]*release\/\*\.exe[\s\S]*release\/SHA256SUMS/.test(ci),
  'Windows artifact uploads exe and SHA256SUMS');
assert(/--publish\s+never/.test(pkg.scripts?.['electron:build'] ?? ''),
  'Windows installer script disables electron-builder implicit CI publish');

// 3. macOS installer job proves electron-builder's macOS path.
assert(/build-macos:[\s\S]*?runs-on:\s+macos-latest/.test(ci), 'macOS installer job exists');
assert(/build-macos:[\s\S]*npm ci/.test(ci), 'macOS job installs dependencies');
assert(/build-macos:[\s\S]*npm run electron:compile/.test(ci), 'macOS job compiles Electron main');
assert(/build-macos:[\s\S]*npm run build/.test(ci), 'macOS job builds renderer');
assert(/build-macos:[\s\S]*npm run electron:build:mac/.test(ci), 'macOS job builds dmg');
assert(/build-macos:[\s\S]*node scripts\/generate-checksums\.mjs release/.test(ci),
  'macOS job generates SHA256SUMS for dmg');
assert(/build-macos:[\s\S]*actions\/upload-artifact@v4/.test(ci), 'macOS job uploads artifact');
assert(/build-macos:[\s\S]*path:\s*\|[\s\S]*release\/\*\.dmg[\s\S]*release\/SHA256SUMS/.test(ci),
  'macOS artifact uploads dmg and SHA256SUMS');
assert(/--publish\s+never/.test(pkg.scripts?.['electron:build:mac'] ?? ''),
  'macOS installer script disables electron-builder implicit CI publish');

// 4. Per-PR installer jobs stay unsigned until T2-99/T2-100 provide release secrets.
assert(!/CSC_LINK/.test(ci), 'PR installer jobs do not expose signing cert env');
assert(!/APPLE_ID_PASSWORD/.test(ci), 'PR installer jobs do not expose notarization env');

console.log(`\nT2-98 CI installer builds: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
