## ADR-524 Amendment 3 - The pricing and policy pages ship with the web app on kerfdesk.com (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29 | **Amends:** ADR-524 decision 6 and "Alternatives
considered"

### Context

Paddle approves a seller's website before its business check starts. Its reviewer needs
`kerfdesk.com` live on HTTPS with the product described, and pricing, Terms of Service, Privacy
Policy and Refund Policy pages reachable from the site's menus, the Terms naming the seller. The
owner has a Paddle account and is at that step (2026-09-29).

`kerfdesk.com` serves the web app. The product website in `website/` had its own pricing, privacy
and license pages, but nothing deploys it (ADR-524 decision 6), and decision 6 says it must not
replace the app on `kerfdesk.com`. Main's deploy publishes only `dist/web`: the app plus the
standalone `public/` pages (`download.html`, `support.html`, `buy.html`). On 2026-09-29
`/pricing/`, `/terms/`, `/privacy/` and `/refunds/` answered 404.

The owner decided to publish the legal texts without a lawyer's review and asked Claude to check
them against the law instead (2026-09-29, 14:15 UTC; ADR-247 Amendment 2). He gave the seller's
name, his own legal name: Johannes Stephanus Stolk, selling as an individual (14:42 UTC). The
sourced review that followed produced five checked texts in `docs/legal/`: the terms, the privacy
notice, the refund policy, the pricing page and a PAIA manual. The terms and the pricing page link
`/machines/`, `/safety/` and `/license/` on `kerfdesk.com`, and require a telephone number on the
support page, an agreement step and "plus tax" on the checkout page, and the seller's legal name
wherever KerfDesk names its maker (`docs/legal/publishing-notes.md`).

### Decision

1. **Eight standalone pages ship with the web app.** `public/<page>/index.html` is served at
   `/pricing/`, `/terms/`, `/privacy/`, `/refunds/`, `/paia-manual/`, `/license/`, `/machines/`
   and `/safety/`. Like the other standalone pages they run no script and use the app-wide
   security policy, and they stay out of the service worker's precache and its app-shell fallback,
   so a visitor never sees an outdated price or terms. The rest of the product website stays
   undeployed, and the app keeps `/`.
2. **They are generated from documents, and committed.** `scripts/generate-site-pages.mjs`
   (`pnpm generate:site-pages`) renders one document per page: the five checked texts in
   `docs/legal/`, `docs/legal/kerfdesk-licence-and-notices.md` (built from the terms' own clauses),
   `docs/site/machines.md` and `docs/safety.md`. Their notes are published as boxed notes, and a
   `[PLACEHOLDER: …]` the owner has not filled in shows as a marked blank.
   `scripts/generate-site-pages.test.mjs` fails when a committed page differs from its source, and
   ties the pricing page to the offer in `website/commerce.config.mjs`, so a change to one must
   reach the other.
3. **Menus reach every page, and every page names the seller.** The generated pages, the download
   page and the support page carry a menu with Pricing, Machines, Safety, Download and Support and
   a footer with the Terms of Service, Privacy Notice, Refund Policy, PAIA Manual and Licence and
   notices, plus the seller's name. The app's Help menu gains Pricing, Terms of Service, Privacy
   Notice, Refund Policy and PAIA Manual, and the web app's status bar links Pricing, Terms, Privacy
   and Refunds whenever the bar is wide enough, so a visitor who lands on the app sees them without
   a menu.
4. **The pricing page links no checkout.** Purchases start in the desktop app (ADR-524 Amendment
   2). The checkout page (`buy.html`) states that Paddle resells KerfDesk Pro and names the seller,
   shows prices "plus tax" and says a purchase is a licence, not ownership. It loads Paddle's
   checkout only after the buyer ticks that they agree to the terms and the refund policy and have
   read the privacy notice, and that they will run their machine safely.
5. **The support page carries the telephone number** (a marked blank until the owner gives it)
   and sends order, payment, receipt, invoice and tax questions to Paddle.
6. **The product website links these pages instead of keeping copies.** Its own pricing, privacy
   and license pages are removed, its menus link the pages above, and its remaining copy states no
   warranty, liability or refund terms of its own and shows prices "plus tax", because the terms
   keep what the website says about KerfDesk (terms section 26.1).

### Consequences

- The pages go live with the first web deploy after this merges, so it merges only once the owner
  has filled the blanks listed in `docs/legal/publishing-notes.md` (his street address, telephone
  number, VAT status and the "Ons Houtkombuis" line) and set the publication date to that day.
- A change to a document or to the offer is a change to its source followed by
  `pnpm generate:site-pages`, in the same commit.
- `public/eula.txt`, which the installer shows, and `LICENSE` still carry the old text and owner
  name. AGENTS.md lets them change only when the owner asks; the publishing notes list them among
  the texts to replace on go-live day.
