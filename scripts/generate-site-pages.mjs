// Default: full review drafts in ignored output. --public-info prepares the
// finished closed-sales pages for a local build, without deployment or app gates.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { legalPublication } from '../website/legal-publication.config.mjs';
import { commerce } from '../website/commerce.config.mjs';
import { site } from '../website/site.config.mjs';
import { renderAppPrivacyDocument } from '../website/lib/layout.mjs';
import { paymentInformationPages } from '../website/pages/payment-information.mjs';
import { appPrivacyFiles } from './generate-privacy-page.mjs';
import { paymentLegalDraftPages } from '../website/pages/payment-legal-drafts.mjs';
import { LEGAL_DRAFT_STYLES, legalDraftPage } from '../website/lib/legal-draft-layout.mjs';
import { blocksHtml, escapeText, readDocument } from './site-pages-markdown.mjs';
import { format } from 'prettier';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DRAFT_DIRECTORY = 'output/payment-legal-draft';

function localPolicyLinks(html) {
  return html.replace(
    /href="https:\/\/kerfdesk[.]com(\/[^"#]*)(#[^"]*)?"/g,
    (match, url, anchor = '') => {
      const page = paymentLegalDraftPages.find((candidate) => candidate.path === url);
      return page ? `href="..${page.path}index.html${anchor}"` : match;
    },
  );
}

export async function buildSitePages(root = REPO_ROOT) {
  if (legalPublication.status !== 'draft' || legalPublication.publicationDate !== null) {
    throw new Error(
      'This renderer is for undated local drafts only; review any publication separately.',
    );
  }
  const files = new Map([['site-pages.css', LEGAL_DRAFT_STYLES]]);
  for (const page of paymentLegalDraftPages) {
    const source = await readFile(path.join(root, page.source), 'utf8');
    const document = readDocument(source);
    const body = `<h1>${escapeText(document.title)}</h1>
${localPolicyLinks(blocksHtml(document.blocks))}`;
    files.set(`${page.path.slice(1)}index.html`, legalDraftPage({ title: page.title, body }));
  }
  files.set(
    'index.html',
    legalDraftPage({
      title: 'Payment and legal review',
      index: true,
      body: '<h1>Payment and legal publication drafts</h1><p>Use the navigation to review five source-grounded drafts. Unresolved details are marked. These files do not replace the live website or current app notices.</p>',
    }),
  );
  return files;
}

export async function renderDrafts({ check = false, root = REPO_ROOT } = {}) {
  const directory = path.join(root, DRAFT_DIRECTORY);
  const stale = [];
  for (const [relative, content] of await buildSitePages(root)) {
    const target = path.join(directory, relative);
    if (check) {
      if ((await readFile(target, 'utf8').catch(() => null)) !== content) stale.push(relative);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
  if (stale.length)
    throw new Error(`Draft output is stale: ${stale.join(', ')}. Rerun the local renderer.`);
  return directory;
}

export function closedInformationErrors({ store = commerce, workerText } = {}) {
  const errors = [];
  if (store.salesOpen !== false || store.trialOpen !== false)
    errors.push(
      'Closed-sales information requires website sales and trial flags to remain closed.',
    );
  if (!/"PAYMENTS_ENABLED"\s*:\s*"false"/.test(workerText ?? ''))
    errors.push('Closed-sales information requires checked-in Worker payments to remain disabled.');
  return errors;
}

// Prepare truthful public information independently of the undated commercial
// drafts. The existing privacy renderer remains the single source for privacy.
export async function buildPublicInformationFiles({ root = REPO_ROOT, store = commerce } = {}) {
  const workerText = await readFile(
    path.join(root, 'services/desktop-licensing/wrangler.jsonc'),
    'utf8',
  );
  const errors = closedInformationErrors({ store, workerText });
  if (errors.length) throw new Error(errors.join('\n'));
  const privacy = await appPrivacyFiles();
  const files = new Map(
    [...privacy].map(([name, value]) => ['privacy/' + name.replaceAll(path.sep, '/'), value]),
  );
  const assets = new Map(
    [...privacy.keys()]
      .filter((name) => name.startsWith('assets' + path.sep))
      .map((name) => {
        const plain = path.basename(name).replace(/\.[a-f0-9]{10}(?=\.[^.]+$)/, '');
        return [plain, '/privacy/' + name.replaceAll(path.sep, '/')];
      }),
  );
  const ctx = {
    site,
    commerce: store,
    siteUrl: site.appUrl,
    appPrivacy: true,
    asset: (name) => {
      if (!assets.has(name)) throw new Error('Unknown privacy asset: ' + name);
      return assets.get(name);
    },
    contentSecurityPolicy:
      "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  };
  for (const page of paymentInformationPages) {
    const html = renderAppPrivacyDocument(page, page.render(ctx), ctx);
    if (/\[PLACEHOLDER|data-policy-state="draft"|not published or in force/i.test(html))
      throw new Error('Unfinished legal content cannot enter public information: ' + page.path);
    const options = JSON.parse(await readFile(path.join(REPO_ROOT, '.prettierrc'), 'utf8'));
    files.set(
      page.path.slice(1) + 'index.html',
      Buffer.from(await format(html, { ...options, parser: 'html' })),
    );
  }
  return files;
}

export async function renderPublicInformation({
  check = false,
  root = REPO_ROOT,
  directory = path.join(root, 'public'),
} = {}) {
  const destination = path.resolve(directory);
  const workspace = path.resolve(root);
  if (!destination.startsWith(workspace + path.sep))
    throw new Error('Information output must remain inside its workspace.');
  const stale = [];
  for (const [relative, bytes] of await buildPublicInformationFiles({ root })) {
    const target = path.join(destination, relative);
    if (check) {
      const existing = await readFile(target).catch(() => null);
      if (!existing || !bytes.equals(existing)) stale.push(relative);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  if (stale.length) throw new Error('Public information output is stale: ' + stale.join(', '));
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const allowed = args.filter(
    (_, index) => outIndex === -1 || (index !== outIndex && index !== outIndex + 1),
  );
  if (
    allowed.some((arg) => !['--check', '--public-info'].includes(arg)) ||
    (outIndex !== -1 && (!args.includes('--public-info') || !args[outIndex + 1]))
  )
    throw new Error(
      'Usage: node scripts/generate-site-pages.mjs [--check] [--public-info [--out <workspace directory>]]',
    );
  if (args.includes('--public-info')) {
    const directory = outIndex === -1 ? undefined : path.resolve(REPO_ROOT, args[outIndex + 1]);
    console.log(
      'Prepared closed-sales information: ' +
        (await renderPublicInformation({ check: args.includes('--check'), directory })),
    );
  } else {
    console.log('Local draft output: ' + (await renderDrafts({ check: args.includes('--check') })));
  }
}
