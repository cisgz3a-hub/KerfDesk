import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { populatePreviewDownloads } from '../public/desktop-downloads.mjs';
import { fixture, keySet, rawEnvelope } from './preview-release-test-support.mjs';
const html = await readFile(new URL('../public/download.html', import.meta.url), 'utf8');
function responses(manifest = rawEnvelope()) {
  const requests = [];
  return {
    requests,
    fetchRequest: async (url, options) => {
      requests.push({ url, options });
      return new Response(url === '/desktop-release-keys.json' ? JSON.stringify(keySet) : manifest);
    },
  };
}
test('download page exposes exact versioned platform links and hashes only after verification', async () => {
  const document = new JSDOM(html).window.document;
  const server = responses();
  assert.equal(document.querySelector('a.download').hasAttribute('href'), false);
  await populatePreviewDownloads(document, '', server.fetchRequest);
  assert.match(
    document.querySelector('#release-status').textContent,
    /Publisher signature verified/u,
  );
  for (const link of document.querySelectorAll('a.download')) {
    assert.equal(link.hidden, false);
    assert.match(
      link.href,
      /^https:\/\/dl\.kerfdesk\.com\/desktop\/previews\/0\.2\.0-preview\.14\/KerfDesk-/u,
    );
    assert.match(
      link.closest('.card').querySelector('.artifact-hash').textContent,
      /^SHA-256: [a-f0-9]{64}$/u,
    );
  }
  assert.equal(server.requests[0].url, 'https://dl.kerfdesk.com/desktop/previews/latest.json');
  for (const request of server.requests) {
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.redirect, 'error');
  }
});
test('exact-version links never silently substitute another release', async () => {
  const document = new JSDOM(html).window.document;
  const server = responses();
  await populatePreviewDownloads(document, '?version=0.2.0-preview.13', server.fetchRequest);
  assert.equal(
    server.requests[0].url,
    'https://dl.kerfdesk.com/desktop/previews/0.2.0-preview.13/release.json',
  );
  assert.match(document.querySelector('#release-status').textContent, /unavailable/u);
  for (const link of document.querySelectorAll('[data-preview-suffix]'))
    assert.equal(link.hasAttribute('href'), false);
});
test('tampering, malicious requested paths and offline errors leave every link disabled', async () => {
  const bad = fixture().payload;
  bad.artifacts[0].name = '../../evil.exe';
  for (const [search, fetchRequest] of [
    ['', responses('{}').fetchRequest],
    ['', responses(rawEnvelope(bad)).fetchRequest],
    ['?version=../../evil', responses().fetchRequest],
    [
      '',
      async () => {
        throw new Error('offline');
      },
    ],
  ]) {
    const document = new JSDOM(html).window.document;
    await populatePreviewDownloads(document, search, fetchRequest);
    assert.match(document.querySelector('#release-status').textContent, /unavailable/u);
    for (const link of document.querySelectorAll('[data-preview-suffix], #signed-manifest')) {
      assert.equal(link.hidden, true);
      assert.equal(link.hasAttribute('href'), false);
    }
  }
});
