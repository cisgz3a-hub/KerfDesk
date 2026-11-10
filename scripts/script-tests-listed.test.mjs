import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

// `test:release-integrity` names its files (or one folder of them) one by one,
// so a new script test that nobody adds to it runs nowhere. Code quality audit
// C1 (C1-P2-2) found three such files, one of them failing, and two more that
// ran only in a manual workflow. This test closes that gap: a script test must
// be on the list before it can merge.
const SCRIPTS = new URL('./', import.meta.url);

async function scriptTests(directory = SCRIPTS, prefix = 'scripts/') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Vendored upstream payloads are byte-exact copies, not our tests.
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      found.push(
        ...(await scriptTests(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)),
      );
    } else if (entry.name.endsWith('.test.mjs')) {
      found.push(`${prefix}${entry.name}`);
    }
  }
  return found;
}

/** A listed word is a path, or a path whose `*` stands for one file-name part. */
function matcher(word) {
  const pattern = word
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${pattern}$`, 'u');
}

test('every script test is run by test:release-integrity', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', SCRIPTS), 'utf8'));
  const listed = packageJson.scripts['test:release-integrity']
    .split(/\s+/u)
    .filter((word) => word.endsWith('.test.mjs'));
  const scriptPatterns = listed.filter((word) => word.startsWith('scripts/'));
  const onDisk = await scriptTests();

  assert.ok(onDisk.length > 0, 'found no script tests; the search is broken');
  const unlisted = onDisk
    .filter((file) => !scriptPatterns.some((word) => matcher(word).test(file)))
    .sort();
  assert.deepEqual(unlisted, [], 'add these files to test:release-integrity in package.json');

  const matchesNothing = scriptPatterns
    .filter((word) => !onDisk.some((file) => matcher(word).test(file)))
    .sort();
  assert.deepEqual(matchesNothing, [], 'test:release-integrity names files that do not exist');
  assert.equal(new Set(listed).size, listed.length, 'test:release-integrity repeats a file');
});
