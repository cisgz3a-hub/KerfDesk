import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readBoundedManifest,
  verifyPreviewManifest,
  previewAssetUrl,
} from '../public/desktop-release-manifest.mjs';
import { publishPreviewRelease, PREVIEW_LATEST_KEY } from './preview-release-publisher.mjs';
import { requirePreviewPublishContext } from './publish-preview-release.mjs';
import {
  fixture,
  keyId,
  keySet,
  memoryStore,
  privateKeyPem,
  rawEnvelope,
} from './preview-release-test-support.mjs';

const publish = (release, store) =>
  publishPreviewRelease({ release, store, keySet, keyId, privateKeyPem });
test('verifies exact signed bytes and derives fixed versioned URLs', async () => {
  const payload = fixture().payload;
  assert.deepEqual(await verifyPreviewManifest(rawEnvelope(payload), keySet), payload);
  assert.match(
    previewAssetUrl(payload.version, payload.artifacts[0].name),
    /^https:\/\/dl\.kerfdesk\.com\/desktop\/previews\/0\.2\.0-preview\.14\/KerfDesk-/u,
  );
  assert.throws(() => previewAssetUrl(payload.version, '../anything.exe'));
});
test('rejects invalid signatures, unknown keys, duplicate key IDs and wrong-purpose keys', async () => {
  const bad = JSON.parse(rawEnvelope());
  bad.signature = Buffer.alloc(64).toString('base64');
  await assert.rejects(verifyPreviewManifest(JSON.stringify(bad), keySet), /signature/u);
  for (const keys of [
    [],
    [keySet.keys[0], keySet.keys[0]],
    [{ ...keySet.keys[0], channel: 'stable' }],
    [{ ...keySet.keys[0], keyId: 'another' }],
  ]) {
    await assert.rejects(verifyPreviewManifest(rawEnvelope(), { schemaVersion: 1, keys }));
  }
});
test('rejects traversal, duplicate/missing assets, malformed sizes/hashes, extra URLs, noncanonical versions and future timestamps even when signed', async () => {
  const changes = [
    (p) => {
      p.artifacts[0].name = '../evil.exe';
    },
    (p) => {
      p.artifacts[0] = p.artifacts[1];
    },
    (p) => {
      p.artifacts.pop();
    },
    (p) => {
      p.artifacts[0].bytes = 0;
    },
    (p) => {
      p.artifacts[0].bytes = 300_000_001;
    },
    (p) => {
      p.artifacts[0].sha256 = 'f'.repeat(63);
    },
    (p) => {
      p.artifacts[0].url = 'https://attacker.invalid/';
    },
    (p) => {
      p.version = '00.2.0-preview.14';
    },
    (p) => {
      p.publishedAt = '9999-01-01T00:00:00.000Z';
    },
    (p) => {
      p.publishedAt = '2026-02-30T00:00:00.000Z';
    },
    (p) => {
      p.sourceRef = 'refs/heads/main';
    },
    (p) => {
      p.channel = 'stable';
    },
  ];
  for (const change of changes) {
    const payload = fixture().payload;
    change(payload);
    await assert.rejects(verifyPreviewManifest(rawEnvelope(payload), keySet));
  }
});
test('bounded reader rejects HTTP failure, size overflow, false lengths and invalid UTF-8', async () => {
  for (const response of [
    new Response('not found', { status: 404 }),
    new Response('x', { headers: { 'content-length': '999999' } }),
    new Response('x', { headers: { 'content-length': '-1' } }),
    new Response('a'.repeat(128 * 1024 + 1)),
    new Response(new Uint8Array([255])),
  ])
    await assert.rejects(readBoundedManifest(response));
});
test('publication reserves immutable manifest, verifies all readbacks, and promotes latest last', async () => {
  const f = memoryStore();
  assert.equal((await publish(fixture(), f.store)).status, 'published');
  assert.equal(f.writes[0].key, 'desktop/previews/0.2.0-preview.14/publication-reservation.json');
  assert.equal(f.writes.at(-2).key, 'desktop/previews/0.2.0-preview.14/release.json');
  assert.equal(f.writes.at(-1).key, PREVIEW_LATEST_KEY);
  assert.equal(f.writes.at(-1).metadata.cacheControl, 'no-store');
  assert.equal(
    (await verifyPreviewManifest(f.objects.get(PREVIEW_LATEST_KEY).toString(), keySet)).version,
    '0.2.0-preview.14',
  );
  f.writes.length = 0;
  const retry = fixture();
  retry.metadata.provenance.runAttempt = '2';
  assert.equal((await publish(retry, f.store)).status, 'already-published');
  assert.equal(f.writes.length, 0);
});
test('older release cannot roll back latest and rebuilt same version cannot overwrite objects', async () => {
  const f = memoryStore();
  await publish(fixture(), f.store);
  f.writes.length = 0;
  await assert.rejects(publish(fixture('0.2.0-preview.13'), f.store), /rollback/u);
  const rebuilt = fixture();
  rebuilt.files[0].bytes = Buffer.from('different');
  await assert.rejects(publish(rebuilt, f.store), /different/u);
  assert.equal(f.writes.length, 0);
});
test('preflight fails closed on a conflicting late object, corrupt signed pointer or inaccessible storage', async () => {
  const f = memoryStore();
  const release = fixture();
  f.objects.set(
    `desktop/previews/${release.metadata.version}/${release.files.at(-1).name}`,
    Buffer.from('conflict'),
  );
  await assert.rejects(publish(release, f.store), /conflict/u);
  assert.equal(f.writes.length, 0);
  f.objects.clear();
  f.objects.set(PREVIEW_LATEST_KEY, Buffer.from('{}'));
  await assert.rejects(publish(release, f.store));
  assert.equal(f.writes.length, 0);
  await assert.rejects(
    publish(release, {
      ...f.store,
      get: async () => {
        throw new Error('403');
      },
    }),
    /403/u,
  );
});
test('failed readback leaves latest untouched and a partial retry fills missing versioned objects', async () => {
  const f = memoryStore();
  const put = f.store.put;
  let broken = true;
  f.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (broken && key.endsWith('.exe')) f.objects.set(key, Buffer.from('corrupt'));
  };
  await assert.rejects(publish(fixture(), f.store), /readback/u);
  assert.equal(f.objects.has(PREVIEW_LATEST_KEY), false);
  assert.equal(f.objects.has('desktop/previews/0.2.0-preview.14/release.json'), false);
  broken = false;
  for (const key of f.objects.keys()) if (key.endsWith('.exe')) f.objects.delete(key);
  assert.equal((await publish(fixture(), f.store)).status, 'published');
});
test('detects pointer movement before final promotion', async () => {
  const f = memoryStore();
  const put = f.store.put;
  f.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key.endsWith('.exe'))
      f.objects.set(
        PREVIEW_LATEST_KEY,
        Buffer.from(rawEnvelope(fixture('0.2.0-preview.15').payload)),
      );
  };
  await assert.rejects(publish(fixture(), f.store), /pointer changed/u);
  assert.equal(
    f.writes.some((write) => write.key === PREVIEW_LATEST_KEY),
    false,
  );
});
test('publication context binds canonical workflow, tag, visibility, published source and serialization', () => {
  const version = fixture().metadata.version;
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF: `refs/tags/v${version}`,
    GITHUB_REPOSITORY: 'cisgz3a-hub/KerfDesk',
    GITHUB_WORKFLOW_REF: `cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-preview.yml@refs/tags/v${version}`,
    APPROVED_RELEASE_SHA: 'a'.repeat(40),
    PREVIEW_PUBLICATION_GROUP: 'kerfdesk-preview-publication',
    SOURCE_REPOSITORY_PRIVATE: 'true',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
  };
  const source = {
    tag_name: `v${version}`,
    draft: false,
    prerelease: true,
    immutable: true,
    published_at: '2026-01-01T00:00:00Z',
  };
  assert.equal(
    requirePreviewPublishContext(version, source, env).provenance.kind,
    'publisher-signature',
  );
  for (const field of [
    'GITHUB_ACTIONS',
    'GITHUB_REF_TYPE',
    'GITHUB_REF',
    'GITHUB_REPOSITORY',
    'GITHUB_WORKFLOW_REF',
    'APPROVED_RELEASE_SHA',
    'PREVIEW_PUBLICATION_GROUP',
    'SOURCE_REPOSITORY_PRIVATE',
  ])
    assert.throws(() =>
      requirePreviewPublishContext(version, source, { ...env, [field]: 'wrong' }),
    );
  assert.throws(() => requirePreviewPublishContext(version, { ...source, draft: true }, env));
});
