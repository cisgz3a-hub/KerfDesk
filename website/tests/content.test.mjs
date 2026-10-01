// Copy guard rails. These catch the overclaims that ordinary marketing copy
// drifts into; the full rationale is in ADR-524, its Amendment 1 and
// website/README.md.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  // KerfDesk is not presented as open source. Only the licence and notices
  // page, which the app publishes, names the licence of the released versions
  // and of bundled third-party parts. Raw HTML is scanned so titles, meta
  // descriptions and alt text count too; whitespace is folded because copy
  // wraps across lines.
  it('does not market KerfDesk as open source', () => {
    for (const { file, html } of built) {
      const flat = html.replace(/\s+/g, ' ');
      assert.doesNotMatch(flat, /open[- ]source|free software|source code/i, file);
      assert.doesNotMatch(flat, /\bMIT\b/, file);
    }
  });

  // The source repository is private (ADR-524 Amendment 1), so no download,
  // release, issue, discussion, source or bug-report link may send a visitor to
  // GitHub. Every text file the build writes is scanned, not just the pages.
  it('sends no visitor to GitHub, and links leave only for kerfdesk.com', () => {
    for (const path of walk(outDir)) {
      if (!/(\.html|\.txt|\.xml|\.css|_headers)$/.test(path)) continue;
      assert.doesNotMatch(readFileSync(path, 'utf8'), /github/i, path);
    }
    for (const { file, html } of built) {
      for (const href of attrValues(html, 'a', 'href')) {
        if (!/^https?:/.test(href)) continue;
        assert.equal(new URL(href).hostname, 'kerfdesk.com', `${file} links to ${href}`);
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
    const home = pageText('index.html');
    assert.match(home, /KerfDesk Free has no time limit/);
    assert.match(
      home,
      /Pro adds advanced tools to the Windows desktop app for US\$49\.50 plus tax, paid once,/,
    );
  });

  // Paddle, the reseller, adds the tax where the buyer lives.
  it('shows every price as before tax', () => {
    for (const { file, text } of pages) {
      for (const [, after] of text.matchAll(/US\$\d+(?:\.\d+)?(.{0,9})/g))
        assert.match(after, /^ plus tax/, `${file}: a price without "plus tax"`);
    }
  });

  // Refund terms are in the Refund Policy, a checked legal text the app
  // publishes. The site links it and writes none of its own.
  it('writes no refund terms of its own', () => {
    for (const { file, text } of pages) {
      assert.doesNotMatch(text, /money[- ]back|refund (window|period)|\d+[- ]day refund/i, file);
    }
  });

  // The pricing and legal pages are checked texts that the app publishes from
  // docs/legal (ADR-247 Amendment 2). The site links them and builds no copy,
  // so it can never show an old or different version.
  it('links the checked pricing and legal pages from every page and keeps no copy', () => {
    const legal = [
      site.pricingUrl,
      site.termsUrl,
      site.privacyUrl,
      site.refundsUrl,
      site.paiaManualUrl,
      site.licenseUrl,
    ];
    for (const url of legal) assert.equal(new URL(url).origin, site.appUrl, url);
    for (const { file, html } of built) {
      const hrefs = attrValues(html, 'a', 'href');
      for (const url of legal) assert.ok(hrefs.includes(url), `${file} does not link ${url}`);
      assert.match(textContent(html), /Made and licensed by Johannes Stephanus Stolk/, file);
    }
    for (const path of ['pricing', 'terms', 'privacy', 'refunds', 'paia-manual', 'license'])
      assert.ok(!existsSync(join(outDir, path)), `the site builds its own /${path}/`);
  });

  it('carries the safety line in every page footer', () => {
    for (const { file, text } of pages) {
      assert.match(text, /The in-app Abort is a software stop, not an emergency stop\./, file);
    }
  });
});
