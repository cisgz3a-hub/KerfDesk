// Builds the pricing and legal pages that ship with the web app on kerfdesk.com
// (ADR-524 Amendment 3) from the customer documents in docs/legal/, which the
// sourced legal review of 29 September 2026 checked (ADR-247 Amendment 2), and
// the machines and safety pages those documents link. The pages are committed,
// so a review shows the exact published text, and generate-site-pages.test.mjs
// fails when one is out of date.
//
//   node scripts/generate-site-pages.mjs          writes public/<page>/index.html
//   node scripts/generate-site-pages.mjs --check  lists out-of-date pages, exits 1

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';

import { sitePage } from './site-pages-layout.mjs';
import { blocksHtml, inlineHtml, readDocument } from './site-pages-markdown.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The first document is the page; any others follow it as sections.
export const POLICY_PAGES = [
  {
    path: '/pricing/',
    title: 'Pricing',
    description:
      'KerfDesk Free and Pro: what each edition includes, what Pro will cost, and how a Pro licence, the trial and refunds work.',
    sources: ['docs/legal/kerfdesk-pricing.md'],
  },
  {
    path: '/terms/',
    title: 'Terms of Service',
    description:
      'The KerfDesk Terms of Service and Licence Agreement: the terms for the website, KerfDesk Free, the Pro trial and Pro licences.',
    sources: ['docs/legal/kerfdesk-licence-agreement.md'],
  },
  {
    path: '/privacy/',
    title: 'Privacy Notice',
    description:
      'What personal information KerfDesk, its website and its licensing service collect, why, who handles it, how long it is kept, and your rights.',
    sources: ['docs/legal/kerfdesk-privacy-notice.md'],
  },
  {
    path: '/refunds/',
    title: 'Refund Policy',
    description: 'How refunds work for KerfDesk Pro licences and update extensions.',
    sources: ['docs/legal/kerfdesk-refund-policy.md'],
  },
  {
    path: '/paia-manual/',
    title: 'PAIA Manual',
    description:
      "KerfDesk's manual under section 51 of South Africa's Promotion of Access to Information Act: the records it holds and how to ask for them.",
    sources: ['docs/legal/kerfdesk-paia-manual.md'],
  },
  {
    path: '/license/',
    title: 'Licence and notices',
    description:
      'Which terms apply to which KerfDesk versions, the third-party components it includes, and its name.',
    sources: ['docs/legal/kerfdesk-licence-and-notices.md'],
  },
  {
    path: '/machines/',
    title: 'Machines',
    description:
      'The controllers and machines KerfDesk supports, and how far each has been tested.',
    sources: ['docs/site/machines.md'],
  },
  {
    path: '/safety/',
    title: 'Safety',
    description:
      'Laser and CNC safety: what KerfDesk cannot do for you, and what to check before every job.',
    sources: ['docs/safety.md'],
  },
];

async function policyPage({ sources, ...page }) {
  const [first, ...sections] = await Promise.all(
    sources.map(async (source) =>
      readDocument(await readFile(path.join(REPO_ROOT, source), 'utf8')),
    ),
  );
  const ids = new Set();
  const parts = [`<h1>${inlineHtml(first.title)}</h1>`, blocksHtml(first.blocks, { ids })];
  for (const section of sections) {
    const heading = { type: 'heading', level: 1, text: section.title };
    parts.push(blocksHtml([heading, ...section.blocks], { shift: 1, ids }));
  }
  return { ...page, body: parts.join('\n'), sources };
}

function outputFile(pagePath) {
  return path.posix.join('public', pagePath, 'index.html');
}

// Formatted as `prettier --check .` expects, so the committed pages pass it.
async function formatted(html, file) {
  const options = (await prettier.resolveConfig(path.join(REPO_ROOT, file))) ?? {};
  return prettier.format(html, { ...options, filepath: file });
}

// Map of repository-relative output file to its content.
export async function buildSitePages() {
  const pages = await Promise.all(POLICY_PAGES.map(policyPage));
  const built = new Map();
  for (const page of pages) {
    const file = outputFile(page.path);
    built.set(file, await formatted(sitePage(page), file));
  }
  return built;
}

async function main(args) {
  const check = args.includes('--check');
  const stale = [];
  for (const [file, content] of await buildSitePages()) {
    const target = path.join(REPO_ROOT, file);
    if (check) {
      const current = await readFile(target, 'utf8').catch(() => null);
      if (current !== content) stale.push(file);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    console.log(`Wrote ${file}`);
  }
  if (stale.length > 0) {
    console.error(`Out of date: ${stale.join(', ')}. Run pnpm generate:site-pages.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
