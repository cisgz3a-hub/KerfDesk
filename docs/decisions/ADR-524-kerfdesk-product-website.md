## ADR-524 - KerfDesk product website: a separate static site, honest by construction, sales closed (2026-09-23)

**Status:** Accepted. | **Date:** 2026-09-23

### Context

The maintainer asked for a full website for KerfDesk "where customers can buy later" and chose
a `website/` folder in this repository. The same day the maintainer stated that KerfDesk is not
to be presented as open source and that licenses will be sold in the future. KerfDesk had no
product site: `kerfdesk.com` serves the app itself and `public/download.html` is a single
self-contained download page inside the app bundle.

Four existing decisions bound the design:

- **ADR-247** records the current first-party license as MIT (the public repository, `LICENSE`,
  `package.json` and the app's License & Safety Notice all say so) and keeps existing MIT grants
  irrevocable. It authorizes no sale; a first sale, and any license change for later versions,
  needs a new, lawyer-reviewed commercial ADR. It also forbids any latent commercialization gate in
  the app (account, trial, activation, entitlement, paywall).
- **PROJECT.md non-negotiable 8** — no analytics or telemetry. A product site that quietly added
  trackers would contradict the privacy promise it advertises.
- **The app's origin is load-bearing.** Installed PWAs, browser-granted file and serial
  permissions and the desktop camera bridge's exact trusted origins (ADR-121/133) are tied to
  `https://kerfdesk.com`. A website cannot take that origin over without breaking them.
- **The proof gap.** No machine is qualified: ADR-322 withdrew the former Falcon A1 Pro
  hardware-verification claim (README.md still repeats it), so informal runs on one machine are
  the strongest evidence. Raster engraving, the whole CNC surface and box fit are code and tests
  only, and the app's tutorial pictures are generated illustrations, not machine output.
  Ordinary marketing copy would overclaim by default.

### Decision

1. **`website/` is a separate static site, never bundled into the app.** A dependency-free Node
   build (`website/build.mjs`) renders page modules through an escaping `html` tagged template.
   It adds no npm dependency; icons come from `lucide-static`, which the app already ships.
2. **No JavaScript, analytics, cookies or forms.** Menus and FAQs use `<details>`. The generated
   `_headers` sets `default-src 'none'` with `style-src`/`img-src 'self'`, and the tests reject
   any `<script>`, inline handler, inline style or `javascript:` URL. Assets are content-hashed and
   cached as immutable.
3. **Honest by construction.** Copy comes from citation-checked facts on `main`. Any sentence
   that could read as "works on my machine" carries an evidence pill (*Used on a real machine*,
   *Simulator-tested only*, *Built, not yet machine-tested*). Product images are real captures of
   the app; generated pictures are never presented as KerfDesk output. Wherever Abort appears, the
   site states it is a software stop, not an emergency stop. Following ADR-120's neutrality policy the
   copy names no competitor; other products' file formats are named only as factual import support.
4. **Sales are closed, and opening them is data, not code.** `website/commerce.config.mjs` ships
   `salesOpen: false`; while closed the pricing page renders only the free offer, and draft plans,
   prices and checkout links never render. `website/lib/commerce.mjs` refuses to build an open
   store unless it names its authorizing commercial ADR, links terms of sale and a refund policy,
   and gives every plan an https hosted-checkout URL (merchant of record or payment link, so no
   card data touches the site). `website/tests/commerce.test.mjs` pins the closed state. This is
   website content only: it adds no account, entitlement, activation or paywall to the app and
   does not itself authorize a sale.
5. **Licensing is stated, not marketed.** Following the maintainer's direction, no page presents
   KerfDesk as open source. The site says KerfDesk is free to use today and that paid licenses are
   planned, with no price, date or feature promise. The one factual statement that the versions
   released so far are MIT-licensed appears only on the License page, because saying anything
   else would misstate the current legal terms; `website/tests/content.test.mjs` enforces both.
6. **Gated, not deployed.** `pnpm website:test` runs inside `pnpm release:check`; `eslint` and the
   raw file-size policy cover `website/`. Nothing deploys automatically. The site suits its own
   Cloudflare Pages project on a hostname the maintainer picks; it must not replace the app on
   `kerfdesk.com`.

### Alternatives considered

- **A framework or static-site generator (Astro, Next, Eleventy).** Rejected: new dependencies
  under ADR-017's conservative policy for about a dozen pages that a small in-repo build handles.
- **Serving the site from the app's Pages project.** Rejected: the app owns `/`, and mixing
  marketing routes into the PWA scope and service-worker precache couples two release cadences.
- **Showing draft prices or an email wait-list now.** Rejected: prices are a business decision
  not yet made, and a wait-list needs a backend and personal data the privacy promise excludes.

### Consequences

- The site can be reviewed, built and previewed locally today (`pnpm website:preview`).
- Canonical links, Open Graph URLs and the sitemap appear only once a site hostname is passed
  with `--site-url`; until then the build omits them rather than guessing a domain.
- Every copy change is a code change reviewed against the same honesty rule; facts that change
  on `main` (a newly qualified machine, a new release) need a matching site edit.
- A future commercial ADR opens sales by filling in `commerce.config.mjs` and updating the
  commerce test in the same change. Versions already released keep the terms they were released
  under.
