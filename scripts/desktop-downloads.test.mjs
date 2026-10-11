import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  populateCommercialDownload,
  populatePreviewDownloads,
} from '../public/desktop-downloads.mjs';
import { verifyCommercialCatalog } from '../public/desktop-commercial-catalog.mjs';
import {
  MANUAL_DOWNLOAD_LATEST_URL,
  manualDownloadUrl,
} from '../public/desktop-manual-download.mjs';
import { MANUAL_CATALOG_URL } from '../public/desktop-manual-catalog.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import { verifyPreviewManifest } from '../public/desktop-release-manifest.mjs';
import {
  catalogBytes,
  signCommercialManifest,
  updatePayload,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import { commercialReleaseFiles } from './commercial-release-publisher.mjs';
import * as stable from './commercial-release-test-support.mjs';
import {
  fixture,
  keyId,
  keySet,
  privateKeyPem,
  rawEnvelope,
} from './preview-release-test-support.mjs';
const html = await readFile(new URL('../public/download.html', import.meta.url), 'utf8');
// The website anchors both channels in one file, exactly like public/desktop-release-keys.json.
const anchors = { schemaVersion: 1, keys: [...keySet.keys, ...stable.keySet.keys] };
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
// Catalogue bytes produced by the real operator publisher code, not a browser-side fixture.
function publishedCatalog(versions, source = {}) {
  const entries = versions.map((version) => {
    const release = stable.fixture(version, source);
    const identity = verifyCommercialEnvelope(release.identity, stable.keySet, 'release-identity');
    const payload = updatePayload(identity, commercialReleaseFiles(release, identity));
    const envelope = signCommercialManifest(
      payload,
      stable.privateKeyPem,
      stable.keyId,
      stable.keySet,
    );
    return { envelope, payload };
  });
  return { entries, text: catalogBytes(entries).toString('utf8') };
}
function commercialServer(catalog, manual = null, history = undefined, versions = {}) {
  const requests = [];
  return {
    requests,
    fetchRequest: async (url, options) => {
      requests.push({ url, options });
      if (url === '/desktop-release-keys.json') return new Response(JSON.stringify(anchors));
      if (url === MANUAL_DOWNLOAD_LATEST_URL)
        return manual === null ? new Response('Not found', { status: 404 }) : new Response(manual);
      if (url === MANUAL_CATALOG_URL) {
        const value =
          history === undefined && manual !== null
            ? JSON.stringify({
                schemaVersion: 1,
                kind: 'manual-download-catalog',
                releases: [JSON.parse(manual)],
              })
            : history;
        return value == null ? new Response('Not found', { status: 404 }) : new Response(value);
      }
      if (url.includes('/commercial-manual/releases/'))
        return versions[url] === undefined
          ? new Response('Not found', { status: 404 })
          : new Response(versions[url]);
      return catalog === null ? new Response('Not found', { status: 404 }) : new Response(catalog);
    },
  };
}

async function manualCatalog(versions) {
  const releases = await Promise.all(
    versions.map(async (version) =>
      signManualDownload(
        manualDownloadPayload(
          stable.fixture(version).identity,
          Buffer.from(`package-${version}`),
          stable.keySet,
        ),
        stable.privateKeyPem,
        stable.keyId,
        stable.keySet,
      ),
    ),
  );
  return {
    releases,
    latest: JSON.stringify(releases[0]),
    text: JSON.stringify({ schemaVersion: 1, kind: 'manual-download-catalog', releases }),
  };
}

test('manual commercial download is labelled unsigned and manual, separate from the Preview and signed update feed', async () => {
  const payload = manualDownloadPayload(
    stable.fixture().identity,
    Buffer.from('unsigned package'),
    stable.keySet,
  );
  const manual = JSON.stringify(
    await signManualDownload(payload, stable.privateKeyPem, stable.keyId, stable.keySet),
  );
  const document = new JSDOM(html).window.document;
  await populateCommercialDownload(document, commercialServer(null, manual).fetchRequest);
  const [download, manifest] = commercialLinks(document);
  assert.equal(download.hidden, false);
  assert.ok(download.href.includes('/desktop/commercial-manual/releases/'));
  assert.ok(manifest.href.endsWith('/download-manifest.json'));
  assert.match(
    document.querySelector('#commercial-status').textContent,
    /Unsigned installer · Manual updates/u,
  );
  assert.match(
    document.querySelector('#commercial-installation').textContent,
    /not Windows code-signed/u,
  );
  assert.match(
    document.querySelector('#commercial-installation').textContent,
    /never downloads or installs unsigned updates without your approval/u,
  );
  assert.equal(document.querySelector('#commercial-history').hidden, true);
  for (const link of document.querySelectorAll('[data-preview-suffix]'))
    assert.equal(link.hasAttribute('href'), false);
  const tampered = commercialServer('{"schemaVersion":1,"releases":[{}]}', manual);
  await populateCommercialDownload(document, tampered.fetchRequest);
  assert.equal(download.hasAttribute('href'), false);
  assert.equal(
    tampered.requests.some(({ url }) => url === MANUAL_DOWNLOAD_LATEST_URL),
    false,
  );
});
function commercialLinks(document) {
  return ['#commercial-download', '#commercial-manifest'].map((id) => document.querySelector(id));
}
test('download page exposes exact versioned platform links and hashes only after verification', async () => {
  const document = new JSDOM(html).window.document;
  const server = responses();
  for (const link of document.querySelectorAll('a.download'))
    assert.equal(link.hasAttribute('href'), false);
  await populatePreviewDownloads(document, '', server.fetchRequest);
  assert.match(
    document.querySelector('#release-status').textContent,
    /Publisher signature verified/u,
  );
  assert.equal(document.querySelector('#commercial-download').hasAttribute('href'), false);
  for (const link of document.querySelectorAll('a.download[data-preview-suffix]')) {
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
  assert.equal(document.querySelector('#preview-links').hidden, false);
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
    assert.equal(document.querySelector('#preview-links').hidden, true);
    for (const link of document.querySelectorAll('[data-preview-suffix], #signed-manifest')) {
      assert.equal(link.hidden, true);
      assert.equal(link.hasAttribute('href'), false);
    }
  }
});

test('the licensed Windows trial says it is unreleased while no commercial catalogue exists', async () => {
  for (const catalog of [null, '{"schemaVersion":1,"releases":[]}\n']) {
    const document = new JSDOM(html).window.document;
    const server = commercialServer(catalog);
    await populateCommercialDownload(document, server.fetchRequest);
    assert.match(
      document.querySelector('#commercial-status').textContent,
      /has not been released yet/u,
    );
    for (const link of commercialLinks(document)) {
      assert.equal(link.hidden, true);
      assert.equal(link.hasAttribute('href'), false);
    }
    assert.equal(document.querySelector('#commercial-history').hidden, true);
    assert.equal(server.requests[0].url, 'https://dl.kerfdesk.com/desktop/commercial/catalog.json');
    for (const request of server.requests) {
      assert.equal(request.options.credentials, 'omit');
      assert.equal(request.options.redirect, 'error');
    }
  }
});

test('a publisher-built catalogue offers the newest signed installer and keeps older ones reachable', async () => {
  const { entries, text } = publishedCatalog(['1.2.3', '1.10.0', '1.9.0']);
  const document = new JSDOM(html).window.document;
  await populateCommercialDownload(document, commercialServer(text).fetchRequest);
  const [download, manifest] = commercialLinks(document);
  const installer = entries[1].payload.artifacts[0];
  assert.equal(installer.name, 'KerfDesk-1.10.0-windows-x64-setup.exe');
  assert.equal(
    download.href,
    'https://dl.kerfdesk.com/desktop/commercial/releases/1.10.0/KerfDesk-1.10.0-windows-x64-setup.exe',
  );
  assert.equal(
    manifest.href,
    'https://dl.kerfdesk.com/desktop/commercial/releases/1.10.0/update-manifest.json',
  );
  assert.equal(download.hidden, false);
  assert.equal(document.querySelector('#commercial-asset').textContent, installer.name);
  assert.equal(
    document.querySelector('#commercial-hash').textContent,
    `SHA-256: ${installer.sha256}`,
  );
  assert.match(
    document.querySelector('#commercial-status').textContent,
    /^KerfDesk 1\.10\.0 · Released 2026-01-01 · Publisher signature verified\.$/u,
  );
  // Customers whose update year ended can still reach the versions their licence covers.
  const history = [...document.querySelectorAll('#commercial-history-list a')];
  assert.equal(document.querySelector('#commercial-history').hidden, false);
  assert.deepEqual(
    history.map((link) => [link.textContent, link.href]),
    ['1.9.0', '1.2.3'].map((version) => [
      `KerfDesk ${version}`,
      `https://dl.kerfdesk.com/desktop/commercial/releases/${version}/KerfDesk-${version}-windows-x64-setup.exe`,
    ]),
  );
  assert.match(
    history[1].nextSibling.textContent,
    new RegExp(`SHA-256: ${entries[0].payload.artifacts[0].sha256}$`, 'u'),
  );
  // The Preview links stay untouched: the two editions never share a download.
  for (const link of document.querySelectorAll('[data-preview-suffix]'))
    assert.equal(link.hasAttribute('href'), false);
});

test('manual release history lists verified older installers numerically with release dates and hashes', async () => {
  const manual = await manualCatalog(['1.10.0', '1.2.3', '1.9.0']);
  const document = new JSDOM(html).window.document;
  await populateCommercialDownload(
    document,
    commercialServer(null, manual.latest, manual.text).fetchRequest,
  );
  const history = [...document.querySelectorAll('#commercial-history-list a')];
  assert.deepEqual(
    history.map((link) => link.textContent),
    ['KerfDesk 1.9.0', 'KerfDesk 1.2.3'],
  );
  for (const link of history) {
    assert.match(
      link.href,
      /^https:\/\/dl[.]kerfdesk[.]com\/desktop\/commercial-manual\/releases\//u,
    );
    assert.match(
      link.nextSibling.textContent,
      /Released 2026-01-01 · Unsigned installer · SHA-256: [a-f0-9]{64}$/u,
    );
  }
  assert.equal(document.querySelector('#commercial-history-status').textContent, '');
  assert.match(commercialLinks(document)[0].href, /\/1[.]10[.]0\//u);
});

test('manual versions remain reachable after the signed installer lane starts', async () => {
  const manual = await manualCatalog(['1.9.0', '1.2.3']);
  const signed = publishedCatalog(['1.10.0', '1.9.0']);
  const document = new JSDOM(html).window.document;
  await populateCommercialDownload(
    document,
    commercialServer(signed.text, manual.latest, manual.text).fetchRequest,
  );
  assert.match(commercialLinks(document)[0].href, /\/commercial\/releases\/1[.]10[.]0\//u);
  const history = [...document.querySelectorAll('#commercial-history-list a')];
  assert.deepEqual(
    history.map((link) => link.textContent),
    ['KerfDesk 1.9.0', 'KerfDesk 1.2.3'],
  );
  assert.match(history[0].href, /\/commercial\/releases\//u);
  assert.match(history[1].href, /\/commercial-manual\/releases\//u);
});

test('stable exact-version selection works before and after manual history publication', async () => {
  const manual = await manualCatalog(['1.10.0', '1.2.3']);
  const immutable = manualDownloadUrl('1.2.3', 'download-manifest.json');
  for (const history of [manual.text, null]) {
    const document = new JSDOM(html).window.document;
    const server = commercialServer(null, manual.latest, history, {
      [immutable]: JSON.stringify(manual.releases[1]),
    });
    await populateCommercialDownload(document, server.fetchRequest, '?version=1.2.3');
    assert.match(commercialLinks(document)[0].href, /\/1[.]2[.]3\//u);
    assert.match(
      document.querySelector('#commercial-status').textContent,
      /^KerfDesk 1[.]2[.]3 ·/u,
    );
    assert.equal(
      server.requests.some(({ url }) => url === immutable),
      history === null,
    );
  }
  const document = new JSDOM(html).window.document;
  await populateCommercialDownload(
    document,
    commercialServer(publishedCatalog(['2.0.0', '1.9.0']).text).fetchRequest,
    '?version=1.9.0',
  );
  assert.match(commercialLinks(document)[0].href, /\/commercial\/releases\/1[.]9[.]0\//u);
  const preview = responses();
  await populatePreviewDownloads(document, '?version=1.9.0', preview.fetchRequest);
  assert.equal(preview.requests[0].url, 'https://dl.kerfdesk.com/desktop/previews/latest.json');
  assert.match(
    document.querySelector('#release-status').textContent,
    /Publisher signature verified/u,
  );
});

test('missing, tampered or mismatched exact stable versions never substitute latest', async () => {
  const manual = await manualCatalog(['1.10.0']);
  for (const [search, immutableBody] of [
    ['?version=1.2.3', undefined],
    ['?version=1.2.3', manual.latest],
    ['?version=1.2.3', '{}'],
    ['?version=1.11.0', manual.latest],
    ['?version=../../evil', undefined],
    ['?version=1.2.3&version=1.10.0', undefined],
  ]) {
    const document = new JSDOM(html).window.document;
    const server = commercialServer(null, manual.latest, null, {
      [manualDownloadUrl('1.2.3', 'download-manifest.json')]: immutableBody,
    });
    await populateCommercialDownload(document, server.fetchRequest, search);
    assert.match(
      document.querySelector('#commercial-status').textContent,
      /That desktop version could not be verified/u,
    );
    for (const link of commercialLinks(document)) assert.equal(link.hasAttribute('href'), false);
    assert.equal(document.querySelector('#commercial-hash').textContent, '');
    assert.equal(
      server.requests.some(({ url }) => url.includes('/releases/1.11.0/')),
      false,
    );
  }
});

test('bad or unavailable history preserves verified latest and shows recovery guidance', async () => {
  const manual = await manualCatalog(['1.10.0', '1.9.0']);
  const tampered = JSON.parse(manual.text);
  tampered.releases[1].signature = Buffer.alloc(64).toString('base64');
  for (const history of [null, '{}', JSON.stringify(tampered)]) {
    const document = new JSDOM(html).window.document;
    await populateCommercialDownload(
      document,
      commercialServer(null, manual.latest, history).fetchRequest,
    );
    assert.match(commercialLinks(document)[0].href, /\/1[.]10[.]0\//u);
    assert.equal(document.querySelector('#commercial-history-list').children.length, 0);
    assert.equal(document.querySelector('#commercial-history').hidden, false);
    assert.match(
      document.querySelector('#commercial-history-status').textContent,
      /Contact KerfDesk support/u,
    );
  }
});

test('an interrupted future history entry is hidden until its authenticated latest is promoted', async () => {
  const manual = await manualCatalog(['1.11.0', '1.10.0', '1.9.0']);
  const document = new JSDOM(html).window.document;
  await populateCommercialDownload(
    document,
    commercialServer(null, JSON.stringify(manual.releases[1]), manual.text).fetchRequest,
  );
  assert.match(commercialLinks(document)[0].href, /\/1[.]10[.]0\//u);
  assert.deepEqual(
    [...document.querySelectorAll('#commercial-history-list a')].map((link) => link.textContent),
    ['KerfDesk 1.9.0'],
  );
  await populateCommercialDownload(
    document,
    commercialServer(null, JSON.stringify(manual.releases[1]), manual.text).fetchRequest,
    '?version=1.11.0',
  );
  assert.equal(commercialLinks(document)[0].hasAttribute('href'), false);
});

test('unverifiable entries are skipped, and nothing unverified is ever offered', async () => {
  const { entries, text } = publishedCatalog(['1.2.3', '1.3.0']);
  const catalog = JSON.parse(text);
  const [first, second] = catalog.releases;
  // A genuine Preview-key signature over an otherwise valid, unduplicated commercial payload.
  const previewSigned = {
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: entries[1].envelope.payload,
    signature: sign(
      null,
      Buffer.from(entries[1].envelope.payload, 'base64'),
      privateKeyPem,
    ).toString('base64'),
  };
  const tampered = structuredClone(catalog);
  const payload = JSON.parse(Buffer.from(tampered.releases[0].payload, 'base64').toString());
  payload.artifacts[0].sha256 = 'f'.repeat(64);
  tampered.releases[0].payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const catalogOf = (releases) => JSON.stringify({ schemaVersion: 1, releases });
  // A bad entry never hides a good one: the newest verified release is offered.
  for (const [body, offered] of [
    [catalogOf([first, previewSigned]), '1.2.3'],
    [JSON.stringify(tampered), '1.3.0'],
  ]) {
    const document = new JSDOM(html).window.document;
    await populateCommercialDownload(document, commercialServer(body).fetchRequest);
    assert.match(
      document.querySelector('#commercial-status').textContent,
      new RegExp(`^KerfDesk ${offered.replaceAll('.', '[.]')} · `, 'u'),
    );
    assert.equal(document.querySelector('#commercial-history').hidden, true);
  }
  const cases = [
    catalogOf([tampered.releases[0]]),
    catalogOf([previewSigned]),
    catalogOf([first, second, second]),
    JSON.stringify({ ...catalog, extra: true }),
    `${' '.repeat(256 * 1024)}${text}`,
    'not json',
  ];
  for (const body of cases) {
    const document = new JSDOM(html).window.document;
    await populateCommercialDownload(document, commercialServer(body).fetchRequest);
    assert.match(
      document.querySelector('#commercial-status').textContent,
      /^No verified download of the licensed Windows edition is available right now\./u,
    );
    for (const link of commercialLinks(document)) {
      assert.equal(link.hidden, true);
      assert.equal(link.hasAttribute('href'), false);
    }
    assert.equal(document.querySelector('#commercial-hash').textContent, '');
    assert.equal(document.querySelector('#commercial-history').hidden, true);
    assert.equal(document.querySelectorAll('#commercial-history-list li').length, 0);
  }
  // An unprovisioned or unreachable host reads the same: nothing is claimed either way.
  const offline = new JSDOM(html).window.document;
  await populateCommercialDownload(offline, async () => {
    throw new Error('offline');
  });
  assert.match(offline.querySelector('#commercial-status').textContent, /^No verified download/u);
});

test('a release train build of main is offered, and no other branch ever is', async () => {
  const { entries, text } = publishedCatalog(['2026.40.0'], { sourceRef: 'refs/heads/main' });
  assert.deepEqual(
    (await verifyCommercialCatalog(text, anchors)).map((release) => release.sourceRef),
    ['refs/heads/main'],
  );
  // A genuine stable-key signature over a build of any other branch.
  const feature = stable.signed({ ...entries[0].payload, sourceRef: 'refs/heads/feature' });
  const catalogOf = (releases) => JSON.stringify({ schemaVersion: 1, releases });
  assert.deepEqual(
    (await verifyCommercialCatalog(catalogOf([feature, entries[0].envelope]), anchors)).map(
      (release) => release.sourceRef,
    ),
    ['refs/heads/main'],
  );
  await assert.rejects(
    verifyCommercialCatalog(catalogOf([feature]), anchors),
    /no verifiable release/u,
  );
});

test('stable and Preview anchors authorize only their own channel', async () => {
  const { text } = publishedCatalog(['2.0.0']);
  const releases = await verifyCommercialCatalog(text, anchors);
  assert.deepEqual(
    releases.map((release) => release.version),
    ['2.0.0'],
  );
  // The same key bytes under the other channel's label must not verify either lane.
  const relabel = (keys, channel) => ({
    schemaVersion: 1,
    keys: keys.map((key) => ({ ...key, channel })),
  });
  await assert.rejects(
    verifyCommercialCatalog(text, relabel(stable.keySet.keys, 'preview')),
    /no verifiable release/u,
  );
  await assert.rejects(
    verifyPreviewManifest(rawEnvelope(), relabel(keySet.keys, 'stable')),
    /wrong-purpose/u,
  );
  assert.equal((await verifyPreviewManifest(rawEnvelope(), anchors)).channel, 'preview');
});
