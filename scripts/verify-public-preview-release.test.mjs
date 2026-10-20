import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { JSON_SCHEMA, load } from 'js-yaml';
import {
  PREVIEW_ORIGIN,
  PREVIEW_PREFIX,
  previewArtifactNames,
  previewAssetUrl,
} from '../public/desktop-release-manifest.mjs';
import * as preview from './preview-release-test-support.mjs';
import * as stable from './commercial-release-test-support.mjs';
import { publicDeliveryArguments } from './verify-public-desktop-release.mjs';
import {
  PREVIEW_LATEST_URL,
  verifyPublicPreviewRelease,
} from './verify-public-preview-release.mjs';

function fixture() {
  const release = preview.fixture();
  const manifest = `${preview.rawEnvelope(release.payload)}\n`;
  const immutableUrl = `${PREVIEW_ORIGIN}/${PREVIEW_PREFIX}/${release.payload.version}/release.json`;
  const objects = new Map([
    [PREVIEW_LATEST_URL, manifest],
    [immutableUrl, manifest],
    ...release.files.map(({ name, bytes }) => [
      previewAssetUrl(release.payload.version, name),
      bytes,
    ]),
  ]);
  const requests = [];
  return {
    release,
    objects,
    requests,
    immutableUrl,
    input: {
      expectedVersion: release.payload.version,
      expectedSourceSha: release.payload.sourceSha,
      keySet: preview.keySet,
      fetchRequest: async (url, options) => {
        requests.push({ url, options });
        assert.ok(objects.has(url), `unexpected URL ${url}`);
        const value = objects.get(url);
        return typeof value === 'function' ? value() : new Response(value);
      },
    },
  };
}

test('Preview delivery verifies every signed Windows, Mac and evidence artifact without executing them', async () => {
  const f = fixture();
  const receipt = await verifyPublicPreviewRelease(f.input);
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.kind, 'desktop-public-preview-delivery-verification');
  assert.equal(receipt.sourceSha, f.input.expectedSourceSha);
  assert.equal(receipt.version, f.input.expectedVersion);
  assert.equal(receipt.manifestSha256, receipt.objects.immutable.sha256);
  assert.deepEqual(
    receipt.artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
    f.release.payload.artifacts,
  );
  assert.equal(receipt.installerExecuted, false);
  assert.equal(receipt.website, null);
  assert.ok(Object.values(receipt.checks).every(Boolean));
  assert.ok(receipt.artifacts.every((artifact) => artifact.body === undefined));
  assert.equal(f.requests.length, f.release.files.length + 3);
  for (const { options } of f.requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, true);
  }
});

test('missing Preview feed fails directly without a GitHub or unsigned-release fallback', async () => {
  const f = fixture();
  f.objects.set(PREVIEW_LATEST_URL, () => new Response('Not found', { status: 404 }));
  await assert.rejects(verifyPublicPreviewRelease(f.input), /request failed/u);
  assert.deepEqual(
    f.requests.map(({ url }) => url),
    [PREVIEW_LATEST_URL],
  );
});

test('compressed Preview manifests and artifacts verify their decoded signed bytes', async () => {
  const f = fixture();
  for (const [url, body] of f.objects) {
    f.objects.set(
      url,
      () =>
        new Response(body, {
          headers: { 'content-encoding': 'gzip', 'content-length': String(gzipSync(body).length) },
        }),
    );
  }
  assert.equal((await verifyPublicPreviewRelease(f.input)).status, 'verified');
});

test('wrong version/source, stable-purpose keys and different immutable manifests fail before asset fetch', async () => {
  for (const mutate of [
    (f) => {
      f.input.expectedVersion = '0.2.0-preview.15';
    },
    (f) => {
      f.input.expectedSourceSha = 'b'.repeat(40);
    },
    (f) => {
      f.input.keySet = stable.keySet;
    },
    (f) => {
      f.objects.set(f.immutableUrl, `${preview.rawEnvelope(f.release.payload)} `);
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(verifyPublicPreviewRelease(f.input));
    assert.ok(!f.requests.some(({ url }) => url.endsWith('.exe') || url.endsWith('.dmg')));
  }
});

test('corrupt or missing Mac packages and ancillary evidence refuse the complete Preview receipt', async () => {
  for (const index of [1, 2, 6]) {
    const f = fixture();
    const file = f.release.files[index];
    const url = previewAssetUrl(f.release.payload.version, file.name);
    f.objects.set(url, Buffer.alloc(file.bytes.length));
    await assert.rejects(verifyPublicPreviewRelease(f.input), /signed size or SHA-256/u);
  }
  const f = fixture();
  const mac = f.release.files[2];
  f.objects.set(
    previewAssetUrl(f.release.payload.version, mac.name),
    () => new Response('Missing', { status: 404 }),
  );
  await assert.rejects(verifyPublicPreviewRelease(f.input), /request failed/u);
});

test('Preview latest is checked again after every artifact has streamed', async () => {
  const f = fixture();
  let reads = 0;
  f.objects.set(
    PREVIEW_LATEST_URL,
    () => new Response(`${preview.rawEnvelope(f.release.payload)}${++reads === 1 ? '\n' : ' '}`),
  );
  await assert.rejects(verifyPublicPreviewRelease(f.input), /latest changed/u);
});

test('Preview CLI keeps the same explicit identity and output requirements with Preview versions', () => {
  const args = [
    '--expected-version',
    '0.2.0-preview.14',
    '--expected-source-sha',
    'a'.repeat(40),
    '--output-dir',
    resolve('artifacts/preview-delivery'),
    '--website',
  ];
  assert.equal(publicDeliveryArguments(args, previewArtifactNames).website, true);
  assert.throws(() => publicDeliveryArguments(args));
  assert.throws(() =>
    publicDeliveryArguments(
      ['--expected-version', '1.2.3', ...args.slice(2)],
      previewArtifactNames,
    ),
  );
});

test('Preview workflow checks public delivery after R2 publication and retains evidence even on failure', async () => {
  const workflow = load(
    await readFile(
      new URL('../.github/workflows/release-desktop-preview.yml', import.meta.url),
      'utf8',
    ),
    { schema: JSON_SCHEMA },
  );
  const publish = workflow.jobs['publish-preview'];
  assert.deepEqual(workflow.on.push.tags, ['v*-preview.*']);
  assert.equal(workflow.on.workflow_dispatch, undefined);
  const stepFor = (script) => {
    const matches = publish.steps.filter((step) => step.run?.includes(`node scripts/${script}`));
    assert.equal(matches.length, 1, `one workflow step runs ${script}`);
    return matches[0];
  };
  const publication = stepFor('publish-preview-release.mjs');
  const delivery = stepFor('verify-public-preview-release.mjs');
  assert.ok(publish.steps.indexOf(publication) < publish.steps.indexOf(delivery));
  assert.equal(
    delivery.if,
    undefined,
    'a successful publication always requires delivery verification',
  );
  assert.notEqual(delivery['continue-on-error'], true);
  assert.equal(delivery.env.VERSION, '${{ steps.release.outputs.version }}');
  assert.equal(delivery.env.SOURCE_SHA, '${{ steps.release.outputs.source_sha }}');
  assert.match(delivery.run, /--expected-version "\$\{VERSION\}"/u);
  assert.match(delivery.run, /--expected-source-sha "\$\{SOURCE_SHA\}"/u);
  assert.match(
    delivery.run,
    /--output-dir "\$\{RUNNER_TEMP\}\/preview-public-delivery" --website/u,
  );
  const archive = publish.steps.find(
    (step) =>
      step.uses?.startsWith('actions/upload-artifact@') &&
      step.with.path.includes('/preview-public-delivery/'),
  );
  assert.ok(archive);
  assert.ok(publish.steps.indexOf(archive) > publish.steps.indexOf(delivery));
  assert.equal(archive.if, 'always()');
  assert.equal(archive.with['retention-days'], 90);
  // Seven three-minute artifact deadlines plus metadata and browser checks need more than 21 minutes.
  // GitHub's default job timeout is 360 minutes when no explicit override is configured.
  assert.ok((publish['timeout-minutes'] ?? 360) >= 30);
});
