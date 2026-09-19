import {
  compareStableVersions,
  parseStableFeed,
  sha256,
  stableArtifactNames,
  stableFeedVersion,
  STABLE_DOWNLOAD_KEY,
  STABLE_FEED_KEY,
  validateFeedInstaller,
  validateStableRelease,
} from './stable-release-artifacts.mjs';

const IMMUTABLE = 'public, max-age=31536000, immutable';

// The workflow holds ONE repository-wide stable-publication concurrency group
// for this entire operation. REST does not document conditional PUT: this is
// not a distributed lock against another workflow or an administrator with R2 access.
export async function publishStableRelease({ release, store, verifyInstaller }) {
  const files = validateStableRelease(release);
  const executable = stableArtifactNames(release.version)[0];
  await verifyInstaller(files.get(executable), 'local');
  const currentFeed = await store.get(STABLE_FEED_KEY);
  const comparison =
    currentFeed === null
      ? 1
      : compareStableVersions(release.version, stableFeedVersion(currentFeed));
  if (comparison < 0) throw new Error('Refusing to replace a newer stable release.');
  if (comparison === 0 && !currentFeed.equals(files.get('latest.yml')))
    throw new Error('Published version has different feed bytes.');
  const initialAlias = await store.get(STABLE_DOWNLOAD_KEY);
  await requireConsistentAlias(store, currentFeed, initialAlias, files.get(executable));

  const stage = `desktop/releases/${release.version}`;
  const manifestKey = `${stage}/publication-manifest.json`;
  const existingManifest = await store.get(manifestKey);
  const previousFeed =
    comparison === 0 ? priorFeedFromManifest(existingManifest, release.version) : currentFeed;
  const plan = publicationPlan(release, previousFeed);
  const present = await preflightImmutable(store, plan, comparison === 0);
  if (comparison === 0) {
    await verifyPublishedInstaller(store, executable, files.get(executable), verifyInstaller);
    await requireBytes(store, STABLE_DOWNLOAD_KEY, files.get(executable));
    return { status: 'already-published', version: release.version };
  }

  // The manifest is first: it reserves the full byte identity and prior feed
  // before partial uploads. Every already-existing object was checked above.
  for (const entry of plan) {
    if (!present.has(entry.key)) await store.put(entry.key, entry.bytes, metadataFor(entry.key));
    await requireBytes(store, entry.key, entry.bytes);
  }
  await verifyPublishedInstaller(store, executable, files.get(executable), verifyInstaller);
  await requireUnchangedObject(store, STABLE_FEED_KEY, currentFeed, 'feed');
  const alias = await store.get(STABLE_DOWNLOAD_KEY);
  if (!sameBytes(alias, initialAlias))
    throw new Error('Stable download alias changed during publication; refusing promotion.');
  if (alias === null || !alias.equals(files.get(executable))) {
    await store.put(STABLE_DOWNLOAD_KEY, files.get(executable), {
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=300',
    });
  }
  await requireBytes(store, STABLE_DOWNLOAD_KEY, files.get(executable));
  // Re-read immediately before the only final feed write. A conflicting writer
  // observed after staging aborts; the workflow lock prevents normal races here.
  await requireUnchangedObject(store, STABLE_FEED_KEY, currentFeed, 'feed');
  await store.put(STABLE_FEED_KEY, files.get('latest.yml'), {
    contentType: 'text/yaml',
    cacheControl: 'no-cache',
  });
  await requireBytes(store, STABLE_FEED_KEY, files.get('latest.yml'));
  return { status: 'published', version: release.version };
}

function publicationPlan(release, previousFeed) {
  const stage = `desktop/releases/${release.version}`;
  const manifest = {
    schemaVersion: 1,
    version: release.version,
    sourceSha: release.sourceSha,
    artifacts: release.files.map(({ name, bytes }) => ({
      name,
      bytes: bytes.length,
      sha256: sha256(bytes),
    })),
    previousFeedBase64: previousFeed?.toString('base64') ?? null,
  };
  const plan = [
    {
      key: `${stage}/publication-manifest.json`,
      bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    },
  ];
  for (const file of release.files) plan.push({ key: `${stage}/${file.name}`, bytes: file.bytes });
  for (const name of stableArtifactNames(release.version).slice(0, 2)) {
    plan.push({
      key: `desktop/${name}`,
      bytes: release.files.find((file) => file.name === name).bytes,
    });
  }
  if (previousFeed !== null)
    plan.push({
      key: `desktop/rollback/latest-before-${release.version}.yml`,
      bytes: previousFeed,
    });
  return plan;
}

function priorFeedFromManifest(bytes, version) {
  if (bytes === null || bytes.length > 128 * 1024)
    throw new Error('Published release is missing its immutable publication manifest.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.version !== version)
    throw new Error('Invalid publication manifest identity.');
  if (manifest.previousFeedBase64 === null) return null;
  if (typeof manifest.previousFeedBase64 !== 'string')
    throw new Error('Invalid prior-feed snapshot.');
  const previous = Buffer.from(manifest.previousFeedBase64, 'base64');
  if (
    previous.toString('base64') !== manifest.previousFeedBase64 ||
    compareStableVersions(stableFeedVersion(previous), version) >= 0
  )
    throw new Error('Invalid prior-feed snapshot.');
  return previous;
}

async function preflightImmutable(store, plan, requirePresent) {
  const present = new Set();
  for (const entry of plan) {
    const remote = await store.get(entry.key);
    if (remote !== null) {
      if (!remote.equals(entry.bytes))
        throw new Error(
          `Immutable release conflict: ${entry.key}. Use the original artifacts or a new version.`,
        );
      present.add(entry.key);
    } else if (requirePresent) throw new Error(`Published release is incomplete: ${entry.key}`);
  }
  return present;
}

async function requireConsistentAlias(store, currentFeed, alias, candidate) {
  if (alias === null || alias.equals(candidate)) return;
  // A completed alias write followed by a failed feed write leaves the alias
  // ahead of the feed. Only that exact candidate can resume this partial state.
  if (currentFeed !== null) {
    const feed = parseStableFeed(currentFeed);
    const currentInstaller = await store.get(`desktop/${feed.path}`);
    validateFeedInstaller(feed, currentInstaller);
    if (alias.equals(currentInstaller)) return;
  }
  throw new Error(
    'Stable download alias does not match the current feed or this exact candidate. Resume the original publication.',
  );
}

function sameBytes(left, right) {
  return left === null ? right === null : right !== null && left.equals(right);
}

async function requireUnchangedObject(store, key, expected, label) {
  if (!sameBytes(await store.get(key), expected))
    throw new Error(`Stable ${label} changed during publication; refusing promotion.`);
}

async function requireBytes(store, key, expected) {
  const bytes = await store.get(key);
  if (bytes === null || !bytes.equals(expected))
    throw new Error(`Release readback mismatch: ${key}`);
  return bytes;
}

async function verifyPublishedInstaller(store, name, expected, verifyInstaller) {
  const bytes = await requireBytes(store, `desktop/${name}`, expected);
  await verifyInstaller(bytes, 'remote');
}

function metadataFor(key) {
  const contentType = key.endsWith('.json')
    ? 'application/json'
    : key.endsWith('.yml')
      ? 'text/yaml'
      : key.endsWith('.sha256')
        ? 'text/plain'
        : 'application/octet-stream';
  return { contentType, cacheControl: IMMUTABLE };
}
