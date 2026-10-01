import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appPrivacyFiles, checkPrivacyFiles } from '../../scripts/generate-privacy-page.mjs';
import { attrValues, textContent } from './helpers.mjs';

const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
const expected = await appPrivacyFiles();

function fixture(t) {
  const prefix = join(tmpdir(), 'kerfdesk-privacy-');
  const directory = mkdtempSync(prefix);
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(prefix)));
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`));
    rmSync(directory, { recursive: true });
  });
  for (const [name, bytes] of expected) {
    const target = join(directory, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return directory;
}

test('app privacy notice preserves source disclosures and scopes static-page claims', () => {
  const document = expected.get('index.html').toString('utf8');
  const text = textContent(document);
  assert.match(document, /href="https:\/\/kerfdesk.com\/privacy\/"/);
  assert.match(document, /datetime="2026-09-30"/);
  assert.match(text, /No cookies on this page/);
  assert.doesNotMatch(text, /This website sets no cookies/);
  assert.match(text, /grouped by date, app version, platform and request country/);
  assert.match(text, /do not identify people or prove an installation/);
  assert.match(text, /quiet weekly license confirmation is due/);
  assert.match(text, /The unsigned Windows edition checks for updates/);
  assert.match(text, /installation starts only after you choose Install and close KerfDesk/);
  assert.match(document, /http-equiv="Content-Security-Policy"/);
  assert.match(document, /script-src &#39;none&#39;/);
  assert.doesNotMatch(document, /<script\b|<style\b|\son[a-z]+="|\sstyle="|javascript:/i);
  for (const href of attrValues(document, 'a', 'href')) {
    if (href.startsWith('#') || href.startsWith('mailto:')) continue;
    const url = new URL(href, 'https://kerfdesk.com');
    assert.equal(url.origin, 'https://kerfdesk.com');
    if (url.pathname === '/') continue;
    const path = url.pathname.replace(/^\//, '');
    assert.ok(
      path.startsWith('privacy/')
        ? expected.has(path.slice('privacy/'.length))
        : existsSync(join(publicRoot, path)),
      `Notice links to missing app file ${url.pathname}`,
    );
  }
});

test('privacy check accepts exact files and rejects changed policy bytes', (t) => {
  const directory = fixture(t);
  checkPrivacyFiles(directory, expected);
  writeFileSync(join(directory, 'index.html'), 'outdated privacy notice');
  assert.throws(() => checkPrivacyFiles(directory, expected), /Stale privacy output: index.html/);
});

test('privacy check rejects a missing hashed asset and obsolete cached asset', (t) => {
  const directory = fixture(t);
  const asset = [...expected.keys()].find((name) => name.endsWith('.css'));
  unlinkSync(join(directory, asset));
  assert.throws(() => checkPrivacyFiles(directory, expected), /Missing privacy output: assets/);
  writeFileSync(join(directory, asset), expected.get(asset));
  writeFileSync(join(directory, 'assets', 'site.0000000000.css'), 'old stylesheet');
  assert.throws(() => checkPrivacyFiles(directory, expected), /Obsolete privacy asset/);
});
