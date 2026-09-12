import assert from 'node:assert/strict';
import test from 'node:test';
import { publishStableRelease } from './stable-release-publisher.mjs';
import { requireStablePublishContext } from './publish-stable-release.mjs';
import { STABLE_DOWNLOAD_KEY, STABLE_FEED_KEY } from './stable-release-artifacts.mjs';
import {
  feedOf,
  memoryStore,
  releaseFixture,
  validContext,
} from './stable-release-test-support.mjs';

const verifyInstaller = async () => undefined;
const publish = (release, store, verify = verifyInstaller) =>
  publishStableRelease({ release, store, verifyInstaller: verify });

test('first publication stages and reads back every artifact before moving the feed last', async () => {
  const fixture = memoryStore();
  const signatures = [];
  const release = releaseFixture();
  const result = await publish(release, fixture.store, async (_bytes, origin) =>
    signatures.push(origin),
  );
  assert.equal(result.status, 'published');
  assert.deepEqual(signatures, ['local', 'remote']);
  assert.equal(fixture.writes[0].key, 'desktop/releases/1.2.3/publication-manifest.json');
  assert.equal(fixture.writes.at(-1).key, STABLE_FEED_KEY);
  assert.equal(fixture.writes.at(-2).key, STABLE_DOWNLOAD_KEY);
  assert.deepEqual(fixture.objects.get(STABLE_FEED_KEY), feedOf(release));
  assert.equal(
    fixture.writes.find((write) => write.key.endsWith('.exe.blockmap')).metadata.cacheControl,
    'public, max-age=31536000, immutable',
  );
  assert.equal(fixture.writes.at(-1).metadata.cacheControl, 'no-cache');
});

test('an older release finishing after a newer serialized release cannot roll back either pointer', async () => {
  const fixture = memoryStore('1.9.0');
  await publish(releaseFixture('1.10.0'), fixture.store);
  const promoted = Buffer.from(fixture.objects.get(STABLE_FEED_KEY));
  const writeCount = fixture.writes.length;
  await assert.rejects(publish(releaseFixture('1.9.9'), fixture.store), /newer stable release/u);
  assert.equal(fixture.writes.length, writeCount);
  assert.deepEqual(fixture.objects.get(STABLE_FEED_KEY), promoted);
});

test('successful exact-byte retry is a no-op and preserves the original rollback snapshot', async () => {
  const fixture = memoryStore('1.0.0');
  const original = Buffer.from(fixture.objects.get(STABLE_FEED_KEY));
  const release = releaseFixture();
  await publish(release, fixture.store);
  fixture.writes.length = 0;
  assert.equal((await publish(release, fixture.store)).status, 'already-published');
  assert.equal(fixture.writes.length, 0);
  assert.deepEqual(fixture.objects.get('desktop/rollback/latest-before-1.2.3.yml'), original);
});

test('same version rebuilt with different signed bytes cannot overwrite any immutable object', async () => {
  const fixture = memoryStore();
  await publish(releaseFixture(), fixture.store);
  fixture.writes.length = 0;
  await assert.rejects(
    publish(releaseFixture('1.2.3', 'rebuilt signature timestamp'), fixture.store),
    /different feed bytes/u,
  );
  assert.equal(fixture.writes.length, 0);
});

test('a partial previous attempt resumes only the original artifact instance', async () => {
  const fixture = memoryStore('1.0.0');
  const put = fixture.store.put;
  const failedKey = 'desktop/releases/1.2.3/latest.yml';
  fixture.store.put = async (key, bytes, metadata) => {
    if (key === failedKey) throw new Error('provider unavailable');
    await put(key, bytes, metadata);
  };
  const release = releaseFixture();
  await assert.rejects(publish(release, fixture.store), /provider unavailable/u);
  assert.deepEqual(fixture.objects.get(STABLE_FEED_KEY), feedOf(releaseFixture('1.0.0')));
  const uploaded = new Set(fixture.writes.map((write) => write.key));
  fixture.store.put = put;
  fixture.writes.length = 0;
  await assert.rejects(
    publish(releaseFixture('1.2.3', 'different rebuild'), fixture.store),
    /Immutable release conflict/u,
  );
  assert.equal(fixture.writes.length, 0);
  await publish(release, fixture.store);
  assert.ok(fixture.writes.every((write) => !uploaded.has(write.key)));
});

test('legacy partial objects without a manifest are checked completely before any write', async () => {
  const fixture = memoryStore();
  fixture.objects.set(
    'desktop/KerfDesk-1.2.3-windows-x64-setup.exe.blockmap',
    Buffer.from('old conflicting blockmap'),
  );
  await assert.rejects(publish(releaseFixture(), fixture.store), /Immutable release conflict/u);
  assert.equal(fixture.writes.length, 0);
});

test('matching legacy partial objects can complete without overwriting them', async () => {
  const fixture = memoryStore();
  const release = releaseFixture();
  const key = `desktop/releases/1.2.3/${release.files[0].name}`;
  fixture.objects.set(key, release.files[0].bytes);
  await publish(release, fixture.store);
  assert.ok(fixture.writes.every((write) => write.key !== key));
});

test('rollback snapshot collision fails before even the first stage write', async () => {
  const fixture = memoryStore('1.0.0');
  fixture.objects.set('desktop/rollback/latest-before-1.2.3.yml', feedOf(releaseFixture('0.9.0')));
  await assert.rejects(publish(releaseFixture(), fixture.store), /Immutable release conflict/u);
  assert.equal(fixture.writes.length, 0);
});

test('prior-feed authentication or network failure never becomes a first release', async () => {
  for (const message of ['HTTP 403', 'network timeout', 'HTTP 500']) {
    const fixture = memoryStore('1.0.0');
    fixture.store.get = async () => {
      throw new Error(message);
    };
    await assert.rejects(publish(releaseFixture(), fixture.store), { message });
    assert.equal(fixture.writes.length, 0);
  }
});

test('malformed current metadata fails closed before any write', async () => {
  const fixture = memoryStore();
  fixture.objects.set(STABLE_FEED_KEY, Buffer.from('version: 1.0.0\nfiles: [unterminated'));
  await assert.rejects(publish(releaseFixture(), fixture.store));
  assert.equal(fixture.writes.length, 0);
});

test('a changed feed discovered after staging prevents pointer promotion', async () => {
  const fixture = memoryStore('1.0.0');
  const put = fixture.store.put;
  const newer = feedOf(releaseFixture('2.0.0'));
  fixture.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key.endsWith('latest-before-1.2.3.yml')) fixture.objects.set(STABLE_FEED_KEY, newer);
  };
  await assert.rejects(publish(releaseFixture(), fixture.store), /feed changed/u);
  assert.deepEqual(fixture.objects.get(STABLE_FEED_KEY), newer);
  assert.ok(
    fixture.writes.every(
      (write) => write.key !== STABLE_FEED_KEY && write.key !== STABLE_DOWNLOAD_KEY,
    ),
  );
});

test('alias write failure preserves the old feed and retry preserves the rollback object', async () => {
  const fixture = memoryStore('1.0.0');
  const put = fixture.store.put;
  fixture.store.put = async (key, bytes, metadata) => {
    if (key === STABLE_DOWNLOAD_KEY) throw new Error('alias failure');
    await put(key, bytes, metadata);
  };
  const release = releaseFixture();
  await assert.rejects(publish(release, fixture.store), /alias failure/u);
  assert.deepEqual(fixture.objects.get(STABLE_FEED_KEY), feedOf(releaseFixture('1.0.0')));
  fixture.store.put = put;
  fixture.writes.length = 0;
  await publish(release, fixture.store);
  assert.deepEqual(
    fixture.writes.map((write) => write.key),
    [STABLE_DOWNLOAD_KEY, STABLE_FEED_KEY],
  );
});

test('lost response after successful feed promotion is resolved by a read-only exact retry', async () => {
  const fixture = memoryStore('1.0.0');
  const put = fixture.store.put;
  fixture.store.put = async (key, bytes, metadata) => {
    await put(key, bytes, metadata);
    if (key === STABLE_FEED_KEY) throw new Error('lost acknowledgement');
  };
  const release = releaseFixture();
  await assert.rejects(publish(release, fixture.store), /lost acknowledgement/u);
  fixture.store.put = put;
  fixture.writes.length = 0;
  assert.equal((await publish(release, fixture.store)).status, 'already-published');
  assert.equal(fixture.writes.length, 0);
});

test('an alias ahead of a failed feed cannot be overwritten by another serialized tag', async () => {
  const fixture = memoryStore('1.0.0');
  const put = fixture.store.put;
  fixture.store.put = async (key, bytes, metadata) => {
    if (key === STABLE_FEED_KEY) throw new Error('feed failure');
    await put(key, bytes, metadata);
  };
  const original = releaseFixture('1.2.0');
  await assert.rejects(publish(original, fixture.store), /feed failure/u);
  assert.deepEqual(fixture.objects.get(STABLE_DOWNLOAD_KEY), original.files[0].bytes);
  fixture.store.put = put;
  fixture.writes.length = 0;
  for (const version of ['1.1.0', '1.3.0']) {
    await assert.rejects(
      publish(releaseFixture(version), fixture.store),
      /Resume the original publication/u,
    );
    assert.equal(fixture.writes.length, 0);
  }
  await publish(original, fixture.store);
  assert.deepEqual(
    fixture.writes.map(({ key }) => key),
    [STABLE_FEED_KEY],
  );
});

test('an intervening release after partial staging cannot rewrite the original rollback identity', async () => {
  const fixture = memoryStore('1.0.0');
  const put = fixture.store.put;
  fixture.store.put = async (key, bytes, metadata) => {
    if (key === STABLE_DOWNLOAD_KEY) throw new Error('pre-alias failure');
    await put(key, bytes, metadata);
  };
  const original = releaseFixture('1.2.0');
  await assert.rejects(publish(original, fixture.store), /pre-alias failure/u);
  fixture.store.put = put;
  await publish(releaseFixture('1.1.0'), fixture.store);
  fixture.writes.length = 0;
  await assert.rejects(publish(original, fixture.store), /Immutable release conflict/u);
  assert.equal(fixture.writes.length, 0);
  await publish(releaseFixture('1.2.1'), fixture.store);
  assert.deepEqual(
    fixture.objects.get('desktop/rollback/latest-before-1.2.0.yml'),
    feedOf(releaseFixture('1.0.0')),
  );
});

test('every interrupted write resumes exact bytes without rewriting immutable objects', async () => {
  for (const previous of [null, '1.0.0']) {
    const release = releaseFixture();
    const baseline = memoryStore(previous);
    await publish(release, baseline.store);
    for (let target = 0; target < baseline.writes.length; target += 1) {
      for (const afterWrite of [false, true]) {
        const fixture = memoryStore(previous);
        const put = fixture.store.put;
        let index = 0;
        fixture.store.put = async (key, bytes, metadata) => {
          const interrupt = index++ === target;
          if (interrupt && !afterWrite) throw new Error('interrupted');
          await put(key, bytes, metadata);
          if (interrupt) throw new Error('interrupted');
        };
        await assert.rejects(publish(release, fixture.store), /interrupted/u);
        fixture.store.put = put;
        await publish(release, fixture.store);
        assert.deepEqual(fixture.objects.get(STABLE_FEED_KEY), feedOf(release));
        const immutableWrites = fixture.writes.filter(
          ({ key }) => key !== STABLE_FEED_KEY && key !== STABLE_DOWNLOAD_KEY,
        );
        assert.equal(new Set(immutableWrites.map(({ key }) => key)).size, immutableWrites.length);
      }
    }
  }
});

test('missing publication evidence on an equal-version feed is not silently repaired', async () => {
  const fixture = memoryStore('1.2.3');
  await assert.rejects(
    publish(releaseFixture(), fixture.store),
    /missing its immutable publication manifest/u,
  );
  assert.equal(fixture.writes.length, 0);
});

test('remote byte or Authenticode failure cannot promote the feed', async () => {
  for (const mode of ['bytes', 'signature']) {
    const fixture = memoryStore('1.0.0');
    const put = fixture.store.put;
    fixture.store.put = async (key, bytes, metadata) => {
      await put(key, bytes, metadata);
      if (mode === 'bytes' && key.startsWith('desktop/KerfDesk-') && key.endsWith('.exe'))
        fixture.objects.set(key, Buffer.from('corrupt'));
    };
    const verify = async (_bytes, origin) => {
      if (mode === 'signature' && origin === 'remote') throw new Error('invalid Authenticode');
    };
    await assert.rejects(publish(releaseFixture(), fixture.store, verify));
    assert.ok(
      fixture.writes.every(
        (write) => write.key !== STABLE_FEED_KEY && write.key !== STABLE_DOWNLOAD_KEY,
      ),
    );
  }
});

test('production entry point requires the exact approved stable workflow context', () => {
  assert.doesNotThrow(() => requireStablePublishContext(validContext(), '1.2.3'));
  for (const key of Object.keys(validContext())) {
    assert.throws(
      () => requireStablePublishContext({ ...validContext(), [key]: 'incorrect' }, '1.2.3'),
      /approved tag-push/u,
    );
  }
  assert.throws(
    () => requireStablePublishContext(validContext(), '1.2.3-preview.1'),
    /strict stable/u,
  );
});
