import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { JSON_SCHEMA, load } from 'js-yaml';
import { MANUAL_CATALOG_URL } from '../public/desktop-manual-catalog.mjs';
import {
  MANUAL_DOWNLOAD_LATEST_URL,
  manualDownloadUrl,
} from '../public/desktop-manual-download.mjs';
import { updateNotesUrl } from '../public/desktop-update-notes.mjs';
import { manualDownloadPayload } from './manual-commercial-manifest.mjs';
import * as stable from './commercial-release-test-support.mjs';
import {
  publicDeliveryArguments,
  readPublicObject,
  verifyPublicDesktopRelease,
} from './verify-public-desktop-release.mjs';

function fixture() {
  const version = '1.2.3';
  const installer = Buffer.from('public installer fixture');
  const payload = manualDownloadPayload(stable.fixture(version).identity, installer, stable.keySet);
  const envelope = stable.signed(payload);
  const manifest = Buffer.from(`${JSON.stringify(envelope)}\n`);
  const installerUrl = manualDownloadUrl(version, payload.artifacts[0].name);
  const immutableUrl = manualDownloadUrl(version, 'download-manifest.json');
  const notes = {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'update-notes',
    channel: 'stable',
    version,
    sourceSha: payload.sourceSha,
    publishedAt: payload.publishedAt,
    highlights: ['Package verification has improved.'],
  };
  const objects = new Map([
    [MANUAL_DOWNLOAD_LATEST_URL, manifest],
    [immutableUrl, manifest],
    [
      MANUAL_CATALOG_URL,
      JSON.stringify({ schemaVersion: 1, kind: 'manual-download-catalog', releases: [envelope] }),
    ],
    [updateNotesUrl(version), JSON.stringify(stable.signed(notes))],
    [installerUrl, installer],
  ]);
  const requests = [];
  const input = {
    expectedVersion: version,
    expectedSourceSha: payload.sourceSha,
    keySet: stable.keySet,
    fetchRequest: async (url, options) => {
      requests.push({ url, options });
      assert.ok(objects.has(url), `unexpected URL ${url}`);
      const value = objects.get(url);
      return typeof value === 'function' ? value() : new Response(value);
    },
  };
  return {
    input,
    objects,
    requests,
    installer,
    installerUrl,
    immutableUrl,
    envelope,
    payload,
    notes,
  };
}

test('public receipt binds pinned metadata, history, notes and streamed bytes to the requested source', async () => {
  const f = fixture();
  const result = await verifyPublicDesktopRelease(f.input);
  assert.equal(result.kind, 'desktop-public-delivery-verification');
  assert.equal(result.status, 'verified');
  assert.equal(result.version, '1.2.3');
  assert.equal(result.sourceSha, 'a'.repeat(40));
  assert.deepEqual(result.artifact, { ...f.payload.artifacts[0], url: f.installerUrl });
  assert.equal(result.manifestSha256, result.objects.immutable.sha256);
  assert.equal(result.manifestSha256, result.objects.latest.sha256);
  assert.ok(Object.values(result.checks).every((value) => value === true));
  assert.equal(result.website, null);
  assert.equal(result.installerExecuted, false);
  assert.equal(f.requests.filter(({ url }) => url === MANUAL_DOWNLOAD_LATEST_URL).length, 2);
  for (const { options } of f.requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(options.headers, { 'Accept-Encoding': 'identity' });
    assert.equal(options.signal.aborted, true);
  }
  for (const object of Object.values(result.objects)) assert.equal(object.body, undefined);
});

test('wrong requested version or source and untrusted signatures fail before installer fetch', async () => {
  for (const mutate of [
    (f) => {
      f.input.expectedVersion = '1.2.4';
    },
    (f) => {
      f.input.expectedSourceSha = 'b'.repeat(40);
    },
    (f) => {
      f.input.keySet = { schemaVersion: 1, keys: [] };
    },
    (f) => {
      f.objects.set(
        MANUAL_DOWNLOAD_LATEST_URL,
        JSON.stringify({ ...f.envelope, signature: Buffer.alloc(64).toString('base64') }),
      );
    },
    (f) => {
      f.objects.set(
        MANUAL_DOWNLOAD_LATEST_URL,
        JSON.stringify(stable.signed({ ...f.payload, codeSigning: 'authenticode' })),
      );
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyPublicDesktopRelease(f.input));
    assert.ok(!f.requests.some(({ url }) => url === f.installerUrl));
  }
});

test('byte-different immutable manifests, missing or conflicting catalogue entries and notes fail', async () => {
  for (const mutate of [
    (f) => {
      f.objects.set(f.immutableUrl, JSON.stringify(f.envelope));
    },
    (f) => {
      f.objects.set(
        MANUAL_CATALOG_URL,
        JSON.stringify({ schemaVersion: 1, kind: 'manual-download-catalog', releases: [] }),
      );
    },
    (f) => {
      const conflicting = stable.signed({ ...f.payload, sourceSha: 'b'.repeat(40) });
      f.objects.set(
        MANUAL_CATALOG_URL,
        JSON.stringify({
          schemaVersion: 1,
          kind: 'manual-download-catalog',
          releases: [conflicting],
        }),
      );
    },
    (f) => {
      f.objects.set(
        updateNotesUrl('1.2.3'),
        JSON.stringify(stable.signed({ ...f.notes, sourceSha: 'b'.repeat(40) })),
      );
    },
    (f) => {
      f.objects.set(updateNotesUrl('1.2.3'), () => new Response('Not found', { status: 404 }));
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyPublicDesktopRelease(f.input));
    assert.ok(!f.requests.some(({ url }) => url === f.installerUrl));
  }
});

test('signed installer size and digest independently reject corrupt, truncated and oversized delivery', async () => {
  for (const body of [
    Buffer.from('x'.repeat(fixture().installer.length)),
    Buffer.from('short'),
    Buffer.from('x'.repeat(fixture().installer.length + 1)),
  ]) {
    const f = fixture();
    f.objects.set(f.installerUrl, body);
    await assert.rejects(verifyPublicDesktopRelease(f.input), /(?:SHA-256|bound)/u);
  }
});

test('a latest pointer change during the download cannot produce a successful receipt', async () => {
  const f = fixture();
  let read = 0;
  f.objects.set(MANUAL_DOWNLOAD_LATEST_URL, () => {
    read += 1;
    return new Response(`${JSON.stringify(f.envelope)}${read === 1 ? '\n' : ' '}`);
  });
  await assert.rejects(verifyPublicDesktopRelease(f.input), /latest changed/u);
});

test('bounded streaming hashes chunks without returning collected installer bytes', async () => {
  const f = fixture();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(f.installer.subarray(0, 4));
      controller.enqueue(f.installer.subarray(4));
      controller.close();
    },
  });
  const result = await readPublicObject(
    f.installerUrl,
    { limit: f.installer.length },
    async () => new Response(stream),
  );
  assert.equal(result.bytes, f.installer.length);
  assert.equal(result.sha256, f.payload.artifacts[0].sha256);
  assert.equal(result.body, undefined);
});

test('CDN compression uses the decoded body bound and hash instead of encoded Content-Length', async () => {
  const f = fixture();
  for (const [encoding, compress] of [
    ['gzip', gzipSync],
    ['br', brotliCompressSync],
  ]) {
    const encoded = compress(f.installer);
    // This is the Response shape exposed by fetch after it transparently decodes the wire body.
    const received = await readPublicObject(
      f.installerUrl,
      { limit: f.installer.length },
      async () =>
        new Response(f.installer, {
          headers: { 'content-encoding': encoding, 'content-length': String(encoded.length) },
        }),
    );
    assert.equal(received.bytes, f.installer.length);
    assert.equal(received.sha256, f.payload.artifacts[0].sha256);
    await assert.rejects(
      readPublicObject(
        f.installerUrl,
        { limit: 4 },
        async () =>
          new Response(f.installer, {
            headers: { 'content-encoding': encoding, 'content-length': String(encoded.length) },
          }),
      ),
      /bound/u,
    );
  }
});

test('compressed latest, immutable, catalogue and notes pass through the complete manual verifier', async () => {
  const f = fixture();
  for (const [url, body] of f.objects) {
    if (!url.endsWith('.json')) continue;
    f.objects.set(
      url,
      () =>
        new Response(body, {
          headers: { 'content-encoding': 'gzip', 'content-length': String(gzipSync(body).length) },
        }),
    );
  }
  assert.equal((await verifyPublicDesktopRelease(f.input)).status, 'verified');
});

test('HTTP errors, redirects, invalid lengths and body length disagreement fail closed', async () => {
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response('redirect', { status: 302, headers: { location: 'https://attacker.invalid/' } }),
    new Response('bad', { headers: { 'content-length': '100' } }),
    new Response('bad', { headers: { 'content-length': '-1' } }),
    new Response('bad', { headers: { 'content-length': 'bad' } }),
    new Response('bad', { headers: { 'content-length': '2' } }),
    new Response('bad', { headers: { 'content-length': '4' } }),
    new Response(''),
  ])
    await assert.rejects(
      readPublicObject(MANUAL_DOWNLOAD_LATEST_URL, { limit: 10 }, async () => response),
    );
  const redirected = new Response('bad');
  Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(
    readPublicObject(MANUAL_DOWNLOAD_LATEST_URL, { limit: 10 }, async () => redirected),
    /redirected/u,
  );
});

test('the deadline covers both hung headers and a stalled response body', async () => {
  let headersSignal;
  await assert.rejects(
    readPublicObject(MANUAL_DOWNLOAD_LATEST_URL, { limit: 10, timeoutMs: 20 }, (_url, options) => {
      headersSignal = options.signal;
      return new Promise(() => {
        // Simulate a fetch implementation that never settles, even after abort.
      });
    }),
    /timed out/u,
  );
  assert.equal(headersSignal.aborted, true);
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(
    readPublicObject(
      MANUAL_DOWNLOAD_LATEST_URL,
      { limit: 10, timeoutMs: 20 },
      async () => response,
    ),
    /timed out/u,
  );
  assert.equal(cancelled, true);
});

test('CLI requires an explicit source/version and fresh absolute output path, without URL/key overrides', () => {
  const valid = [
    '--expected-version',
    '1.2.3',
    '--expected-source-sha',
    'a'.repeat(40),
    '--output-dir',
    resolve('artifacts/public-delivery'),
  ];
  assert.deepEqual(publicDeliveryArguments([...valid, '--website']), {
    expectedVersion: '1.2.3',
    expectedSourceSha: 'a'.repeat(40),
    outputDirectory: resolve('artifacts/public-delivery'),
    website: true,
  });
  for (const args of [
    [],
    [...valid, '--expected-version', '1.2.3'],
    [...valid, '--website', '--website'],
    [...valid, '--keys', 'untrusted.json'],
    [...valid, '--url', 'https://attacker.invalid'],
    valid.slice(0, -1),
    [...valid.slice(0, -1), 'relative-output'],
    ['--expected-version', '../1.2.3', ...valid.slice(2)],
  ])
    assert.throws(() => publicDeliveryArguments(args));
});

test('unsigned workflow verifies public delivery before its durable success receipt and retains failed evidence', async () => {
  const workflow = load(
    await readFile(
      new URL('../.github/workflows/release-desktop-unsigned.yml', import.meta.url),
      'utf8',
    ),
    { schema: JSON_SCHEMA },
  );
  const { qualify, publish } = workflow.jobs;
  // Release-now bypasses the batch size only: it must still be behind the explicit repository switch.
  assert.equal(
    qualify.if.replace(/\s+/gu, ' ').trim(),
    [
      "vars.KERFDESK_UNSIGNED_RELEASES == 'on' && github.repository == 'cisgz3a-hub/KerfDesk' &&",
      "((github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') ||",
      "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' &&",
      "github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' &&",
      'github.event.workflow_run.head_repository.full_name == github.repository))',
    ].join(' '),
  );
  assert.equal(workflow.on.workflow_dispatch.inputs.release_now.default, false);
  assert.equal(publish.needs, 'qualify');
  assert.equal(publish.if, "needs.qualify.outputs.eligible == 'true'");
  const stepFor = (script) => {
    const matches = publish.steps.filter((step) => step.run?.includes(`node scripts/${script}`));
    assert.equal(matches.length, 1, `one workflow step runs ${script}`);
    return matches[0];
  };
  const publication = stepFor('publish-manual-commercial-release.mjs');
  const delivery = stepFor('verify-public-desktop-release.mjs');
  const receipt = stepFor('publish-desktop-release-receipt.mjs');
  assert.ok(publish.steps.indexOf(publication) < publish.steps.indexOf(delivery));
  assert.ok(publish.steps.indexOf(delivery) < publish.steps.indexOf(receipt));
  for (const step of [publication, delivery, receipt]) {
    assert.equal(step.if, "steps.plan.outputs.publish == 'true'");
    assert.notEqual(step['continue-on-error'], true);
  }
  assert.equal(delivery.env.RELEASE_VERSION, '${{ steps.plan.outputs.version }}');
  assert.equal(delivery.env.RELEASE_SHA, '${{ steps.plan.outputs.sourceSha }}');
  assert.match(delivery.run, /--expected-version \$env:RELEASE_VERSION/u);
  assert.match(delivery.run, /--expected-source-sha \$env:RELEASE_SHA/u);
  assert.match(delivery.run, /--output-dir \$evidence --website/u);
  assert.match(delivery.run, /if \(\$LASTEXITCODE -ne 0\) \{ throw/u);
  assert.match(receipt.run, /--public-delivery .*public-desktop-delivery\/public-delivery\.json/u);
  const deliveryArchive = publish.steps.find(
    (step) =>
      step.uses?.startsWith('actions/upload-artifact@') &&
      step.with.path.includes('/public-desktop-delivery/'),
  );
  assert.ok(deliveryArchive);
  assert.ok(publish.steps.indexOf(deliveryArchive) > publish.steps.indexOf(receipt));
  assert.equal(deliveryArchive.if, "always() && steps.plan.outputs.publish == 'true'");
  assert.equal(deliveryArchive.with['retention-days'], 90);
  const qualificationArchive = publish.steps.find(
    (step) =>
      step.uses?.startsWith('actions/upload-artifact@') &&
      step.with.path.includes('/installer-qualification/'),
  );
  assert.ok(qualificationArchive);
  assert.equal(qualificationArchive.if, "always() && steps.plan.outputs.publish == 'true'");
  assert.equal(qualificationArchive.with['retention-days'], 90);
});
