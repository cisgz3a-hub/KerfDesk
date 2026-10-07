// Copy guard rails. These catch the overclaims that ordinary marketing copy
// drifts into; the full rationale is in ADR-524, its Amendment 1 and
// website/README.md.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { site } from '../site.config.mjs';
import { attrValues, buildToTemp, builtPages, textContent, walk } from './helpers.mjs';

const { outDir } = buildToTemp();
const built = builtPages(outDir);
const pages = built.map(({ file, html }) => ({
  file,
  text: textContent(html.replace(/<head>[\s\S]*?<\/head>/, '')),
}));

function sentences(text) {
  return text.split(/(?<=[.!?])\s+/);
}

function pageText(file) {
  const found = pages.find((entry) => entry.file === file);
  assert.ok(found, `${file} is built`);
  return found.text;
}

describe('website copy', () => {
  it('never claims a machine is verified, qualified or certified (ADR-322)', () => {
    const overclaim =
      /\b(hardware[- ]verified|verified on (real )?hardware|officially supported|certified|qualified on|proven on)\b/i;
    for (const { file, text } of pages) {
      for (const sentence of sentences(text)) {
        if (!overclaim.test(sentence)) continue;
        assert.match(
          sentence,
          /\b(not|no|never|none|without)\b|n['’]t\b/i,
          `${file}: "${sentence}"`,
        );
      }
    }
  });

  // Slogans stay out. The settled license terms (Free has no time limit;
  // versions released during a covered year keep working forever) are stated
  // plainly where the offer is described, never as a slogan.
  it('keeps hype and forever slogans out', () => {
    const banned =
      /\b(revolutionary|best-in-class|blazing|cutting-edge|seamless(ly)?|bulletproof|guaranteed|free forever|forever free|always free|trusted by)\b/i;
    for (const { file, text } of pages) {
      assert.doesNotMatch(text, banned, file);
    }
  });

  it('names no competitor except as factual file-format support or a trademark notice', () => {
    const competitor = /\b(LightBurn|Easel|LaserGRBL|MillMage|VCarve|Carbide Create)\b/;
    for (const { file, text } of pages) {
      for (const sentence of sentences(text)) {
        if (!competitor.test(sentence)) continue;
        assert.match(
          sentence,
          /(\.lbrn2?|\.clb|\.lbdev|file|librar|project|trademark|owners|affiliated)/i,
          `${file}: "${sentence}"`,
        );
        assert.doesNotMatch(sentence, /\b(better|faster|replac|alternative|like|-style)\b/i, file);
      }
    }
  });

  it('pairs every mention of Abort with the software-stop warning', () => {
    for (const { file, text } of pages) {
      if (!/\bAbort\b/.test(text)) continue;
      assert.match(
        text,
        /software stop|not an emergency stop|not a safety-rated|not an E-stop/i,
        `${file} mentions Abort without saying it is a software stop`,
      );
    }
  });

  // KerfDesk is not presented as open source. Only the License page names the
  // license of the released versions (one factual sentence) and the licenses
  // of bundled third-party parts. Raw HTML is scanned so titles, meta
  // descriptions and alt text count too; whitespace is folded because copy
  // wraps across lines.
  it('does not market KerfDesk as open source', () => {
    for (const { file, html } of built) {
      const flat = html.replace(/\s+/g, ' ');
      assert.doesNotMatch(flat, /open[- ]source|free software|source code/i, file);
      if (file !== 'license/index.html') assert.doesNotMatch(flat, /\bMIT\b/, file);
    }
    // ADR-543: all rights reserved after the mit-final cutoff.
    const license = pageText('license/index.html');
    assert.match(license, /© 2026 Johann Stolk\. All rights reserved/);
    assert.match(
      license,
      /up to and including the one tagged “mit-final” in KerfDesk’s source history were published under the MIT License/,
    );
    assert.match(license, /Later versions are all rights reserved/);
  });

  // Keep source-repository routes out of customer pages (ADR-524 Amendment 1).
  // Product downloads/support use first-party destinations; policies may link
  // only to Paddle's exact legal/support pages. Scan every generated text file.
  it('keeps repository routes out of customer pages and permits exact Paddle policy/support links', () => {
    const paddlePolicies = [
      'https://www.paddle.com/legal/buyer-terms',
      'https://www.paddle.com/legal/refund-policy',
      'https://www.paddle.com/legal/privacy',
    ];
    const external = new Map([
      ['privacy/index.html', new Set([paddlePolicies[2]])],
      ['terms/index.html', new Set([...paddlePolicies, 'https://paddle.net/'])],
      [
        'refunds/index.html',
        new Set([paddlePolicies[0], paddlePolicies[1], 'https://paddle.net/']),
      ],
    ]);
    for (const path of walk(outDir)) {
      if (!/(\.html|\.txt|\.xml|\.css|_headers)$/.test(path)) continue;
      assert.doesNotMatch(readFileSync(path, 'utf8'), /github/i, path);
    }
    for (const { file, html } of built) {
      for (const href of attrValues(html, 'a', 'href')) {
        if (!/^https?:/.test(href)) continue;
        const url = new URL(href);
        if (url.hostname === 'kerfdesk.com') continue;
        assert.equal(url.protocol, 'https:', 'External policies must use HTTPS');
        assert.ok(external.get(file)?.has(url.href), file + ': unexpected external link ' + href);
      }
    }
  });

  it('sends desktop downloads to the download page and help to the support page', () => {
    const download = built.find(({ file }) => file === 'download/index.html');
    assert.ok(attrValues(download.html, 'a', 'href').includes(site.downloadPageUrl));
    assert.match(pageText('download/index.html'), /served from dl\.kerfdesk\.com/);
    for (const { file, html } of built) {
      assert.ok(attrValues(html, 'a', 'href').includes(site.supportUrl), `${file} footer`);
    }
  });

  it('makes phone setup discoverable and keeps pairing on the shipped app page', () => {
    const phone = built.find(({ file }) => file === 'phone/index.html');
    assert.ok(phone, 'phone guide is built');
    assert.ok(attrValues(phone.html, 'a', 'href').includes(site.phoneSetupUrl));
    assert.match(pageText('phone/index.html'), /Every connection needs your approval on the PC/);
    assert.match(pageText('phone/index.html'), /copy the code exactly including capital letters/);
    assert.match(pageText('phone/index.html'), /Choose machine control separately/);
    assert.match(
      pageText('phone/index.html'),
      /existing viewing\/editing approvals gain no motion access/,
    );
    for (const { file, html } of built) {
      assert.ok(attrValues(html, 'a', 'href').includes('/phone/'), `${file} phone navigation`);
      assert.doesNotMatch(html, /<iframe\b/i, `${file} never embeds a remote session`);
    }
  });

  // support@kerfdesk.com is live (29 September 2026); no page names any other address.
  it('writes no email address but the support address', () => {
    assert.equal(site.supportEmail, 'support@kerfdesk.com');
    for (const { file, html } of built) {
      for (const href of attrValues(html, 'a', 'href').filter((value) => /^mailto:/i.test(value)))
        assert.equal(href, `mailto:${site.supportEmail}`, file);
      for (const address of textContent(html).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])
        assert.equal(address, site.supportEmail, file);
    }
    assert.match(
      pageText('about/index.html'),
      /Email bug reports and security reports to support@kerfdesk\.com/,
    );
  });

  // Owner direction 2026-09-29: the Free and Pro editions and the Pro price are
  // settled. No page may still call them planned or undecided.
  it('presents the Free and Pro offer as settled, never as planned', () => {
    const stale =
      /paid licen[cs]es? (are|is) planned|free to use today|prices?, terms and timing|nothing is for sale today|no trial timer|every (laser and CNC )?feature, (with no|at no)/i;
    for (const { file, text } of pages) assert.doesNotMatch(text, stale, file);
    const pricing = pageText('pricing/index.html');
    assert.match(pricing, /Free has no time limit/);
    assert.match(
      pricing,
      /Pro adds advanced tools to the Windows desktop app for US\$49\.50, paid once\./,
    );
  });

  // Published Supplier Terms and the refund promise are accessible before any
  // purchase, without opening checkout or replacing a supplied app notice.
  it('publishes unchanged purchase rights and the refund promise for the authorised launch', () => {
    const refunds = pageText('refunds/index.html');
    const terms = pageText('terms/index.html');
    assert.doesNotMatch(refunds, /Paid checkout is closed|nothing can be bought today/);
    assert.match(refunds, /Version 1\.1\. Published: 7 October 2026/);
    assert.match(refunds, /We promise a full refund if you request it within 14 calendar days/);
    assert.match(refunds, /after activating and using Pro/);
    assert.match(terms, /purchase provisions apply when you buy/);
    assert.match(terms, /computer, phone or tablet/);
    assert.match(terms, /Check payment/);
    assert.doesNotMatch(terms, /Paid checkout.*closed|New trials are not open today/);
    assert.match(terms, /(?:do|does) not replace an installed notice/);
    for (const { file, html } of built) {
      const links = attrValues(html, 'a', 'href');
      for (const policy of ['/terms/', '/refunds/', '/privacy/'])
        assert.ok(links.includes(policy), file + ': missing policy navigation ' + policy);
    }
    for (const { file, text } of pages) {
      if (['refunds/index.html', 'terms/index.html'].includes(file)) continue;
      assert.doesNotMatch(text, /money[- ]back|refund (window|period)|\d+[- ]day refund/i, file);
    }
  });
  it('tells visitors exactly what licensing and payment involve (privacy)', () => {
    const privacy = pageText('privacy/index.html');
    assert.match(privacy, new RegExp(`at ${site.licensingHost.replace(/\./g, '\\.')}`));
    assert.match(
      privacy,
      /installation digest: a one-way hash of your operating system’s installation ID/,
    );
    assert.match(privacy, /a generic device label/);
    assert.match(privacy, /your license key or credential/);
    assert.match(privacy, /the order details/);
    assert.match(
      privacy,
      /never uploads your projects, drawings, toolpaths, or machine or job data/,
    );
    assert.match(privacy, /Licensing adds no analytics, cookies or tracking/);
    assert.match(privacy, /Paddle, the payment provider, as merchant of record/);
    assert.match(privacy, /under its own privacy notice/);
  });

  it('carries the safety line in every page footer', () => {
    for (const { file, text } of pages) {
      assert.match(text, /The in-app Abort is a software stop, not an emergency stop\./, file);
    }
  });
});
