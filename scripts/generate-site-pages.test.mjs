import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT, buildSitePages } from './generate-site-pages.mjs';
import { blocksHtml, inlineHtml, readDocument } from './site-pages-markdown.mjs';

const pages = await buildSitePages();
const PAGE_FILES = [
  'public/pricing/index.html',
  'public/terms/index.html',
  'public/privacy/index.html',
  'public/refunds/index.html',
];

test('builds the four pages Paddle reviews, and nothing else', () => {
  assert.deepEqual([...pages.keys()].sort(), [...PAGE_FILES].sort());
});

test('the committed pages match their sources', async () => {
  for (const [file, content] of pages) {
    const committed = await readFile(path.join(REPO_ROOT, file), 'utf8');
    assert.equal(committed, content, `${file} is out of date: run pnpm generate:site-pages`);
  }
});

test('every page links pricing and all three policies from its menus', () => {
  for (const [file, content] of pages) {
    for (const href of ['/pricing/', '/terms/', '/privacy/', '/refunds/', '/support.html']) {
      assert.match(content, new RegExp(`href="${href}"`), `${file} does not link ${href}`);
    }
  }
});

test('pages run no script and load nothing from another site', () => {
  for (const [file, content] of pages) {
    assert.doesNotMatch(content, /<script|\son[a-z]+=|javascript:/i, file);
    assert.doesNotMatch(content, /<(?:img|link|iframe)[^>]+(?:src|href)="https?:/i, file);
  }
});

test("the documents' notes to the owner are never published", () => {
  for (const [file, content] of pages) {
    const shown = content.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(shown, /PLACEHOLDER|pending legal checks|docs\/legal|review-notes/i, file);
  }
});

test('blanks the owner has not filled in are marked, never shown as real details', () => {
  assert.equal(
    inlineHtml('of [PLACEHOLDER: physical address], South Africa [PLACEHOLDER]'),
    'of <mark class="blank">[physical address]</mark>, South Africa <mark class="blank">[to be filled in]</mark>',
  );
});

// Paddle's domain review needs the Terms to name the seller; the owner sells as
// an individual under his own legal name (2026-09-29).
test('the Terms, refund and privacy pages name the seller', () => {
  const seller = /Johannes Stephanus Stolk/;
  assert.match(
    pages.get('public/terms/index.html'),
    /This agreement is between Johannes\s+Stephanus Stolk/,
  );
  assert.match(
    pages.get('public/refunds/index.html'),
    /KerfDesk is sold by Johannes\s+Stephanus Stolk/,
  );
  assert.match(pages.get('public/privacy/index.html'), seller);
});

test('reads headings, bold text, wrapped list items and links, and drops notes', () => {
  const { title, blocks } = readDocument(
    [
      '# Title',
      '',
      '> A note to the owner,',
      '> over two lines.',
      '',
      '## 2. Words',
      '',
      '- **Bold** item that wraps',
      '  onto a second line.',
      '- See https://kerfdesk.com/terms/.',
      '',
      'Email support@kerfdesk.com & ask about Help > Licence.',
    ].join('\n'),
  );
  assert.equal(title, 'Title');
  assert.equal(
    blocksHtml(blocks),
    [
      '<h2 id="section-2">2. Words</h2>',
      '<ul><li><strong>Bold</strong> item that wraps onto a second line.</li>' +
        '<li>See <a href="https://kerfdesk.com/terms/">https://kerfdesk.com/terms/</a>.</li></ul>',
      '<p>Email <a href="mailto:support@kerfdesk.com">support@kerfdesk.com</a> &amp; ask about ' +
        'Help &gt; Licence.</p>',
    ].join('\n'),
  );
});

test('a section shown inside another page keeps unique anchors', () => {
  const ids = new Set();
  const first = blocksHtml([{ type: 'heading', level: 2, text: 'Contact' }], { ids });
  const second = blocksHtml([{ type: 'heading', level: 2, text: 'Contact' }], { shift: 1, ids });
  assert.equal(first, '<h2 id="contact">Contact</h2>');
  assert.equal(second, '<h3 id="contact-2">Contact</h3>');
});

test('the pricing page shows the settled offer and never a checkout', () => {
  const pricing = pages.get('public/pricing/index.html');
  assert.match(pricing, /US\$49\.50/);
  assert.match(pricing, /US\$20/);
  for (const tool of ['V-carve', '3D relief', 'Design Studio', 'G-code Inspector']) {
    assert.match(pricing, new RegExp(tool));
  }
  assert.doesNotMatch(pricing, /buy\.html|paddle\.com|checkout\.|_ptxn/i);
  assert.match(pricing, /Purchase opens soon/);
  assert.match(pricing, /merchant of record/);
});

test('the privacy page carries the licensing and purchases notice', () => {
  const privacy = pages.get('public/privacy/index.html');
  assert.match(privacy, /<h1>KerfDesk Privacy Policy<\/h1>/);
  assert.match(
    privacy,
    /<h2 id="[^"]+">\s*KerfDesk Privacy Notice: Licensing and Purchases\s*<\/h2>/,
  );
  assert.match(privacy, /installation digest/);
});
