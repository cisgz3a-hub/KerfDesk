// Separate local-review registry. Deliberately absent from pages/index.mjs so
// website:build cannot publish unfinished legal drafts or replace current privacy.
export const paymentLegalDraftPages = Object.freeze([
  { path: '/pricing/', title: 'Pricing', source: 'docs/legal/kerfdesk-pricing.md' },
  { path: '/terms/', title: 'Terms', source: 'docs/legal/kerfdesk-licence-agreement.md' },
  { path: '/privacy/', title: 'Privacy', source: 'docs/legal/kerfdesk-privacy-notice.md' },
  { path: '/refunds/', title: 'Refunds', source: 'docs/legal/kerfdesk-refund-policy.md' },
  { path: '/paia-manual/', title: 'PAIA Manual', source: 'docs/legal/kerfdesk-paia-manual.md' },
]);
