// Copy guard rails. These catch the overclaims that ordinary marketing copy
// drifts into; the full rationale is in ADR-524 and website/README.md.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { site } from '../site.config.mjs';
import { attrValues, buildToTemp, builtPages, textContent } from './helpers.mjs';

const { outDir } = buildToTemp();
const built = builtPages(outDir);
const pages = built.map(({ file, html }) => ({
  file,
  text: textContent(html.replace(/<head>[\s\S]*?<\/head>/, '')),
}));

function sentences(text) {
  return text.split(/(?<=[.!?])\s+/);
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

  it('keeps hype and forever-promises out', () => {
    const banned =
      /\b(revolutionary|best-in-class|blazing|cutting-edge|seamless(ly)?|bulletproof|guaranteed|free forever|always free|trusted by)\b/i;
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

  // Maintainer direction 2026-09-23: KerfDesk is free to use today and paid
  // licenses are planned. Only the License page names the license of the
  // released versions (one factual sentence) and the licenses of bundled
  // third-party parts. Raw HTML is scanned so titles, meta descriptions and
  // alt text count too; whitespace is folded because copy wraps across lines.
  it('does not market KerfDesk as open source', () => {
    for (const { file, html } of built) {
      const flat = html.replace(/\s+/g, ' ');
      assert.doesNotMatch(flat, /open[- ]source|free software|source code/i, file);
      if (file !== 'license/index.html') assert.doesNotMatch(flat, /\bMIT\b/, file);
      const repoLinks = attrValues(html, 'a', 'href').filter(
        (href) => href.replace(/\/$/, '') === site.repoUrl,
      );
      assert.deepEqual(repoLinks, [], `${file} links the source repository as a selling point`);
    }
    const license = pages.find(({ file }) => file === 'license/index.html');
    assert.ok(license, 'license/index.html is built');
    assert.match(license.text, /released so far are published under the MIT License/);
  });

  it('carries the safety line in every page footer', () => {
    for (const { file, text } of pages) {
      assert.match(text, /The in-app Abort is a software stop, not an emergency stop\./, file);
    }
  });
});
