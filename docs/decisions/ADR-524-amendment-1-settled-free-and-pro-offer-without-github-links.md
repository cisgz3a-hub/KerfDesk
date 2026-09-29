## ADR-524 Amendment 1 - The website shows the settled Free and Pro offer with checkout closed, and links nowhere on GitHub (2026-09-29)

**Status:** Implemented | **Date:** 2026-09-29 | **Amends:** ADR-524 decisions 4 and 5, and its "draft prices" alternative

### Context

ADR-524 was written on 2026-09-23, when KerfDesk was free to use and paid licenses were only
planned. So the site rendered no price or plan while sales were closed, and it linked GitHub for
desktop downloads, bug and security reports and the license texts. Two things have changed.

The source repository is private (ADR-523, ADR-522 Amendment 1; it was opened only temporarily on
2026-09-29 so pull request checks run free), so a GitHub link on the site is a dead end for a
customer. The owner: "Remember my Github is now private so no Github
download". Desktop installers are published on the public host `dl.kerfdesk.com`, the app's own
download page (`public/download.html`) checks the publisher signature before it lists them, and
the app's Help menu sends help and problem reports to `https://kerfdesk.com/support.html`.

The owner has also settled the commercial model:

- Two editions on both the browser app and the desktop app: Free and Pro.
- Free, with no time limit: drawing, text, import, basic trace, laser cut and engrave, 2D CNC cuts
  and all machine control.
- Pro: V-carve, 3D relief, adaptive clearing, advanced tracing, camera alignment, box generator,
  Design Studio and G-code Inspector.
- A Pro license is a one-time USD 49.50 purchase, before any sales tax or VAT the payment provider
  adds at checkout. It includes one year of updates, and every version released during that year
  keeps working forever. After the year, an optional USD 20 adds another year of updates; it is
  not a subscription and never renews automatically.
- One license is active on up to three devices at a time. Each desktop app installation or browser
  counts as one; deactivating one moves the license.
- Each device gets a free 30-day Pro trial with no card.
- A license never stops a job from running: when a trial ends only the Pro tools lock, and
  everything in Free keeps working.
- Sales are not open: no payment provider is live.

### Decision

1. **The settled editions and prices render; checkout stays closed.** `website/commerce.config.mjs`
   holds the Free edition and the Pro plan (price, update-year price, device limit, trial length)
   with `salesOpen: false`. The pricing page shows both editions, the prices and the license terms,
   and says "Purchase opens soon" where a buy button would go. While sales are closed,
   `website/lib/commerce.mjs` rejects a plan that carries a checkout URL and renders no checkout
   link, and the site still has no form or script. Opening checkout keeps decision 4's
   requirements (an authorizing commercial ADR, published terms of sale and refund policy, an https
   hosted checkout per plan), set in the same change as `salesOpen: true`.
2. **Licensing is stated as settled.** Decision 5's "free to use today, paid licenses planned, no
   price" copy gives way to the offer above on every page that mentions cost. The site writes no
   refund or other sale terms; it says the terms of sale will be published before sales open. The
   License page keeps its one factual sentence that the versions released so far are MIT-licensed,
   now without a link, and keeps "Versions already released keep the terms they were released
   under". Pages mark only the tools the owner listed as Pro.
3. **No GitHub links.** No page links to GitHub for downloads, releases, issues, discussions,
   source, license texts or reports. Desktop download buttons open the app's download page on
   `kerfdesk.com`, which serves installers from `dl.kerfdesk.com`. A site without scripts can't
   verify the signed release metadata or find the newest version, so it names file patterns, never
   a version. Help, bug and security reports go to the support page until a support email address
   exists, and the site writes no address. The third-party notices link opens the copy the app
   publishes at `kerfdesk.com/third-party-notices.txt`.
4. **The privacy page covers licensing.** For trials and activation the app sends
   `license.kerfdesk.com` only an installation digest (a one-way hash of the operating-system
   installation ID, computed locally), a device label, the license key or credential and order
   fields; no project, drawing, toolpath, machine or job data. Purchases will be handled by Paddle
   as merchant of record, which processes payment and customer records under its own privacy
   notice. Preview update checks go to `dl.kerfdesk.com`. Nothing adds analytics, cookies or
   tracking. The formal privacy notice and license agreement are written separately in
   `docs/legal/`; the page doesn't replace them.
5. **Tests pin the new facts.** `website/tests/commerce.test.mjs` pins the offer, the closed
   checkout (no checkout URL, form or buy link) and that the built site shows no price but US$49.50
   and US$20. `website/tests/content.test.mjs` rejects "github" anywhere in the built text files,
   any link off `kerfdesk.com`, any email address, the old "free to use today" and "paid licenses
   are planned" copy and refund terms, and pins the privacy disclosures.

The rest of ADR-524 stands: no JavaScript, analytics, cookies or forms; honest-by-construction copy
with evidence pills; no competitor named; a site separate from the app that nothing deploys
automatically.

### Consequences

- Showing a price is not a sale. Opening checkout is its own change, after the terms of sale are
  published and with the commercial ADR that ADR-247 requires.
- Changing an edition, a price or a license term is an owner decision: record it in an ADR and
  change `commerce.config.mjs` and the commerce test together.
- The web app and the free Preview builds don't ask for a license yet (ADR-523). The site
  describes the settled editions without claiming what a given build locks today. When the browser
  edition starts using the licensing service, the privacy page's web-app connections change in the
  same release.
- A new download host, support contact or notices location is a one-line change in
  `website/site.config.mjs`.
- Stale facts found on the way were corrected: the Mac Preview needs macOS 13 (ADR-483 Amendment
  1), and the Preview update check contacts `dl.kerfdesk.com`, not GitHub.
