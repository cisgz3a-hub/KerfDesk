# KerfDesk website

The public product website for KerfDesk: what it does, which machines it has been checked on,
downloads, pricing, getting-started help, safety, privacy and licensing. It is separate from the
KerfDesk app — nothing here is bundled into the web app or the desktop builds (ADR-524).

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

## Deploying

Nothing deploys automatically. The site is plain static files and suits a separate Cloudflare Pages
project (the app's `laserforge` project must stay on `kerfdesk.com`: installed apps, browser
file and serial permissions and the desktop camera bridge's trusted origin are tied to that
origin). Pick the site's hostname, then build with `--site-url` and upload `website/dist`.

## Opening sales later

Sales are closed and the site shows no prices. KerfDesk is free to use today and paid licenses are
planned. ADR-247 says a first sale, and any license change for later versions, needs a new,
lawyer-reviewed commercial ADR. When that exists:

1. Publish terms of sale and a refund policy (as pages here or external https URLs).
2. Create a hosted checkout for each plan with a merchant-of-record or payment-link provider, so
   no card data touches this site.
3. Fill in `commerce.config.mjs`: `authorizingAdr`, `termsUrl`, `refundPolicyUrl`, the plans with
   their `checkoutUrl`s, then set `salesOpen: true`.
4. Update `tests/commerce.test.mjs`, which pins the closed state, in the same change.

The build refuses an open store that is missing any of these. Versions already released keep the
terms they were released under (MIT so far); the License page states this and nothing else on the
site presents KerfDesk as open source.
