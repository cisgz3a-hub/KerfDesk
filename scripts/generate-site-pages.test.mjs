import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { attrValues } from '../website/tests/helpers.mjs';
import { legalPublication } from '../website/legal-publication.config.mjs';
import { paymentLegalDraftPages } from '../website/pages/payment-legal-drafts.mjs';
import {
  draftErrors,
  publicationBlockers,
  publicationReviewQuestions,
} from './check-legal-publication.mjs';
import { publicPolicySourceErrors } from '../website/pages/payment-information.mjs';
import {
  buildSitePages,
  buildPublicInformationFiles,
  closedInformationErrors,
  renderPublicInformation,
  DRAFT_DIRECTORY,
  REPO_ROOT,
  renderDrafts,
} from './generate-site-pages.mjs';
import { blocksHtml, inlineHtml, readDocument } from './site-pages-markdown.mjs';

// These scripts must not turn a local review into public pages or executable
// markup. Tests exercise escaping, links, stale output and readiness failures.
test('drafts have working local navigation and no executable or network-loaded content', async () => {
  const files = await buildSitePages();
  assert.equal(files.size, 7);
  assert.ok(files.has('index.html'));
  for (const [file, html] of files) {
    assert.ok(!file.startsWith('public/') && !file.startsWith('website/dist/'));
    if (!file.endsWith('.html')) continue;
    assert.match(html, /data-policy-state="draft"/);
    assert.match(html, /Not published or in force/);
    assert.match(html, /script-src 'none'/);
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(html, /<(?:script|form|iframe)\b/i);
    assert.doesNotMatch(html, /(?:src|rel="stylesheet" href)="https?:/i);
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (/^(?:https:|mailto:|#)/.test(href)) continue;
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), href.split('#')[0]),
      );
      assert.ok(files.has(target), `${file}: local link ${href} does not resolve`);
    }
  }
  const indexSource = await readFile(path.join(REPO_ROOT, 'website/pages/index.mjs'), 'utf8');
  const privacyGenerator = await readFile(
    path.join(REPO_ROOT, 'scripts/generate-privacy-page.mjs'),
    'utf8',
  );
  assert.doesNotMatch(indexSource, /payment-legal-drafts/);
  assert.doesNotMatch(privacyGenerator, /legal-publication|kerfdesk-privacy-notice/);
});

test('Markdown escaping keeps untrusted markup inert and section anchors unique', () => {
  const source =
    '# Review\n\n<script>alert("unsafe")</script>\n\n## 8. First\n\n## 8. Second\n\n[Safe](https://example.com/"x) [PLACEHOLDER: <img src=x onerror=alert(1)>]\n';
  const { title, blocks } = readDocument(source);
  assert.equal(title, 'Review');
  const html = blocksHtml(blocks);
  assert.doesNotMatch(html, /<(?:script|img)\b/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.com\/&quot;x"/);
  assert.match(html, /<mark class="blank">\[&lt;img/);
  assert.match(html, /id="section-8"/);
  assert.match(html, /id="section-8-2"/);
  assert.doesNotMatch(inlineHtml('[Click](javascript:alert(1))'), /href=/);
});

test('stale/missing draft output is refused without changing a public file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kerfdesk-legal-draft-'));
  try {
    for (const page of paymentLegalDraftPages) {
      const target = path.join(root, page.source);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(REPO_ROOT, page.source), target);
    }
    await mkdir(path.join(root, 'public'), { recursive: true });
    const sentinel = path.join(root, 'public', 'privacy.html');
    await writeFile(sentinel, 'existing published notice');
    await assert.rejects(renderDrafts({ root, check: true }), /Draft output is stale/);
    const directory = await renderDrafts({ root });
    assert.equal(directory, path.join(root, DRAFT_DIRECTORY));
    await renderDrafts({ root, check: true });
    await writeFile(path.join(directory, 'terms/index.html'), 'outdated draft');
    await assert.rejects(renderDrafts({ root, check: true }), /terms\/index.html/);
    assert.equal(await readFile(sentinel, 'utf8'), 'existing published notice');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('closed draft configuration passes but changed launch flags are refused', () => {
  const closed = { salesOpen: false, trialOpen: false };
  const workerText = '{"PAYMENTS_ENABLED": "false"}';
  assert.deepEqual(draftErrors({ store: closed, workerText }), []);
  assert.ok(draftErrors({ store: { ...closed, salesOpen: true }, workerText }).length);
  assert.ok(draftErrors({ store: { ...closed, trialOpen: true }, workerText }).length);
  assert.ok(draftErrors({ store: closed, workerText: '{"PAYMENTS_ENABLED": "true"}' }).length);
  assert.ok(draftErrors({ store: closed, workerText: '' }).length);
});

test('publication content readiness stays separate from statutory, live-sales and PAIA questions', () => {
  assert.deepEqual(publicationBlockers(), []);
  const incomplete = {
    ...legalPublication,
    seller: { ...legalPublication.seller, legalName: null },
  };
  assert.ok(publicationBlockers(incomplete).some((item) => item.includes('licensor name')));
  const questions = publicationReviewQuestions();
  assert.ok(questions.statutory.some((item) => item.includes('ECTA')));
  assert.ok(questions.statutory.some((item) => item.includes('POPIA')));
  assert.ok(questions.liveSales.some((item) => item.includes('stay closed')));
  assert.ok(questions.paia.some((item) => item.includes('PAIA')));
  assert.equal(legalPublication.seller.publicAddress, null);
  assert.equal(legalPublication.seller.publicTelephone, null);
  assert.equal(legalPublication.seller.vatRegistered, false);
});

test('finished public policy sources reject gaps and undated review content', () => {
  assert.deepEqual(
    publicPolicySourceErrors('# Terms\n\nVersion 1.0. Published: 7 October 2026.'),
    [],
  );
  assert.ok(publicPolicySourceErrors('# Terms\n\n[PLACEHOLDER: date]').length);
  assert.ok(publicPolicySourceErrors('# Terms\n\nDraft for review.').length);
});

test('published closed-sales policies contain confirmed parties and preserve supplied app licences', async () => {
  const files = await buildPublicInformationFiles();
  assert.ok(files.has('pricing/index.html'));
  assert.ok(files.has('refunds/index.html'));
  assert.ok(files.has('privacy/index.html'));
  assert.ok(files.has('terms/index.html') && !files.has('paia-manual/index.html'));
  for (const [name, bytes] of files) {
    if (!name.endsWith('.html')) continue;
    const html = bytes.toString().replace(/\s+/g, ' ');
    assert.match(html, /Johannes Stephanus Stolk/);
    assert.match(html, /support@kerfdesk.com/);
    assert.doesNotMatch(
      html,
      /\[PLACEHOLDER|data-policy-state="draft"|public (?:address|telephone).*unresolved/i,
    );
    assert.doesNotMatch(html, /<(?:script|form|iframe)\b/i);
  }
  assert.match(
    files.get('refunds/index.html').toString().replace(/\s+/g, ' '),
    /We promise a full refund if you request it within 14 calendar days after purchase/,
  );
  assert.match(
    files.get('privacy/index.html').toString().replace(/\s+/g, ' '),
    /Share artwork previews and text/,
  );
  const terms = files.get('terms/index.html').toString().replace(/\s+/g, ' ');
  assert.match(terms, /Version 1\.0\. Published: 7 October 2026/);
  assert.match(terms, /purchase provisions apply if and when you buy/);
  assert.match(terms, /Paddle is the authorised reseller and merchant of record/);
  assert.match(terms, /(?:do|does) not replace an installed notice/);
  assert.match(terms, /a requirement for machine control/);
  assert.doesNotMatch(terms, /terms replace the License|legal.service address unresolved/);
  assert.deepEqual(closedInformationErrors({ workerText: '{"PAYMENTS_ENABLED":"false"}' }), []);
  await assert.rejects(
    buildPublicInformationFiles({ store: { salesOpen: true, trialOpen: false } }),
    /remain closed/,
  );
});

test('public preparation owns Terms, pricing, refunds and existing privacy outputs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kerfdesk-payment-info-'));
  try {
    await mkdir(path.join(root, 'services/desktop-licensing'), { recursive: true });
    await writeFile(
      path.join(root, 'services/desktop-licensing/wrangler.jsonc'),
      '{"PAYMENTS_ENABLED":"false"}',
    );
    const directory = path.join(root, 'public');
    await mkdir(directory, { recursive: true });
    for (const name of ['eula.txt', 'index.html', 'buy.html'])
      await writeFile(path.join(directory, name), 'existing:' + name);
    await renderPublicInformation({ root, directory });
    await renderPublicInformation({ root, directory, check: true });
    for (const name of ['eula.txt', 'index.html', 'buy.html'])
      assert.equal(await readFile(path.join(directory, name), 'utf8'), 'existing:' + name);
    await assert.rejects(
      renderPublicInformation({ root, directory: path.dirname(root) }),
      /inside its workspace/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('public information keeps its document policy, revalidation and hashed-asset cache rules', async () => {
  const files = await buildPublicInformationFiles();
  const headers = await readFile(path.join(REPO_ROOT, 'public/_headers'), 'utf8');
  const rules = new Map();
  let route;
  for (const line of headers.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line.startsWith('/')) {
      route = line;
      assert.ok(!rules.has(route), 'Duplicate response-header route: ' + route);
      rules.set(route, []);
    } else {
      assert.ok(route, 'Response-header value has no route');
      rules.get(route).push(line.trim());
    }
  }
  assert.ok(
    rules.get('/*').some((line) => line.startsWith("Content-Security-Policy: default-src 'self';")),
  );
  for (const page of ['privacy', 'pricing', 'refunds', 'terms']) {
    const html = files.get(page + '/index.html').toString();
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /script-src &#39;none&#39;/);
    for (const route of ['/' + page, '/' + page + '/', '/' + page + '/index.html']) {
      const values = rules.get(route);
      assert.ok(values, 'Missing response-header rule: ' + route);
      assert.ok(
        values.includes('! Content-Security-Policy'),
        route + ': app CSP must yield to document CSP',
      );
      assert.ok(
        values.includes('Cache-Control: no-cache, no-transform'),
        route + ': static notices must revalidate without injected content',
      );
      assert.ok(
        !values.some((line) => line.startsWith('Content-Security-Policy:')),
        route + ': unexpected overriding CSP',
      );
    }
    assert.ok(
      rules
        .get('/' + page + '/assets/*')
        .includes('Cache-Control: public, max-age=31536000, immutable'),
    );
  }
  // All four current documents reuse the existing content-hashed privacy assets.
  const assets = [...files.keys()].filter((name) => name.startsWith('privacy/assets/'));
  assert.ok(assets.length > 0);
  for (const name of assets) {
    assert.match(name, /\.[a-f0-9]{10}\.(?:css|png)$/);
    assert.ok(
      rules.get('/privacy/assets/*').includes('Cache-Control: public, max-age=31536000, immutable'),
    );
  }
});

test('all public information links resolve to app inputs and identify the Free app licence', async () => {
  const files = await buildPublicInformationFiles();
  for (const [name, bytes] of files) {
    if (!name.endsWith('.html')) continue;
    const html = bytes.toString();
    const normalized = html.replace(/\s+/g, ' ');
    assert.match(normalized, /href="\/eula\.txt">Free app licence<\/a>/);
    assert.doesNotMatch(html, /href="\/(?:download|license)\/"|no payment provider is live/i);
    assert.match(normalized, /href="\/terms\/">Software terms<\/a>/);
    for (const [tag, attribute] of [
      ['a', 'href'],
      ['link', 'href'],
      ['img', 'src'],
    ]) {
      for (const value of attrValues(html, tag, attribute)) {
        if (value.startsWith('mailto:')) continue;
        const url = new URL(value, 'https://kerfdesk.com/' + name);
        if (url.origin !== 'https://kerfdesk.com') continue;
        const relative = url.pathname.slice(1);
        const file = relative.endsWith('/') ? relative + 'index.html' : relative || 'index.html';
        const target = files.get(file);
        if (!target) {
          const location = path.join(REPO_ROOT, url.pathname === '/' ? file : 'public/' + file);
          const input = await stat(location).catch(() => null);
          assert.ok(input?.isFile(), name + ': missing app input for ' + value);
        } else if (url.hash && file.endsWith('.html')) {
          const id = decodeURIComponent(url.hash.slice(1));
          assert.ok(
            target.toString().includes('id="' + id + '"'),
            name + ': missing section ' + value,
          );
        }
      }
    }
  }
  assert.match(
    files.get('pricing/index.html').toString().replace(/\s+/g, ' '),
    /Sales and paid checkout remain closed/,
  );
  assert.ok(files.has('privacy/lucide-license.txt'));
  assert.ok((await stat(path.join(REPO_ROOT, 'public/privacy/lucide-license.txt'))).isFile());
});
