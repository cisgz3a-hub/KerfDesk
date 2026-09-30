# Legal pages: what ships with them, and what must exist before trials or sales open

Working notes for maintainers. Not published on the website.

The customer documents in this folder come from a sourced review, on 29 and 30 September 2026, of
the drafts in PR #1021. It checked them against South African law (CPA, ECTA, POPIA, PAIA), EU
and UK law (GDPR, consumer and digital-content law), US law (warranties, CalOPPA, the FTC Act) and
Paddle's seller, buyer and domain rules. Each document had an adversarial fact-check, then a
cross-document consistency check. It is not legal advice: the owner decided not to have a lawyer
review the texts (ADR-247 Amendment 2). The review's evidence (168 sourced requirements, every
finding with its verifier's verdict, the cross-document fixes and a ranked list of residual risks)
is kept with the owner's project files, not in this repository.

| Document | Page |
| --- | --- |
| `kerfdesk-licence-agreement.md` | https://kerfdesk.com/terms/ |
| `kerfdesk-privacy-notice.md` | https://kerfdesk.com/privacy/ |
| `kerfdesk-refund-policy.md` | https://kerfdesk.com/refunds/ |
| `kerfdesk-pricing.md` | https://kerfdesk.com/pricing/ |
| `kerfdesk-paia-manual.md` | https://kerfdesk.com/paia-manual/ |

The documents are copied unchanged from the review, except that the privacy notice's working data
(s3.2) also names the agreement the app keeps (ADR-564). Change one only with the same care: check
the change against the law, keep the five consistent, and run `pnpm generate:site-pages`, which
also updates the terms the app shows (`src/ui/legal/terms-text.generated.ts`).

## Blanks the owner fills before the pages go live

- The publication date, the same in every document. It is the day the pages go live.
- A street address in South Africa where the owner accepts legal papers, not a post box (ECTA
  s43(1)(b) and (g), POPIA s18).
- A telephone number (ECTA s43(1)(b), Paddle's seller handbook).
- VAT status: "Not registered for VAT" unless the owner is registered.
- The "Ons Houtkombuis" line in terms s27 and on the pricing page: say what it is, or delete the
  line and remove the name from the website, the About text and the app's start screen.

## What ships with the pages

These are needed for Paddle's domain review, ECTA s43 and CalOPPA. Items 1 to 4 are done (ADR-524
Amendment 3). In item 5, `LICENSE` and `public/eula.txt` wait for the owner's word; the rest is
done.

1. The five pages, linked from every page, including the web app (status bar and Help menu).
   CalOPPA needs a link containing the word "Privacy" on the home page.
2. The /machines/, /safety/ and /license/ pages that the terms and the pricing page link.
3. The checkout page (public/buy.html): Paddle's reseller statement and the seller's legal name;
   links to the Terms, Refund Policy and Privacy Notice, with an "I agree" step before Paddle's
   checkout opens; "plus tax" next to prices and "you get a licence, not ownership" (Cal. B&P
   17500.6); no "Make it yours" or "Keep using the versions you own".
4. The support page (public/support.html): the telephone number, and payment, receipt, invoice
   and refund questions sent to Paddle (https://paddle.net).
5. On the same day, old texts that contradict the new ones are replaced: public/eula.txt (it
   excludes liability for injury and fire and names "Johann Stolk"), the app's safety notice ("NO
   warranty", "ENTIRELY AT YOUR OWN RISK"), docs/safety.md and the product website's licence
   page. The seller's legal name, Johannes Stephanus Stolk, is used in LICENSE, the installer
   copyright, package.json and the About text. AGENTS.md lets LICENSE and public/eula.txt change
   only when the owner asks.

## Must exist before Pro trials or sales open

1. **Acceptance steps.** Terms s1.3, s2.5 and s24.3 describe them: "I agree" in the installer, at
   the web app's first open and before buying, plus a separate machine-safety confirmation. Record
   the terms version and the time of acceptance. Without them the safety acknowledgement,
   disclaimers and liability limits probably fail. This is a terms acceptance, not a machine or
   paywall gate: record in an ADR how it squares with ADR-228 and ADR-247 s3.
   Status: the first-open step (both apps, terms and machine safety, version and time kept on the
   device, s24.3's later offer) ships with the pages and starts once the publication date is
   filled (ADR-564); the checkout step is on buy.html. The installer's "I agree" page still shows
   public/eula.txt until the owner approves replacing it.
2. **The deletion the privacy notice promises (s7).** Deactivated computers after 90 days, trials
   3 years after they end, unpaid orders after 90 days, administrative records after 5 years,
   backups after 90 days, and licences cancelled after a refund or chargeback 2 years after
   cancellation. The licensing service has no scheduled deletion yet and cannot delete one
   deactivated computer. Build it, or change s7 to what really happens.
3. **Paddle settings.** Card-statement descriptor KERFDESK. Exactly two one-time USD prices, 49.50
   and 20.00: tax-exclusive, quantity 1, no discounts. Automatic local-currency conversion off: the
   licensing service refuses anything else, so the buyer would be charged with no licence.
4. **Sandbox checks.** The exact South African total. The checkout shows item, tax and total and
   can be closed before paying (ECTA s43(2)). EU and UK buyers are asked to consent to immediate
   supply. Which cookies Paddle.js sets on buy.html: a non-essential one needs a consent banner for
   EU and UK visitors.
5. **When sales open.** Set `salesOpen` in `website/commerce.config.mjs` and run
   `pnpm generate:site-pages`: the one "KerfDesk Pro launches soon" line leaves every page (ADR-524
   Amendment 4). Give the 14 days' notice in terms s5.3 before the web app and Preview builds lose
   the Pro tools, and publish the new dates.

## The owner's own steps

- Register as Information Officer on the Information Regulator's eServices portal (free), then add
  the registration number to privacy s1.
- Register with the Consumer Goods and Services Ombud (compulsory; free below R1 million turnover).
- EU and UK GDPR representatives (Art 27): appoint them before trials or sales open there, don't
  offer there, or accept the risk. The notice no longer claims any.
- Product-liability insurance: not taken (the owner's decision, 29 September 2026); the terms'
  machine-safety notice and use-at-your-own-risk wording stay.
- Support mailbox: a free Gmail account has no data processing agreement (POPIA s21, GDPR Art 28).
  Move to Google Workspace, or accept the gap.
- Paddle: verify the account as Johannes Stephanus Stolk, sole trader, trading as KerfDesk.
