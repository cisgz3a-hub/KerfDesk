/**
 * T2-103: SHA256 checksum format helpers for release artifacts.
 * Pre-T2-103 the build pipeline produced installers with no
 * checksums — users couldn't verify a download against tampering.
 * Audit 5B Critical 6 + Required Priority 9.
 *
 * Run: npx tsx tests/release-artifact-integrity.test.ts
 */
import {
  computeSha256Hex,
  formatChecksumLine,
  formatChecksumsFile,
  parseChecksumsFile,
  matchesAnyPattern,
} from '../src/release/checksumFormat';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-103 Release artifact integrity ===\n');

void (async () => {

// 1. Empty string SHA256 matches the canonical value
{
  const hex = computeSha256Hex('');
  assert(hex === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    `SHA256('') matches NIST canonical (got '${hex}')`);
}

// 2. 'abc' SHA256 matches canonical
{
  const hex = computeSha256Hex('abc');
  assert(hex === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    `SHA256('abc') matches NIST canonical (got '${hex}')`);
}

// 3. Buffer input produces same hash as utf-8 string of same bytes
{
  const a = computeSha256Hex(Buffer.from('hello', 'utf-8'));
  const b = computeSha256Hex('hello');
  assert(a === b, `Buffer + string-utf8 produce same hash`);
}

// 4. Hex output is 64 lowercase hex chars
{
  const hex = computeSha256Hex('arbitrary');
  assert(/^[0-9a-f]{64}$/.test(hex),
    `output is 64-char lowercase hex (got '${hex}')`);
}

// 5. formatChecksumLine: standard format
{
  const line = formatChecksumLine(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'LaserForge-Setup-1.0.0.exe',
  );
  assert(line === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  LaserForge-Setup-1.0.0.exe',
    `format: hash + 2 spaces + filename (got '${line}')`);
}

// 6. formatChecksumLine: rejects bad hex
{
  let threw = false;
  try { formatChecksumLine('not a hash', 'foo.exe'); } catch { threw = true; }
  assert(threw, 'short hex rejected');

  threw = false;
  try { formatChecksumLine('A'.repeat(64), 'foo.exe'); } catch { threw = true; }
  assert(threw, 'uppercase hex rejected');

  threw = false;
  try { formatChecksumLine('a'.repeat(63), 'foo.exe'); } catch { threw = true; }
  assert(threw, '63-char hex rejected');
}

// 7. formatChecksumLine: rejects empty filename + newline
{
  let threw = false;
  try { formatChecksumLine('a'.repeat(64), ''); } catch { threw = true; }
  assert(threw, 'empty filename rejected');

  threw = false;
  try { formatChecksumLine('a'.repeat(64), 'foo\nbar'); } catch { threw = true; }
  assert(threw, 'newline in filename rejected');
}

// 8. formatChecksumsFile: alphabetical sort by filename
{
  const lines = [
    formatChecksumLine('a'.repeat(64), 'zebra.exe'),
    formatChecksumLine('b'.repeat(64), 'alpha.exe'),
    formatChecksumLine('c'.repeat(64), 'mike.exe'),
  ];
  const text = formatChecksumsFile(lines);
  const ordered = text.trim().split('\n').map((l) => l.split('  ')[1]);
  assert(ordered.toString() === 'alpha.exe,mike.exe,zebra.exe',
    `lines sorted by filename (got ${ordered.join(',')})`);
}

// 9. formatChecksumsFile: trailing newline (POSIX text-file convention)
{
  const text = formatChecksumsFile([formatChecksumLine('a'.repeat(64), 'x.exe')]);
  assert(text.endsWith('\n'), `trailing newline present`);
}

// 10. parseChecksumsFile: round-trip
{
  const a = formatChecksumLine(computeSha256Hex('alpha'), 'alpha.exe');
  const b = formatChecksumLine(computeSha256Hex('beta'), 'beta.dmg');
  const text = formatChecksumsFile([a, b]);
  const parsed = parseChecksumsFile(text);
  assert(parsed.length === 2, `2 entries parsed`);
  assert(parsed[0].filename === 'alpha.exe' && parsed[0].hash === computeSha256Hex('alpha'),
    `first entry round-trips`);
  assert(parsed[1].filename === 'beta.dmg' && parsed[1].hash === computeSha256Hex('beta'),
    `second entry round-trips`);
}

// 11. parseChecksumsFile: tolerates blank lines + binary-mode `*`
{
  const text =
    'a'.repeat(64) + '  alpha.exe\n' +
    '\n' +
    'b'.repeat(64) + '  *beta.exe\n' +   // sha256sum --binary mode
    '   \n';
  const parsed = parseChecksumsFile(text);
  assert(parsed.length === 2, `blank lines skipped (got ${parsed.length})`);
  assert(parsed[1].filename === 'beta.exe',
    `binary-mode '*' prefix stripped (got '${parsed[1].filename}')`);
}

// 12. parseChecksumsFile: rejects malformed lines silently
{
  const text =
    'a'.repeat(64) + '  good.exe\n' +
    'not a checksum line\n' +
    'b'.repeat(64) + '  also-good.exe\n';
  const parsed = parseChecksumsFile(text);
  assert(parsed.length === 2, `2 valid entries parsed (got ${parsed.length})`);
}

// 13. matchesAnyPattern: '*.exe' matches .exe extensions
{
  assert(matchesAnyPattern('LaserForge.exe', ['*.exe']), `*.exe matches .exe`);
  assert(matchesAnyPattern('build.dmg', ['*.exe', '*.dmg']), `multi-pattern: *.dmg matches`);
  assert(!matchesAnyPattern('README.md', ['*.exe', '*.dmg']),
    `unrelated file does not match`);
}

// 14. matchesAnyPattern: dot-only pattern doesn't match arbitrary text
{
  assert(matchesAnyPattern('foo.exe', ['*.exe']), `'foo.exe' matches '*.exe'`);
  assert(!matchesAnyPattern('fooexe', ['*.exe']),
    `'fooexe' (no dot) does NOT match '*.exe'`);
  assert(!matchesAnyPattern('exe', ['*.exe']),
    `'exe' alone does NOT match '*.exe'`);
}

// 15. End-to-end: hash a fake artifact, format, parse, verify hash matches
{
  const fakeBytes = Buffer.from('LaserForge installer payload (fake)');
  const hex = computeSha256Hex(fakeBytes);
  const line = formatChecksumLine(hex, 'LaserForge-1.0.0.exe');
  const text = formatChecksumsFile([line]);
  const parsed = parseChecksumsFile(text);
  assert(parsed.length === 1 && parsed[0].hash === hex
      && parsed[0].filename === 'LaserForge-1.0.0.exe',
    `end-to-end: hash → format → parse round-trips`);
  // Verify the parsed hash matches a fresh computation of the same bytes
  assert(parsed[0].hash === computeSha256Hex(fakeBytes),
    `parsed hash matches re-computed hash`);
}

// 16. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');
  const src = fs.readFileSync(path.resolve(repoRoot, 'src/release/checksumFormat.ts'), 'utf-8');
  assert(/T2-103/.test(src), 'T2-103 marker in checksumFormat.ts');
  for (const id of [
    'computeSha256Hex', 'formatChecksumLine', 'formatChecksumsFile',
    'parseChecksumsFile', 'matchesAnyPattern',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }

  const script = fs.readFileSync(path.resolve(repoRoot, 'scripts/generate-checksums.mjs'), 'utf-8');
  assert(/T2-103/.test(script), 'T2-103 marker in generate-checksums.mjs');
  assert(/SHA256SUMS/.test(script), 'script writes SHA256SUMS');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
