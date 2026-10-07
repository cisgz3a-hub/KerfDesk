import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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

function noticeLinkExists(pathname, directory = publicRoot, privacy = expected) {
  const relative = pathname.replace(/^\//, '');
  const file = relative.endsWith('/') ? relative + 'index.html' : relative;
  if (file.startsWith('privacy/'))
    return privacy.has(file.slice('privacy/'.length).split('/').join(sep));
  try {
    return statSync(join(directory, file)).isFile();
  } catch {
    return false;
  }
}

test('app privacy notice preserves source disclosures and scopes static-page claims', () => {
  const document = expected.get('index.html').toString('utf8');
  const text = textContent(document);
  assert.match(document, /href="https:\/\/kerfdesk.com\/privacy\/"/);
  assert.match(document, /datetime="2026-10-07"/);
  assert.match(text, /Johannes Stephanus Stolk/);
  assert.match(text, /responsible for the personal information KerfDesk handles/);
  assert.match(text, /No cookies on this page/);
  assert.doesNotMatch(text, /This website sets no cookies/);
  assert.match(text, /grouped by date, app version, platform and request country/);
  assert.match(text, /do not identify people or prove an installation/);
  assert.match(text, /quiet weekly license confirmation is due/);
  assert.match(text, /The Free browser workspace has no license and does not contact this service/);
  assert.match(text, /You open the separate Buy Pro page or check a saved purchase/);
  assert.match(text, /Requests use no cookies/);
  assert.match(text, /The unsigned Windows edition checks for updates/);
  assert.match(text, /installation starts only after you choose Install and close KerfDesk/);
  assert.match(text, /Remote access starts turned off/);
  assert.match(text, /Configuring it does not request a draft/);
  assert.match(text, /encrypted with operating-system secure storage/);
  assert.match(text, /Requests set store to false/);
  assert.match(text, /does not promise Zero Data Retention/);
  assert.match(text, /does not attach the open project, canvas, machine settings or toolpaths/);
  assert.match(text, /no network scan or automatic reconnect/);
  assert.match(text, /sameSite=Strict/i);
  assert.match(text, /Command arguments and workspace responses are processed in memory/);
  assert.match(text, /Separately approved machine-control clients can/);
  assert.match(
    text,
    /These records contain no artwork, text contents, job review or executable G-code/,
  );
  assert.match(text, /There is no promised deletion timer for an idle computer/);
  assert.match(document, /http-equiv="Content-Security-Policy"/);
  assert.match(document, /script-src &#39;none&#39;/);
  assert.doesNotMatch(document, /<script\b|<style\b|\son[a-z]+="|\sstyle="|javascript:/i);
  for (const href of attrValues(document, 'a', 'href')) {
    if (href.startsWith('#') || href.startsWith('mailto:')) continue;
    const url = new URL(href, 'https://kerfdesk.com');
    if (url.origin !== 'https://kerfdesk.com') {
      assert.ok(
        new Set([
          'https://www.paddle.com/legal/privacy',
          'https://developers.openai.com/api/docs/guides/your-data',
        ]).has(url.href),
        'Unexpected external notice link',
      );
      continue;
    }
    if (url.pathname === '/') continue;
    assert.ok(noticeLinkExists(url.pathname), `Notice links to missing app file ${url.pathname}`);
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

test('directory links require an actual default document, not an empty directory', (t) => {
  const directory = fixture(t);
  mkdirSync(join(directory, 'pricing'));
  assert.equal(noticeLinkExists('/pricing/', directory), false);
  assert.equal(noticeLinkExists('/pricing/index.html', directory), false);
  writeFileSync(join(directory, 'pricing/index.html'), '<h1>Pricing</h1>');
  assert.equal(noticeLinkExists('/pricing/', directory), true);
  assert.equal(noticeLinkExists('/pricing/index.html', directory), true);
  assert.equal(noticeLinkExists('/refunds/', directory), false);
  assert.equal(noticeLinkExists('/privacy/', directory), true);
  assert.equal(noticeLinkExists('/privacy/', directory, new Map()), false);
  assert.equal(noticeLinkExists('/privacy/missing.html', directory), false);
});
