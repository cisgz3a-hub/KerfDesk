## ADR-524 Amendment 3 - The pricing and policy pages ship with the web app on kerfdesk.com (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29 | **Amends:** ADR-524 decision 6 and "Alternatives
considered"

### Context

Paddle approves a seller's website before its business check starts. Its reviewer needs
`kerfdesk.com` live on HTTPS with the product described, and pricing, Terms of Service, Privacy
Policy and Refund Policy pages reachable from the site's menus, the Terms naming the seller. The
owner has a Paddle account and is at that step (2026-09-29).

`kerfdesk.com` serves the web app. The product website in `website/` has pricing and privacy pages
but nothing deploys it (ADR-524 decision 6), and decision 6 says it must not replace the app on
`kerfdesk.com`. The customer documents in `docs/legal/` were drafted for `/terms/`, `/refunds/`
and `/privacy/` on `kerfdesk.com`. Main's deploy publishes only `dist/web`: the app plus the
standalone `public/` pages (`download.html`, `support.html`, `buy.html`). On 2026-09-29
`/pricing/`, `/terms/`, `/privacy/` and `/refunds/` answered 404.

The owner decided to publish the documents without a lawyer's review and asked Claude to check
them against the law instead (2026-09-29, 14:15 UTC; ADR-247 Amendment 2). He gave the seller's
name, his own legal name: Johannes Stephanus Stolk, selling as an individual (14:42 UTC).

### Decision

1. **Four standalone pages ship with the web app.** `public/pricing/`, `public/terms/`,
   `public/privacy/` and `public/refunds/` hold one `index.html` each, served at `/pricing/`,
   `/terms/`, `/privacy/` and `/refunds/`. Like the other standalone pages they run no script and
   use the app-wide security policy, and they stay out of the service worker's precache and its
   app-shell fallback, so a visitor never sees an outdated price or terms. The rest of the product
   website stays undeployed, and the app keeps `/`.
2. **They are generated from the documents, and committed.** `scripts/generate-site-pages.mjs`
   (`pnpm generate:site-pages`) builds the policy pages from `docs/legal/`: the Terms from the
   licence agreement, the Refund Policy from the refund policy, and the Privacy Policy from
   `kerfdesk-privacy-policy.md` (the website and the app) followed by the licensing and purchases
   notice. It builds pricing from `website/commerce.config.mjs`, the same offer, `trialOpen` and
   `salesOpen` the product website uses. Blockquotes in the documents are notes to the owner and
   are never published; a `[PLACEHOLDER: …]` the owner has not filled in shows as a marked blank.
   `scripts/generate-site-pages.test.mjs` fails when a committed page differs from its sources.
3. **Menus reach every page.** Each generated page, the download page and the support page carry
   a menu with Pricing, Download and Support and a footer with the three policies; the checkout
   page's footer links the three policies. The app's Help menu gains Pricing, Terms of Service
   and Privacy Policy, and the web app's status bar links Pricing, Terms, Privacy and Refunds
   whenever the bar is wide enough, so a visitor who lands on the app sees them without a menu.
4. **The pricing page links no checkout.** Purchases start in the desktop app (ADR-524 Amendment
   2), so the page says purchase opens soon until `salesOpen`, then sends buyers to Help > Licence.

### Consequences

- Merging publishes the pages with the next web deploy. The documents' remaining blanks (the
  seller's physical address and telephone number, the Information Officer's registration number
  and the date sales open) show as marked blanks until the owner fills them in.
- A change to a document or to the offer is a change to its source followed by
  `pnpm generate:site-pages`, in the same commit.
- When the product website is deployed on its own hostname, its pricing and privacy pages must
  match these, or link here.
