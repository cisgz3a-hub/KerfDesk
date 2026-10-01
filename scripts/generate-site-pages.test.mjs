import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { commerce } from '../website/commerce.config.mjs';
import { LAUNCH_NOTE } from '../website/lib/commerce.mjs';
import {
  DOWNLOAD_PAGE,
  POLICY_PAGES,
  REPO_ROOT,
  buildDownloadPage,
  buildSitePages,
  buildSiteStyles,
} from './generate-site-pages.mjs';
import { launchNoteHtml } from './site-pages-layout.mjs';
import { blocksHtml, inlineHtml, readDocument } from './site-pages-markdown.mjs';

const pages = await buildSitePages();
const PAGE_FILES = [
  'public/pricing/index.html',
  'public/terms/index.html',
  'public/privacy/index.html',
  'public/refunds/index.html',
  'public/paia-manual/index.html',
  'public/license/index.html',
  'public/machines/index.html',
  'public/safety/index.html',
];

test('builds the pricing, legal, machines and safety pages, and nothing else', () => {
  assert.deepEqual([...pages.keys()].sort(), [...PAGE_FILES].sort());
});

test('the committed pages match their sources', async () => {
  for (const [file, content] of pages) {
    const committed = await readFile(path.join(REPO_ROOT, file), 'utf8');
    assert.equal(committed, content, `${file} is out of date: run pnpm generate:site-pages`);
  }
});

// The pages read as if Pro is on sale, and until sales open each one, the download
// page too, opens with the one launch line (ADR-524 Amendment 4).
test('every page and the download page open with the one launch line until sales open', async () => {
  assert.equal(commerce.salesOpen, false);
  const download = await buildDownloadPage();
  const committed = await readFile(path.join(REPO_ROOT, DOWNLOAD_PAGE), 'utf8');
  assert.equal(committed, download.get(DOWNLOAD_PAGE), 'run pnpm generate:site-pages');
  for (const [file, content] of [...pages, ...download]) {
    assert.equal(content.split(LAUNCH_NOTE).length, 2, `${file} shows the launch line once`);
  }
  assert.doesNotMatch(committed, /once sales open/i);
  assert.equal(launchNoteHtml(true), '');
});

test('every page links pricing, support and every legal page from its menus', () => {
  const links = ['/pricing/', '/terms/', '/privacy/', '/refunds/', '/paia-manual/', '/license/'];
  for (const [file, content] of pages) {
    for (const href of [...links, '/support.html']) {
      assert.match(content, new RegExp(`href="${href}"`), `${file} does not link ${href}`);
    }
  }
});

test('pages run no script and load nothing from another site', () => {
  for (const [file, content] of pages) {
    assert.doesNotMatch(content, /<script|\son[a-z]+=|javascript:/i, file);
    assert.doesNotMatch(content, /<(?:img|link|iframe)[^>]+(?:src|href)="https?:/i, file);
    assert.match(content, /http-equiv="Content-Security-Policy"/i, file);
    assert.match(content, /script-src 'none'/, file);
    assert.doesNotMatch(content, /<style\b|\sstyle=/i, file);
    assert.match(content, /href="\/site-pages[.]css"/, file);
  }
});

test('the shared page stylesheet ships with the generated policy documents', async () => {
  const styles = await buildSiteStyles();
  for (const [file, content] of styles) {
    assert.equal(await readFile(path.join(REPO_ROOT, file), 'utf8'), content);
  }
});

test('no raw blank or working file shows on a page', () => {
  for (const [file, content] of pages) {
    const shown = content.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(shown, /PLACEHOLDER|docs\/legal|review-notes/i, file);
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
test('every legal page names the seller', () => {
  assert.match(
    pages.get('public/terms/index.html'),
    /These terms are an agreement between you and Johannes\s+Stephanus\s+Stolk, trading as\s+KerfDesk/,
  );
  for (const file of PAGE_FILES) {
    assert.match(pages.get(file), /Johannes\s+Stephanus\s+Stolk/, file);
  }
});

test('reads headings, bold and italic text, wrapped and nested lists, links and address lines', () => {
  const { title, blocks } = readDocument(
    [
      '# Title',
      '',
      '## 2. Words',
      '',
      '- **Bold** item that wraps',
      '  onto a second line.',
      '- See https://kerfdesk.com/terms/ or the [Refund Policy](https://kerfdesk.com/refunds/).',
      '  - a nested point',
      '',
      '*Not open yet.*',
      '',
      'Email support@kerfdesk.com or privacy@paddle.com & ask about Help > Licence.',
      'Telephone: [PLACEHOLDER: telephone number]',
    ].join('\n'),
  );
  assert.equal(title, 'Title');
  assert.equal(
    blocksHtml(blocks),
    [
      '<h2 id="section-2">2. Words</h2>',
      '<ul><li><strong>Bold</strong> item that wraps onto a second line.</li>' +
        '<li>See <a href="https://kerfdesk.com/terms/">https://kerfdesk.com/terms/</a> or the ' +
        '<a href="https://kerfdesk.com/refunds/">Refund Policy</a>.<ul><li>a nested point</li></ul></li></ul>',
      '<p><em>Not open yet.</em></p>',
      '<p>Email <a href="mailto:support@kerfdesk.com">support@kerfdesk.com</a> or ' +
        '<a href="mailto:privacy@paddle.com">privacy@paddle.com</a> &amp; ask about Help &gt; ' +
        'Licence.<br />Telephone: <mark class="blank">[telephone number]</mark></p>',
    ].join('\n'),
  );
});

test('reads boxed notes, numbered lists, tables and rules', () => {
  const { blocks } = readDocument(
    [
      '# Title',
      '',
      '> **Not on sale yet.**',
      '>',
      '> Every tool is free.',
      '',
      '1. Choose **Buy Pro**.',
      '2. Pay.',
      '',
      '| | Price | How |',
      '|---|---|---|',
      '| Pro | **US$49.50** | Once |',
      '',
      '---',
    ].join('\n'),
  );
  assert.equal(
    blocksHtml(blocks),
    [
      '<aside class="note"><p><strong>Not on sale yet.</strong></p>\n<p>Every tool is free.</p></aside>',
      '<ol><li>Choose <strong>Buy Pro</strong>.</li><li>Pay.</li></ol>',
      '<div class="table-scroll"><table><thead><tr><th></th><th>Price</th><th>How</th></tr></thead>' +
        '<tbody><tr><td>Pro</td><td><strong>US$49.50</strong></td><td>Once</td></tr></tbody></table></div>',
      '<hr />',
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

// The pricing page is a checked legal text, and the product website shows the
// same offer from commerce.config.mjs: a change to one must reach the other.
test('the pricing page shows the settled offer, says Pro is not on sale and links no checkout', () => {
  const pricing = pages.get('public/pricing/index.html');
  const [pro] = commerce.plans;
  assert.equal(commerce.salesOpen, false);
  assert.match(pricing, new RegExp(`US\\$${pro.price.toFixed(2).replace('.', '\\.')} plus tax`));
  assert.match(pricing, new RegExp(`US\\$${pro.updateYearPrice} plus tax`));
  assert.match(pricing, new RegExp(`Up to ${pro.deviceLimit} computers at a time`));
  assert.match(pricing, new RegExp(`free ${pro.trialDays}-day Pro trial`));
  for (const tool of pro.includes) {
    assert.match(pricing, new RegExp(`<strong>${tool}:</strong>`, 'i'), tool);
  }
  assert.match(pricing, /KerfDesk Pro is not on sale yet/);
  assert.match(pricing, /Merchant of Record/);
  assert.doesNotMatch(pricing, /href="[^"]*(?:buy\.html|checkout|_ptxn)/i);
});

test('the privacy page is the checked notice, with its PAIA manual link', () => {
  const privacy = pages.get('public/privacy/index.html');
  assert.match(privacy, /<h1>KerfDesk Privacy Notice<\/h1>/);
  assert.match(privacy, /MachineGuid/);
  assert.match(privacy, /href="https:\/\/kerfdesk\.com\/paia-manual\/"/);
  assert.match(pages.get('public/paia-manual/index.html'), /section 51 of the Promotion/);
});

// ADR-543: all rights reserved, except the versions released under the MIT
// License up to the mit-final tag, which keep it.
test('the licence page names the owner and keeps the MIT versions under their licence', () => {
  const licence = pages.get('public/license/index.html');
  assert.match(
    licence,
    /© 2026 Johannes\s+Stephanus\s+Stolk\.\s+All\s+rights\s+reserved,\s+except/,
  );
  assert.match(
    licence,
    /tagged\s+“mit-final”[\s\S]*?were\s+released\s+under\s+the\s+MIT\s+License/,
  );
});

test('each page is built from its own document', () => {
  for (const page of POLICY_PAGES) {
    assert.equal(page.sources.length, 1, page.path);
    assert.match(page.sources[0], /^docs\/(?:legal\/kerfdesk-[a-z-]+|site\/[a-z-]+|safety)\.md$/);
  }
});

// Every page the terms and the pricing page link on kerfdesk.com is built here,
// so none of those links answers 404.
test('every kerfdesk.com page a document links is built, or already ships with the app', () => {
  const built = new Set(POLICY_PAGES.map((page) => page.path));
  const shipped = new Set([
    '/',
    '/support.html',
    '/download.html',
    '/buy.html',
    '/third-party-notices.txt',
  ]);
  for (const [file, content] of pages) {
    for (const [, href] of content.matchAll(/href="https:\/\/kerfdesk\.com(\/[^"#]*)/g)) {
      assert.ok(built.has(href) || shipped.has(href), `${file} links ${href}`);
    }
  }
});

test('the safety page keeps the hazards and never waives liability for injury', () => {
  const safety = pages.get('public/safety/index.html');
  for (const hazard of [
    /emergency stop/i,
    /unattended/i,
    /PVC/,
    /wavelength/i,
    /Clamp the workpiece/,
  ]) {
    assert.match(safety, hazard);
  }
  assert.doesNotMatch(safety, /own risk|not liable for any/i);
});
