import { escapeText } from '../../scripts/site-pages-markdown.mjs';
import { paymentLegalDraftPages } from '../pages/payment-legal-drafts.mjs';

export const LEGAL_DRAFT_STYLES = `
* { box-sizing: border-box; }
body { margin: 0; color: #15202b; background: #f8fafc; font: 16px system-ui, sans-serif; }
header, main, footer { max-width: 55rem; margin: auto; padding: 1.25rem; }
nav { display: flex; flex-wrap: wrap; gap: 0.75rem; }
a { color: #145aa0; overflow-wrap: anywhere; }
p, li { line-height: 1.65; }
h1 { font-size: clamp(1.75rem, 5vw, 2.5rem); }
h2 { margin-top: 2rem; }
.draft-status { border-left: 5px solid #9a4c00; background: #fff0ce; padding: 1rem; }
.note { padding: 0.5rem 1rem; background: #eaf1fc; }
mark.blank { color: #633300; background: #fff0b5; padding: 0 0.2rem; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; vertical-align: top; padding: 0.6rem; border: 1px solid #cbd5e1; }
footer { border-top: 1px solid #cbd5e1; }
`;

export function legalDraftPage({ title, body, index = false }) {
  const prefix = index ? './' : '../';
  const menu = paymentLegalDraftPages
    .map(
      (page) => `<a href="${prefix}${page.path.slice(1)}index.html">${escapeText(page.title)}</a>`,
    )
    .join(' ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
<title>Draft: ${escapeText(title)} | KerfDesk</title>
<link rel="stylesheet" href="${prefix}site-pages.css" /></head>
<body><header><nav aria-label="Local draft pages">${menu}</nav></header>
<main><aside class="draft-status" data-policy-state="draft"><strong>Draft for review. Not published or in force.</strong>
No publication date. Paid checkout stays closed. An authorised public physical/service address and public telephone arrangement remain unresolved. Email is the primary support route; it does not establish disclosure compliance.</aside>
${body}</main><footer>Johannes Stephanus Stolk, sole proprietor trading as KerfDesk.
Primary support: <a href="mailto:support@kerfdesk.com">support@kerfdesk.com</a>.</footer></body></html>
`;
}
