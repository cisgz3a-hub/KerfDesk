import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewArtifactNames, isPreviewVersion } from '../public/desktop-release-manifest.mjs';
import { publishPreviewRelease } from './preview-release-publisher.mjs';
import { createStableReleaseStore } from './stable-release-store.mjs';

export function requirePreviewPublishContext(version, releaseMetadata, env = process.env) {
  if (
    !isPreviewVersion(version) ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REF_TYPE !== 'tag' ||
    env.GITHUB_REF !== `refs/tags/v${version}` ||
    env.GITHUB_REPOSITORY !== 'cisgz3a-hub/KerfDesk' ||
    env.GITHUB_WORKFLOW_REF !==
      `cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-preview.yml@refs/tags/v${version}` ||
    !/^[a-f0-9]{40}$/u.test(env.APPROVED_RELEASE_SHA ?? '') ||
    env.PREVIEW_PUBLICATION_GROUP !== 'kerfdesk-preview-publication'
  )
    throw new Error(
      'Preview publication requires the canonical serialized tag workflow and approved source.',
    );
  if (
    releaseMetadata.tag_name !== `v${version}` ||
    releaseMetadata.draft !== false ||
    releaseMetadata.prerelease !== true ||
    releaseMetadata.immutable !== true ||
    typeof releaseMetadata.published_at !== 'string' ||
    !Number.isFinite(Date.parse(releaseMetadata.published_at))
  )
    throw new Error('Preview publication requires a published immutable source release.');
  if (!['true', 'false'].includes(env.SOURCE_REPOSITORY_PRIVATE))
    throw new Error('Source repository visibility is required.');
  return {
    schemaVersion: 1,
    channel: 'preview',
    version,
    sourceSha: env.APPROVED_RELEASE_SHA,
    sourceRef: env.GITHUB_REF,
    publishedAt: new Date(releaseMetadata.published_at).toISOString(),
    provenance: {
      kind: env.SOURCE_REPOSITORY_PRIVATE === 'true' ? 'publisher-signature' : 'github-attestation',
      repository: env.GITHUB_REPOSITORY,
      workflow: '.github/workflows/release-desktop-preview.yml',
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
    },
  };
}
async function main() {
  const [directory, version, releaseMetadataPath] = process.argv.slice(2);
  if (!directory || !version || !releaseMetadataPath)
    throw new Error(
      'Usage: publish-preview-release.mjs <asset-directory> <version> <github-release.json>',
    );
  const metadata = requirePreviewPublishContext(
    version,
    JSON.parse(await readFile(releaseMetadataPath, 'utf8')),
  );
  const files = await Promise.all(
    previewArtifactNames(version).map(async (name) => ({
      name,
      bytes: await readFile(join(directory, name)),
    })),
  );
  // This checked-in public key set is the independent verification anchor.
  const keySet = JSON.parse(
    await readFile(new URL('../public/desktop-release-keys.json', import.meta.url), 'utf8'),
  );
  const store = await createStableReleaseStore({
    accountId: process.env.PREVIEW_CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.PREVIEW_R2_API_TOKEN,
  });
  const result = await publishPreviewRelease({
    release: { metadata, files },
    store,
    keySet,
    privateKeyPem: process.env.DESKTOP_PREVIEW_MANIFEST_PRIVATE_KEY,
    keyId: process.env.DESKTOP_PREVIEW_MANIFEST_KEY_ID,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
