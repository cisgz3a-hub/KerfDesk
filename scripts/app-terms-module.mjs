// Builds src/ui/legal/terms-text.generated.ts from the terms in
// docs/legal/kerfdesk-licence-agreement.md: the version and publication date the
// terms state at their top, and their machine-safety section, which the app
// shows in full when it asks for agreement on first use (ADR-564). The module is
// committed, and generate-site-pages.mjs writes and checks it with the pages.

import { markdownBlocks } from './site-pages-markdown.mjs';

export const TERMS_SOURCE = 'docs/legal/kerfdesk-licence-agreement.md';
export const APP_TERMS_MODULE = 'src/ui/legal/terms-text.generated.ts';

const SAFETY_SECTION_NUMBER = '2';

// "Version 1.0. Last updated: 12 October 2026", with the date a blank until the
// owner publishes the terms.
export function termsEdition(source) {
  const match = /^Version (\d+\.\d+)\. Last updated: (.+)$/m.exec(source);
  if (match === null) throw new Error(`${TERMS_SOURCE} must state "Version N.N. Last updated: …"`);
  const lastUpdated = match[2].trim();
  return {
    version: match[1],
    lastUpdated: /\[PLACEHOLDER\b/.test(lastUpdated) ? null : lastUpdated,
  };
}

// Plain text, **bold** and bare https links: all the safety section uses. Other
// markup fails here, so the app never shows a raw marker.
export function termsText(text) {
  if (/\[PLACEHOLDER\b|\]\(|(?:^|[^*])\*(?!\*)/.test(text)) {
    throw new Error(`The app shows only plain text, bold and bare links: ${text}`);
  }
  return text
    .split(/(\*\*.+?\*\*)/)
    .filter((part) => part !== '')
    .flatMap((part) => {
      if (part.startsWith('**')) {
        const strong = part.slice(2, -2);
        if (strong.includes('https://')) throw new Error(`A link inside bold text: ${text}`);
        return [{ strong }];
      }
      return part
        .split(/(https:\/\/[^\s]*[^\s.,;:)])/)
        .filter((piece) => piece !== '')
        .map((piece) => (piece.startsWith('https://') ? { link: piece } : piece));
    });
}

function appBlock(block) {
  if (block.type === 'paragraph') {
    return { kind: 'paragraph', text: termsText(block.lines.join(' ')) };
  }
  if (block.type === 'list' && block.items.every((item) => item.children.length === 0)) {
    return { kind: 'list', items: block.items.map((item) => termsText(item.text)) };
  }
  throw new Error(
    `The safety section may hold only paragraphs and simple lists, not a ${block.type}`,
  );
}

export function termsSafetySection(source) {
  const blocks = markdownBlocks(source);
  const start = blocks.findIndex(
    (block) =>
      block.type === 'heading' &&
      block.level === 2 &&
      block.text.startsWith(`${SAFETY_SECTION_NUMBER}. `),
  );
  if (start === -1) throw new Error(`${TERMS_SOURCE} has no section ${SAFETY_SECTION_NUMBER}`);
  const end = blocks.findIndex(
    (block, index) => index > start && block.type === 'heading' && block.level <= 2,
  );
  const body = blocks.slice(start + 1, end === -1 ? undefined : end);
  return { heading: blocks[start].text, blocks: body.map(appBlock) };
}

export function appTermsModule(source) {
  const edition = termsEdition(source);
  const safety = termsSafetySection(source);
  return `// Generated from ${TERMS_SOURCE} by scripts/generate-site-pages.mjs.
// Do not edit: change the terms, then run pnpm generate:site-pages (ADR-564).

export type TermsText = string | { readonly strong: string } | { readonly link: string };

export type TermsBlock =
  | { readonly kind: 'paragraph'; readonly text: ReadonlyArray<TermsText> }
  | { readonly kind: 'list'; readonly items: ReadonlyArray<ReadonlyArray<TermsText>> };

/** The version the terms state at their top. */
export const TERMS_VERSION = ${JSON.stringify(edition.version)};

/** The terms' publication date as they state it, or null while it is a blank. */
export const TERMS_LAST_UPDATED: string | null = ${JSON.stringify(edition.lastUpdated)};

/** Section 2, the machine-safety section, which first use shows in full. */
export const TERMS_SAFETY_HEADING = ${JSON.stringify(safety.heading)};

export const TERMS_SAFETY_SECTION: ReadonlyArray<TermsBlock> = ${JSON.stringify(safety.blocks)};
`;
}
