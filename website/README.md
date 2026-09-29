# KerfDesk website

The public product website for KerfDesk: what it does, which machines it has been checked on,
downloads, getting-started help and safety. It is separate from the KerfDesk app — nothing here is
bundled into the web app or the desktop builds (ADR-524). Pricing and the legal pages are the app's
own pages at kerfdesk.com, and this site only links them (see the last section).

## Commands

```bash
pnpm website:build                                  # → website/dist
pnpm website:build -- --site-url https://www.example.com
pnpm website:preview                                # build, then serve on http://localhost:5190
pnpm website:test                                   # node:test suite, also part of release:check
```

`--site-url` (or `KERFDESK_SITE_URL`) is the origin the site will be served from. Without it the
build omits canonical links, Open Graph URLs and `sitemap.xml`, which all need absolute URLs.

## How it is built

- **No framework and no new dependencies.** `build.mjs` renders page modules from `pages/` with
  the escaping `html` tagged template in `lib/html.mjs`. Icons are inlined from `lucide-static`,
  which the app already depends on.
- **No JavaScript ships.** The mobile menu and FAQ use `<details>`. The generated `_headers` sets a
  Content Security Policy with `default-src 'none'`, so an inline style or script would break the
  page; the tests reject both.
- **Assets are content-hashed** under `/assets/` and cached as immutable. Put images in
  `assets/img/` and reference them with `ctx.asset('img/…')`; CSS must not use `url()`.
- **Screenshots are real captures of the app** (`assets/img/screens/`, registered in
  `lib/screens.mjs`). Never use mock-ups or generated pictures as product output.

## Writing copy

Every claim must be true on `main` today. No machine is qualified (ADR-322): the strongest evidence
is informal use on one machine, and most output is code and tests only. When a sentence could
be read as "this works on my machine", attach a status pill (`statusPill()` in
`lib/components.mjs`). Keep the software-stop warning wherever Abort is mentioned: Abort is not
an emergency stop.

Nothing links to GitHub: the source repository is private, so a visitor can't open it (ADR-524
Amendment 1). Desktop downloads go to the KerfDesk download page (`site.downloadPageUrl`, which
serves installers from `dl.kerfdesk.com`); help, bug and security reports go to the support page
(`site.supportUrl`) or to `site.supportEmail`; write no other email address. Mark a
tool with `proPill()` (or `pro: true` on a card) only when the owner listed it as Pro.

## Deploying

Nothing deploys automatically. The site is plain static files and suits a separate Cloudflare Pages
project (the app's `laserforge` project must stay on `kerfdesk.com`: installed apps, browser
file and serial permissions and the desktop camera bridge's trusted origin are tied to that
origin). Pick the site's hostname, then build with `--site-url` and upload `website/dist`.

## Editions, prices and the legal pages

The owner has settled the offer (ADR-524 Amendment 1), and `commerce.config.mjs` holds it: a Free
edition with no time limit and a Pro license at US$49.50 plus tax, one time, with a year of
updates, an optional US$20 update year, three devices and a 30-day trial. `tests/commerce.test.mjs`
pins the offer and the closed store, so any change to either is deliberate. Write every price with
"plus tax": Paddle, the reseller, adds the tax where the buyer lives.

The pricing page, the Terms of Service, the Privacy Notice, the Refund Policy, the PAIA Manual and
the licence and notices page are checked legal texts (ADR-247 Amendment 2). The app publishes them
from `docs/legal/` (`scripts/generate-site-pages.mjs`), and this site links them through
`site.pricingUrl`, `site.termsUrl` and the other URLs in `site.config.mjs`, so it can never show an
old or different version. Don't write refund, warranty, liability or other sale terms here. The
terms keep whatever the website says about KerfDesk (section 26.1), so never promise more than they
do: no "forever", "yours to keep" or "as is".

Purchases start in the desktop app (ADR-523): no page links a checkout, and the build refuses a
plan with a checkout URL. Versions already released keep the terms they were released under; the
licence and notices page says which, and nothing on the site presents KerfDesk as open source.
