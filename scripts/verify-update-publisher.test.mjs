import assert from 'node:assert/strict';
import test from 'node:test';
import { updatePublisherProblems } from './verify-update-publisher.mjs';

const SIGNER = 'CN=Example Publisher, O=Example Publisher, C=US';
// The shape electron-builder writes for a store-certificate signed build.
const SIGNED_CONFIG = [
  'provider: generic',
  'url: https://dl.kerfdesk.com/desktop',
  'updaterCacheDirName: laserforge-updater',
  'publisherName:',
  '  - Example Publisher',
  '',
].join('\n');

test('accepts a publisherName equal to the signer CN', () => {
  assert.deepEqual(updatePublisherProblems(SIGNED_CONFIG, SIGNER), []);
});

test('accepts a full DN that matches the signer on every key it names', () => {
  const config = 'provider: generic\npublisherName: CN=Example Publisher, C=US\n';
  assert.deepEqual(updatePublisherProblems(config, SIGNER), []);
});

test('refuses a config with no publisherName, which would skip update signature checks', () => {
  const [problem] = updatePublisherProblems(
    'provider: generic\nurl: https://dl.kerfdesk.com/desktop\n',
    SIGNER,
  );
  assert.match(problem ?? '', /names no publisherName/);
});

test('refuses a publisherName that is not the installer signer', () => {
  const [problem] = updatePublisherProblems(SIGNED_CONFIG, 'CN=Someone Else, O=Someone Else, C=US');
  assert.match(problem ?? '', /does not match the installer signer/);
  const [dnProblem] = updatePublisherProblems(
    'publisherName: CN=Example Publisher, C=GB\n',
    SIGNER,
  );
  assert.match(dnProblem ?? '', /does not match/);
});
