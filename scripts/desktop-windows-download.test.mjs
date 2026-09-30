import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWindowsDesktopDownload } from '../public/desktop-windows-download.mjs';
import {
  COMMERCIAL_CATALOG_LIMIT,
  COMMERCIAL_CATALOG_URL,
} from '../public/desktop-commercial-catalog.mjs';
import {
  catalogBytes,
  signCommercialManifest,
  updatePayload,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import { commercialReleaseFiles } from './commercial-release-publisher.mjs';
import * as stable from './commercial-release-test-support.mjs';
import * as preview from './preview-release-test-support.mjs';
import { MANUAL_DOWNLOAD_LATEST_URL } from '../public/desktop-manual-download.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';

function published(versions = ['1.2.3']) {
  const entries = versions.map((version) => {
    const release = stable.fixture(version);
    const identity = verifyCommercialEnvelope(release.identity, stable.keySet, 'release-identity');
    const payload = updatePayload(identity, commercialReleaseFiles(release, identity));
    return {
      payload,
      envelope: signCommercialManifest(payload, stable.privateKeyPem, stable.keyId, stable.keySet),
    };
  });
  return { entries, text: catalogBytes(entries).toString('utf8') };
}

function server(catalog, keys = stable.keySet, manual = null) {
  const requests = [];
  return {
    requests,
    fetchRequest: async (url, options) => {
      requests.push({ url, options });
      assert.ok(
        [COMMERCIAL_CATALOG_URL, MANUAL_DOWNLOAD_LATEST_URL, '/desktop-release-keys.json'].includes(
          url,
        ),
      );
      if (url === MANUAL_DOWNLOAD_LATEST_URL)
        return manual === null ? new Response('', { status: 404 }) : new Response(manual);
      return url === COMMERCIAL_CATALOG_URL
        ? typeof catalog === 'string'
          ? new Response(catalog)
          : catalog
        : new Response(JSON.stringify(keys));
    },
  };
}

test('resolves the newest real publisher-signed Windows manifest into a pinned URL and digest', async () => {
  const { text, entries } = published(['1.2.3', '1.10.0', '1.9.0']);
  const host = server(text);
  const result = await resolveWindowsDesktopDownload(host);
  const installer = entries[1].payload.artifacts[0];
  assert.deepEqual(result, {
    status: 'ready',
    version: '1.10.0',
    url: 'https://dl.kerfdesk.com/desktop/commercial/releases/1.10.0/KerfDesk-1.10.0-windows-x64-setup.exe',
    fileName: installer.name,
    sha256: installer.sha256,
    bytes: installer.bytes,
    publishedAt: entries[1].payload.publishedAt,
    codeSigning: 'signed',
    updates: 'automatic',
  });
  assert.equal(host.requests.length, 2);
  for (const { options } of host.requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
  }
});

test('falls back only from absent or empty signed stable to a stable-key-authenticated unsigned manual release', async () => {
  const payload = manualDownloadPayload(
    stable.fixture('1.2.3').identity,
    Buffer.from('unsigned package'),
    stable.keySet,
  );
  const manual = JSON.stringify(
    await signManualDownload(payload, stable.privateKeyPem, stable.keyId, stable.keySet),
  );
  for (const catalog of [new Response('', { status: 404 }), '{"schemaVersion":1,"releases":[]}']) {
    const result = await resolveWindowsDesktopDownload(server(catalog, stable.keySet, manual));
    assert.equal(result.status, 'ready');
    assert.equal(result.codeSigning, 'unsigned');
    assert.equal(result.updates, 'manual');
    assert.equal(
      result.url,
      'https://dl.kerfdesk.com/desktop/commercial-manual/releases/1.2.3/KerfDesk-1.2.3-windows-x64-setup.exe',
    );
    assert.equal(result.sha256, payload.artifacts[0].sha256);
  }
  const valid = server(published().text, stable.keySet, manual);
  assert.equal((await resolveWindowsDesktopDownload(valid)).codeSigning, 'signed');
  assert.equal(
    valid.requests.some(({ url }) => url === MANUAL_DOWNLOAD_LATEST_URL),
    false,
  );
  const bad = server('{"schemaVersion":1,"releases":[{}]}', stable.keySet, manual);
  assert.deepEqual(await resolveWindowsDesktopDownload(bad), {
    status: 'error',
    reason: 'invalid-release',
  });
  assert.equal(
    bad.requests.some(({ url }) => url === MANUAL_DOWNLOAD_LATEST_URL),
    false,
  );
  assert.deepEqual(
    await resolveWindowsDesktopDownload(
      server(new Response('', { status: 404 }), stable.keySet, '{}'),
    ),
    { status: 'error', reason: 'invalid-release' },
  );
});

test('missing or empty commercial catalogue is unreleased and never falls back to Preview', async () => {
  for (const catalog of [
    new Response('missing', { status: 404 }),
    '{"schemaVersion":1,"releases":[]}',
  ]) {
    const host = server(catalog);
    assert.deepEqual(await resolveWindowsDesktopDownload(host), {
      status: 'unavailable',
      reason: 'not-released',
    });
    assert.ok(
      host.requests.every(({ url }) => !url.includes('preview') && !url.includes('sandbox')),
    );
  }
});

test('tampering, Preview signatures, malformed metadata and signed hostile paths never produce links', async () => {
  const { entries } = published();
  const tampered = structuredClone(entries[0].envelope);
  tampered.signature = Buffer.alloc(64).toString('base64');
  const hostile = structuredClone(entries[0].payload);
  hostile.artifacts[0].name = '../../attacker.exe';
  const extraUrl = { ...entries[0].payload, url: 'https://attacker.example/installer.exe' };
  const anchors = { schemaVersion: 1, keys: [...stable.keySet.keys, ...preview.keySet.keys] };
  for (const text of [
    '{}',
    'not json',
    JSON.stringify({ schemaVersion: 1, releases: [tampered] }),
    JSON.stringify({ schemaVersion: 1, releases: [JSON.parse(preview.rawEnvelope())] }),
    JSON.stringify({ schemaVersion: 1, releases: [stable.signed(hostile)] }),
    JSON.stringify({ schemaVersion: 1, releases: [stable.signed(extraUrl)] }),
  ])
    assert.deepEqual(await resolveWindowsDesktopDownload(server(text, anchors)), {
      status: 'error',
      reason: 'invalid-release',
    });
});

test('bounded response handling rejects oversized catalogue and trust anchors', async () => {
  const oversized = new Response('not read', {
    headers: { 'content-length': String(COMMERCIAL_CATALOG_LIMIT + 1) },
  });
  assert.deepEqual(await resolveWindowsDesktopDownload(server(oversized)), {
    status: 'error',
    reason: 'invalid-release',
  });
  assert.deepEqual(
    await resolveWindowsDesktopDownload(
      server(published().text, { oversized: 'x'.repeat(16_384) }),
    ),
    { status: 'error', reason: 'invalid-release' },
  );
});

test('HTTP failures and rejected fetches stay errors, never a false no-release state', async () => {
  for (const status of [401, 403, 429, 500, 503])
    assert.deepEqual(await resolveWindowsDesktopDownload(server(new Response('', { status }))), {
      status: 'error',
      reason: 'network',
    });
  assert.deepEqual(
    await resolveWindowsDesktopDownload({
      fetchRequest: async () => {
        throw new Error('offline');
      },
    }),
    { status: 'error', reason: 'network' },
  );
});

test('timeout settles and aborts even when fetch or its response body ignores cancellation', async () => {
  let requestSignal;
  const fetchRequest = async (_url, { signal }) => {
    requestSignal = signal;
    return new Promise(() => undefined);
  };
  assert.deepEqual(await resolveWindowsDesktopDownload({ fetchRequest, timeoutMs: 15 }), {
    status: 'error',
    reason: 'timeout',
  });
  assert.equal(requestSignal.aborted, true);
  const stalled = new Response(
    new ReadableStream({
      pull() {
        return new Promise(() => undefined);
      },
    }),
  );
  assert.deepEqual(await resolveWindowsDesktopDownload({ ...server(stalled), timeoutMs: 15 }), {
    status: 'error',
    reason: 'timeout',
  });
});

test('caller cancellation is distinguished from a timeout and an already-aborted call never fetches', async () => {
  const controller = new AbortController();
  let requestSignal;
  const result = resolveWindowsDesktopDownload({
    signal: controller.signal,
    fetchRequest: async (_url, { signal }) => {
      requestSignal = signal;
      return new Promise(() => undefined);
    },
  });
  controller.abort();
  assert.deepEqual(await result, { status: 'error', reason: 'aborted' });
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(
    await resolveWindowsDesktopDownload({
      signal: controller.signal,
      fetchRequest: async () => {
        assert.fail('must not fetch');
      },
    }),
    { status: 'error', reason: 'aborted' },
  );
});
