import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  APP_TERMS_MODULE,
  TERMS_SOURCE,
  termsEdition,
  termsSafetySection,
  termsText,
} from './app-terms-module.mjs';
import { REPO_ROOT, buildAppTerms } from './generate-site-pages.mjs';

const terms = await readFile(path.join(REPO_ROOT, TERMS_SOURCE), 'utf8');

test('the committed app terms match the terms', async () => {
  const [[file, content]] = await buildAppTerms();
  assert.equal(file, APP_TERMS_MODULE);
  const committed = await readFile(path.join(REPO_ROOT, file), 'utf8');
  assert.equal(committed, content, `${file} is out of date: run pnpm generate:site-pages`);
});

test('reads the version, and no publication date while it is a blank', () => {
  assert.deepEqual(
    termsEdition('# T\n\nVersion 1.0. Last updated: [PLACEHOLDER: publication date]\n'),
    {
      version: '1.0',
      lastUpdated: null,
    },
  );
  assert.deepEqual(termsEdition('# T\n\nVersion 2.1. Last updated: 12 October 2026\n'), {
    version: '2.1',
    lastUpdated: '12 October 2026',
  });
  assert.throws(() => termsEdition('# T\n\nLast updated today\n'), /Version N\.N/);
});

// The step asks users to confirm they have read section 2 (terms 2.5), so the
// app must show all of it, from its opening warning to the confirmation.
test('takes the whole machine-safety section and nothing after it', () => {
  const { heading, blocks } = termsSafetySection(terms);
  assert.equal(heading, '2. MACHINE SAFETY: PLEASE READ THIS CAREFULLY');
  const shown = JSON.stringify(blocks);
  for (const clause of [
    '2.1 What you must do.',
    '2.2 ',
    '2.3 ',
    '2.4 ',
    '2.5 Your confirmation.',
  ]) {
    assert.ok(shown.includes(clause), `section 2 is missing ${clause}`);
  }
  assert.ok(shown.includes('These machines can start fires and cause serious injury or death'));
  assert.ok(shown.includes('Never leave a running machine unattended.'));
  assert.doesNotMatch(shown, /3\. Words we use|“Paddle”/);
});

test('keeps bold text and bare links, and refuses markup the app cannot show', () => {
  assert.deepEqual(termsText('**2.4 Tested.** See https://kerfdesk.com/machines/ for status.'), [
    { strong: '2.4 Tested.' },
    ' See ',
    { link: 'https://kerfdesk.com/machines/' },
    ' for status.',
  ]);
  assert.throws(
    () => termsText('Our [site](https://kerfdesk.com/).'),
    /plain text, bold and bare links/,
  );
  assert.throws(() => termsText('An *italic* word.'), /plain text, bold and bare links/);
  assert.throws(
    () => termsText('Of [PLACEHOLDER: street address].'),
    /plain text, bold and bare links/,
  );
  assert.throws(() => termsText('**See https://kerfdesk.com/**'), /link inside bold/);
});
