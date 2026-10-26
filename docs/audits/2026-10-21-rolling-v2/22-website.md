# Rolling audit v2 — Product website (`website/**`)

- **When:** 2026-10-21 16:10 UTC   **Tree:** origin/main @ `902f1d0c0`. No `website/`,
  `public/_headers`, `public/pricing` or `public/privacy` change between that SHA and the audit
  branch head.
- **Scope:** `website/**`: 17 page modules, `lib/`, configs, tests, `assets/` and `build.mjs`.
  Five of its renderers are live on kerfdesk.com through `public/`: pricing, terms, refunds,
  privacy and the app safety page (`scripts/generate-site-pages.mjs`,
  `scripts/generate-privacy-page.mjs`). The other twelve pages (home, features, laser, CNC,
  machines, download, docs, phone, FAQ, about, license and 404) are **not deployed** anywhere.
  `kerfdesk.com/features/`, `/license/` and `/machines/` return 404, and `www.kerfdesk.com`
  serves the app.
  - Governing documents: ADR-524 and its Amendments 1–4; ADR-543 and its Amendment 1; ADR-247;
    ADR-562 Amendment 1 (sales open); ADR-623 and its Amendments 1–3; ADR-540 and its
    Amendment 5; PROJECT.md "Delivery targets" and non-negotiable 8.
- **Lenses run:**
  - L1 contract.
  - L2 ground truth: live HTTP headers, Cloudflare NEL docs, the OWASP headers cheat sheet and
    the live dl.kerfdesk.com catalogue.
  - L3 site claims vs code and docs.
  - L7 tests.
  - L4/L5/L6 were skipped: the site is static, with no input, no state and no failure path.
    Its trust boundary is the build-time `html` escaper, which was read only.
- **Counts:** 10 raised → refuter: 10 confirmed, 0 plausible, 0 refuted; no severity changes →
  P1 0 / P2 1 / P3 9 (+5 KNOWN)

## Headline

The licence and no-JavaScript promises hold:

- No page calls KerfDesk open source or free software.
- MIT is named only on the License page, as ADR-543 allows.
- No page has a script, form, embed, cookie or third-party asset.

The real problems are drift between the site's copy and main:

- **Pro list.** The live pricing page lists 7 Pro tools. Since ADR-540 Amendment 5 the app
  gates 9: Registration Jig and Place Board are Pro but are missing from the list. The features
  page even lists Registration Jig as not Pro (P2-1).
- **Privacy page.** The live page misstates what the web app connects to. On a first visit the
  web app fetches the desktop catalogue from dl.kerfdesk.com, while the page says its CSP allows
  only kerfdesk.com.
- **Cloudflare NEL.** kerfdesk.com sends NEL headers, so browsers report network errors to
  Cloudflare. No KerfDesk page discloses this.
- **Undeployed pages.** They contradict the live download page on how to judge the only real
  installer, and they under-claim about ten features that shipped since September.

## Findings

### P2-1 — The live pricing page and the website's Pro list omit Registration Jig and Place Board, which the app gates as Pro

- **Where:**
  - `website/commerce.config.mjs:42-50`: Pro `includes` has 7 items. Free (`:18-26`) says
    "All machine control".
  - The rendered output is live as `public/pricing/index.html` at `kerfdesk.com/pricing/`.
  - `website/pages/features-data.mjs:48` reads "Arrays, Quick Nest, test grids, material
    libraries and a Registration Jig, plus the box generator in Pro".
  - `website/pages/features-data.mjs:109`, `:168` and `website/pages/laser.mjs:108` describe
    Multi-file trace and Registration Jig with no Pro pill.
  - `website/tests/commerce.test.mjs:70-78` pins the 7-item list.
- **Anchor:**
  - **Twin:** `src/ui/licensing/pro-features.ts:7-16` (9 features, including
    `registration-jig` and `place-board`). `src/ui/commands/edition-command-gate.ts:17-19` gates
    `tools.registration-jig`, `tools.place-board` and `tools.multi-file-trace`.
  - **Contract:** ADR-540 Amendment 5 (2026-10-15) makes "Registration Jig and Place Board …
    Pro tools".
  - **Contract:** ADR-524 Amendment 1 decision 2 says pages mark the tools the owner listed as
    Pro. Its Consequences say an edition change updates `commerce.config.mjs` and the commerce
    test together.
- **Scenario:**
  1. A browser user reads `kerfdesk.com/pricing/`. Free is "All machine control", and the Pro
     list does not name either tool.
  2. The user opens Tools › Registration Jig or Place Board in the web app (Free build).
  3. The Pro-in-desktop dialog appears instead: the tool is unavailable in the browser at all.
  4. A buyer comparing editions on the published sales page also sees an incomplete Pro list.
- **Evidence:**
  - READ (code above).
  - LIVE: `curl https://kerfdesk.com/pricing/` is byte-identical to
    `public/pricing/index.html`, whose Pro list ends at Design Studio.
  - `git log` shows `2117930a5` "make registration jig and place board Pro tools" changed
    `pro-features.ts` but not `commerce.config.mjs`.
  - The twin `public/buy.html:185-208` (outside scope) has the same omission.
- **Refuter:** CONFIRMED, kept at **P2**.
  - Live: I fetched `kerfdesk.com/pricing/` myself. Pro lists 7 tools, ending at Design Studio.
    None of Registration Jig, Place Board or Multi-file trace appears anywhere on the page.
  - Code, read on my own: `PRO_FEATURES` and `PRO_COMMAND_FEATURES` gate both tools.
    `2117930a5` (ADR-540 Amendment 5) is an ancestor of the 1.0.21 tag `faf5a54f1`.
  - The live web bundle `assets/ui-workbench-*.js` ships the `"registration-jig"` entry and
    the Place Board summary.
  - ADR-524 Amendment 1 Consequences require an edition change to update `commerce.config.mjs`
    and the commerce test together. That did not happen.
  - Severity check: the page omits rather than misstates. "All machine control" stays true,
    because Amendment 5 keeps machine controls outside the gate. It stays P2 for two reasons.
    It is the published edition comparison, framed "Everything in Free, plus:", so anything
    not listed reads as Free. The contract break has a concrete scenario: a browser user, Free
    forever, can never open either tool.
- **Fix direction:** Add both tools to `commerce.config.mjs` Pro `includes` and the commerce
  test (an owner-visible edition change), then regenerate `public/pricing/`. Mark Registration
  Jig and Multi-file trace Pro on the features and laser pages. Optionally, add a test that
  derives the site's Pro list from `PRO_FEATURES`.

### P3-1 — The live privacy page says the web app may connect only to kerfdesk.com and loopback, but the web app automatically fetches the desktop catalogue from dl.kerfdesk.com

- **Where:**
  - `website/pages/privacy.mjs:305-306`: "The web app’s security policy lets it connect only to
    kerfdesk.com and to that one address on your own computer".
  - The connections table (`:46-57`) has no row for the web app reaching `dl.kerfdesk.com`.
- **Anchor:**
  - **Twin:** `public/_headers:13` has `connect-src 'self' http://127.0.0.1:51731
    https://dl.kerfdesk.com` (live header confirmed).
  - On first visit, `src/ui/licensing/BrowserDesktopWelcome.tsx:45-50` opens the welcome dialog
    automatically after 700 ms.
  - `DesktopWelcomeDialog.tsx:26-33` then calls `resolveWindowsDesktopDownload`.
    `public/desktop-windows-download.mjs:41-43` fetches
    `https://dl.kerfdesk.com/desktop/commercial/catalog.json` (live 404), then the manual
    `latest.json` (200).
  - **Contract:** ADR-524 Amendment 1 decision 4 (the privacy page covers the app's
    connections).
- **Scenario:** A first visit to kerfdesk.com in Chrome sends requests to `dl.kerfdesk.com` with
  no click. The privacy notice says that connection cannot happen.
- **Evidence:** READ, plus a LIVE header check: `curl -D - https://kerfdesk.com/` gives
  `connect-src 'self' http://127.0.0.1:51731 https://dl.kerfdesk.com`. Not reproduced in a
  browser.
- **Refuter:** CONFIRMED by REPRO, stays P3.
  - Repro: I opened `https://kerfdesk.com/` in a fresh browser pane (empty localStorage) and
    clicked nothing. Within 6 s the "Choose your KerfDesk workspace" dialog was open.
    `performance.getEntriesByType('resource')` listed
    `https://dl.kerfdesk.com/desktop/commercial/catalog.json` and
    `…/commercial-manual/latest.json`.
  - Live: the privacy page quotes the CSP sentence, and `curl` re-confirmed the `connect-src`.
    `dl.kerfdesk.com` answers `Access-Control-Allow-Origin: https://kerfdesk.com`.
  - Code: the path is `FreeOnlyEdition` → `BrowserDesktopWelcome` → `DesktopWelcomeDialog` →
    `resolveWindowsDesktopDownload`.
  - Severity check: P2 was considered and rejected. The undisclosed host is first-party and is
    already disclosed for the desktop app. The request omits credentials and referrer and
    carries no project data. Its only data is IP and time, which the page already says
    Cloudflare receives.
- **Fix direction:** Add a connections row: the browser's desktop-download card reads signed
  release metadata from `dl.kerfdesk.com` (no project data; IP and time). Correct the CSP
  sentence. Then regenerate the privacy page.

### P3-2 — The live privacy page says an unconfirmed trial stops "KerfDesk [from opening] again", but 1.0.21 opens straight into Free

- **Where:** `website/pages/privacy.mjs:236-237`. It is live at `kerfdesk.com/privacy/`, dated
  2026-10-20.
- **Anchor:**
  - **Contract:** ADR-623 Amendment 3 decision 2: "opens straight into KerfDesk Free"; when
    rights end "only new Pro choices pause".
  - `public/desktop-licence-window.mjs:7` has `DESKTOP_LICENCE_WINDOW = false`.
- **Scenario:** A trial user offline for more than 3 days relaunches 1.0.21. KerfDesk opens in
  Free with Pro paused, while the notice says it cannot open.
- **Evidence:** READ and LIVE (the sentence is in the fetched page).
- **Refuter:** CONFIRMED, stays P3.
  - Live: my fetch of `/privacy/` (Last updated October 20, 2026) contains the sentence. It
    is unconditional in `privacy.mjs:236-237`.
  - Code: `DESKTOP_LICENCE_WINDOW = false` holds at the 1.0.21 tag `faf5a54f1`.
  - Contract: ADR-623 Amendment 3 decision 2 says "only new Pro choices pause".
- **Fix direction:** Reword to "before new Pro tools can be chosen (and, while the licence
  window is on, before KerfDesk opens)". Alternatively, key the sentence to
  `DESKTOP_LICENCE_WINDOW` as the app's own messages do.
  - This is separate from the "Existing work…" sentence the PR #1280 body leaves to the owner.

### P3-3 — The live privacy page leaves out the grblHAL raw-TCP machine channel and its own Paddle link

- **Where:**
  - `website/pages/privacy.mjs:102-107` and `:315` name only "an explicitly configured FluidNC
    Telnet channel".
  - `:142-146` says links leave only to kerfdesk.com, plus OpenAI. The page also links
    `https://www.paddle.com/legal/privacy`, and the test allow-list in
    `website/tests/content.test.mjs` permits that link.
- **Anchor:**
  - **Twin:** ADR-601 says the desktop network adapter accepts `fluidnc-telnet` **and**
    `grblhal-raw` (unencrypted TCP to a user-entered host).
  - **Contract:** ADR-524 Amendment 1 decision 4.
- **Scenario:** A grblHAL user connects over Ethernet in the desktop app. The privacy notice
  neither lists that channel nor warns that it is unencrypted, as it does for FluidNC.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, stays P3.
  - Live `/privacy/`: no mention of grblHAL or raw TCP. Its hrefs include
    `https://www.paddle.com/legal/privacy`, but the links sentence names only KerfDesk pages
    and OpenAI.
  - Code: `grblhal-raw` is a `MachineNetworkProtocol` reached from `MachineNetworkConnect` via
    `machine-network-profile.ts`. Its label says "raw Telnet service".
- **Fix direction:** Name both network contracts in the row and in "Your machine", and say "go
  to kerfdesk.com, Paddle's privacy notice and OpenAI's API data policy".

### P3-4 — kerfdesk.com sends Cloudflare Network Error Logging headers; visitors' browsers report failures to a.nel.cloudflare.com, and no KerfDesk page discloses it

- **Where:**
  - Every kerfdesk.com response carries `Report-To: {"group":"cf-nel",…
    "url":"https://a.nel.cloudflare.com/report/v4?…"}` and
    `NEL: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}`. This was seen on
    `/`, `/pricing/` and `/privacy/`.
  - This is a Cloudflare zone setting, not repository code.
  - Disclosure gap: `website/pages/privacy.mjs:116-123` ("no analytics or visitor tracking"),
    `:30` ("no automatic error reporting") and "What the server receives".
- **Anchor:**
  - **Contract:** PROJECT.md non-negotiable 8 ("No … error-reporting service") and ADR-524
    decision 2 (no analytics).
  - **Ground truth:** Cloudflare's NEL page describes browsers that "report their own network
    failures to an external endpoint". The report body includes `url`, `referrer`,
    `server_ip`, `status_code` and `elapsed_time`, and the feature can be turned off per zone
    (https://developers.cloudflare.com/network-error-logging/).
- **Scenario:** A visitor's or PWA user's request to kerfdesk.com fails at DNS, TCP or TLS
  within 7 days of a visit. Chrome then posts a failure report with the URL to Cloudflare. The
  privacy page describes no such channel.
- **Evidence:** SOURCE (Cloudflare docs) plus LIVE headers (`curl -sI https://kerfdesk.com/pricing/`).
- **Refuter:** CONFIRMED, stays P3.
  - Live: my own `curl` saw `Report-To` (cf-nel) and
    `Nel: {"report_to":"cf-nel","success_fraction":0.0,…}` on `/` and `/privacy/`. They also
    appear on `dl.kerfdesk.com`, so the download host is affected too.
  - Source: I fetched the Cloudflare NEL page myself. It confirms the endpoint, the report
    fields (`url`, `referrer`, `server_ip`) and the zone toggle.
  - Mitigating: Cloudflare says reports hold no PII and are not shared, and Cloudflare is
    already disclosed as receiving IP and time. It is still an undisclosed browser
    error-report channel against "no automatic error reporting".
- **Fix direction:** Turn NEL off for the zone (dashboard toggle or `PATCH
  /zones/{id}/settings/nel`), or disclose it on the privacy page. Re-check the headers after the
  change.

### P3-5 — The undeployed download, FAQ and machines pages contradict the only real installer and offer Previews that do not exist

- **Where:**
  - `website/pages/download.mjs:192-221`: the "Install a desktop Preview" steps say continue
    only if the name contains `-preview.`. They also say: "The signed Windows edition … If
    Windows reports an unknown publisher for it, don’t run it."
  - `download.mjs:75-76` (macOS card): the download page "offers … the free Mac Preview".
  - `website/pages/faq-data.mjs:47`: "Desktop Previews are available for Windows … and macOS".
  - `website/pages/machines-data.mjs:70, 125-138`.
- **Anchor:**
  - **Ground truth (live):** `dl.kerfdesk.com/desktop/commercial-manual/latest.json` is 1.0.21,
    `KerfDesk-1.0.21-windows-x64-setup.exe`, `codeSigning: "unsigned"`.
  - `…/previews/latest.json`, `latest-macos.json` and `latest-linux.json` are all 404.
  - **Twin:** the live `public/download.html` says "The installer isn't code-signed yet … check
    the name starts with KerfDesk-".
- **Scenario:** If the site is published as is, a Windows user who follows the steps refuses the
  real installer (no `-preview.`, unsigned). A Mac user is sent to a page that offers nothing
  for Mac.
- **Evidence:** READ plus LIVE catalogue fetches. The Preview half overlaps KNOWN 11-P3-3 (the
  Preview lane is not provisioned); the install-guidance contradiction is new.
- **Refuter:** CONFIRMED, stays P3 (latent: the pages are not deployed).
  - Live: `/features/`, `/license/` and `/machines/` return 404.
  - Live: `desktop/previews/latest{,-macos,-linux}.json` are 404, the real manifest path per
    `docs/desktop-preview-distribution.md`.
  - Live: `commercial-manual/latest.json` signs 1.0.21 as `unsigned`.
  - Code: `download.mjs:192-221` says what the finding quotes.
- **Fix direction:** Mirror the live download page. The unsigned commercial edition gets a
  `KerfDesk-` name check; Previews only "when published". Drop or reword "signed Windows
  edition".

### P3-6 — Undeployed feature, format and FAQ copy under-claims about ten capabilities that have shipped on main

- **Where / twins:**
  - **Formats.** `website/pages/features.mjs:118` and `faq-data.mjs:201` say ".ai, PDF … aren’t
    supported". `src/ui/app/import-dispatch.ts:21-37` imports `.pdf`, `.ai`, `.hpgl/.plt`,
    `.bmp`, `.gif`, `.tif(f)` and `.psd`. Exports PDF, EPS and GeoJSON exist (ADR-468), and the
    file table omits all of them.
  - **SVG images.** `features-data.mjs:214` and `faq-data.mjs:224` say embedded images are
    skipped. ADR-358 makes them raster objects.
  - **System fonts.** `features-data.mjs:92` says "doesn’t use the fonts installed on your
    system". ADR-628 adds a System fonts picker.
  - **Barcodes.** `features-data.mjs:97` says "Barcodes, QR codes … aren’t supported".
    ADR-386 and `tools.barcode` exist, with variable data.
  - **Dither count.** `home.mjs:64`, `features-data.mjs:127`, `laser-data.mjs:30,62` and
    `faq-data.mjs:231` say "11" options. `DITHER_ALGORITHMS` has 12 (Blue Noise, ADR-649).
  - **Trace presets.** `laser.mjs:100` says "one of five presets". `VISIBLE_TRACE_PRESET_NAMES`
    lists 8.
  - **Image Studio.** `features-data.mjs:115` says adjustments, retouching and layers "aren’t
    built yet". `src/ui/image-editor/{AdjustDialog,CurvesEditor,LayersPanel}.tsx` ship.
  - **G-code Inspector.** `faq-data.mjs:200` calls it the "Pro G-code Inspector". ADR-627
    makes it free.
  - **Network control.** `faq-data.mjs:123` and `machines-data.mjs:28,61,151,184` say "USB
    only … no Wi-Fi or network, including FluidNC". ADR-601 adds desktop FluidNC Telnet and
    grblHAL raw TCP.
- **Anchor:** Contract ADR-524 decision 3 and README "Every claim must be true on `main`
  today"; Twin as listed.
- **Scenario:** Publishing the site tells visitors that KerfDesk cannot open PDF or AI files,
  use system fonts or make QR codes. It can.
- **Evidence:** READ (each source location checked).
- **Refuter:** CONFIRMED, stays P3 (latent: the pages are not deployed).
  - I spot-checked six of the nine items on `902f1d0c0`:
    - `import-dispatch.ts` lists `.pdf`, `.ai`, `.hpgl/.plt`, `.bmp`, `.gif`, `.tif(f)` and
      `.psd`.
    - `DITHER_ALGORITHMS` has 12 entries, including `blue-noise`.
    - `VISIBLE_TRACE_PRESET_NAMES` has 8.
    - `tools.barcode` exists.
    - `image-editor/{AdjustDialog,CurvesEditor,LayersPanel}.tsx` exist.
    - `features.mjs:118-119` says "Pro G-code Inspector".
- **Fix direction:** Re-ground the copy against main. Derive counts (dithers, presets, fonts)
  from the source constants in a website test, so they cannot drift again.

### P3-7 — Generated live policy pages have no CI freshness check, and site tests pin copy instead of tying it to source

- **Where:**
  - `.github/workflows/ci.yml:73-74` runs only `pnpm check:privacy`.
  - `node scripts/generate-site-pages.mjs --public-info --check` (pricing, terms, refunds,
    safety) and `scripts/check-legal-publication.mjs --publish-ready` are wired into no
    workflow or package script.
  - `scripts/generate-site-pages.test.mjs:201-224` renders into a temp directory and never
    compares the committed `public/` files.
  - `website/tests/commerce.test.mjs:70-78` hard-codes the Pro list, so it actively protects
    P2-1's drift.
- **Anchor:**
  - **Contract:** ADR-524 Amendment 3 decision 2 ("fails when a committed page differs from its
    source"). Its reconciliation says public information is "checked separately with
    --public-info", which is manual.
  - **Twin:** `check:privacy` gives the privacy page exactly that freshness check.
- **Scenario:** Someone edits `website/pages/pricing.mjs`, `docs/legal/refund-promise.md` or
  `docs/safety.md` without running the generator. CI stays green, and the next deploy keeps
  serving the old pricing, refund or safety text.
- **Evidence:** READ. The current files appear fresh: live `/pricing/` equals the repository
  copy, and the source dates are not after the page dates. The generator was not run.
- **Refuter:** CONFIRMED, stays P3.
  - `.github/workflows/**` and `package.json` contain neither `--public-info` nor
    `check-legal-publication`. Only `check:privacy` runs, in `ci.yml:74` and `release:check`.
  - The only freshness-style test (`generate-site-pages.test.mjs:201-224`) renders into a
    `mkdtemp` root and re-checks its own output. It never reads the committed `public/` pages.
  - So ADR-524 Amendment 3 decision 2's "fails when a committed page differs" is not
    implemented.
- **Fix direction:** Add `generate-site-pages.mjs --public-info --check` to `ci.yml` next to
  `check:privacy`. Replace the literal Pro list in the commerce test with a comparison to
  `PRO_FEATURES` names.

### P3-8 — Governing docs and the website README describe a closed store, a private repository and an undeployed site

- **Where:**
  - `PROJECT.md:59` says the site "shows no price or checkout while sales are closed under
    ADR-247". Sales are open under ADR-562 Amendment 1: `salesOpen: true` and
    `PAYMENTS_ENABLED: "true"`.
  - `website/README.md:65-67, 76` say `salesOpen: false` and "purchase opens soon".
  - `website/README.md:67` says "Don’t write refund … terms". The pricing FAQ now states the
    14-day case-by-case policy.
  - `website/README.md:80` says "MIT so far".
  - `website/README.md:46` says OpenAI is "the only additional external destination". Paddle
    links are allowed and present.
  - `website/README.md:40`, `site.config.mjs:4`, `about.mjs:8` and `faq-data.mjs:8` say the
    repository "is private". `gh repo view` reports `visibility: PUBLIC`, and `LICENSE:26-28`
    says "While this repository is public".
  - `website/README.md:50` ("Nothing deploys automatically") and ADR-524 decision 6 ignore that
    5 of the site's 17 renderers ship to kerfdesk.com on every deploy through `public/`.
- **Anchor:** Contract: these documents are the site's own rules.
  - **Twin:** `commerce.config.mjs:10-11`, `wrangler.jsonc:17`, `LICENSE` and `gh repo view`.
- **Scenario:** A contributor follows the README. They treat a pricing-page edit as undeployed,
  or remove refund wording the live policy needs.
- **Evidence:** READ plus LIVE (`gh repo view --json visibility`).
- **Refuter:** CONFIRMED, stays P3.
  - `gh repo view` reports `cisgz3a-hub/KerfDesk`, `visibility: PUBLIC`, and `LICENSE:27`
    agrees.
  - I read the README "closed checkout" and "Nothing deploys automatically" passages and
    `PROJECT.md:59`.
  - The "is private" lines in `site.config.mjs`, `about.mjs` and `faq-data.mjs` are code
    comments, not rendered copy.
- **Fix direction:**
  - Update PROJECT.md "Delivery targets" and the README to the open-sales state.
  - State which website modules are live through `public/`.
  - Restate the GitHub rule as "never link the repository", without asserting that it is
    private.

### P3-9 — The License page (and the EULA it summarises) send Pro users to a "KerfDesk Licence Agreement" that is not published

- **Where:**
  - `website/pages/license.mjs:61-63`: Pro needs "a paid license under the KerfDesk Licence
    Agreement".
  - The source is `public/eula.txt:7-8, 14-16`, which the commercial installer shows
    (`release-desktop-unsigned.yml:148`).
- **Anchor:**
  - **Twin:** the published `/terms/` is "KerfDesk Software and Supplier Terms", Version 1.2
    (`docs/legal/software-supplier-terms.md:1-3`), which never calls itself the Licence
    Agreement.
  - `docs/legal/kerfdesk-licence-agreement.md:3` is "Draft for review. Not published or in
    force."
  - **Contract:** ADR-543 decision 3.
- **Scenario:** A Pro buyer looks for the "KerfDesk Licence Agreement" named in the installer
  notice and on the License page. No page has that title, and the site links none.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, stays P3.
  - The live `kerfdesk.com/eula.txt` names the "KerfDesk Licence Agreement", and
    `release-desktop-unsigned.yml:148` copies `public/eula.txt` as the installer terms.
  - Live `/terms/`, `/refunds/` and `/pricing/` contain no "Licence Agreement".
  - Only unpublished drafts (`kerfdesk-licence-and-notices.md`, `kerfdesk-refund-policy.md`)
    map that name to `/terms/`.
- **Fix direction:**
  - Website: call it the Software and Supplier Terms and link `/terms/`.
  - EULA: an owner text under AGENTS.md, so flag `eula.txt` §1 for the owner to align.

## Known (not raised again)

- **K1 — PR #1280 (open, held).** Site pages say the desktop app opens Free.
  - That is correct today: ADR-623 Amendment 3 holds the licence window off in 1.0.21.
  - #1280 must stay unmerged until a release turns the window back on.
  - Nothing it changes is wrong on main now.
- **K2 — 11-P2-1 (ci-release).** The Pages deploy token for kerfdesk.com is a repository
  secret. Fix PR #1339 is open (ADR-651).
- **K3 — 09-P1-1 (cnc-core).** `website/pages/cnc-data.mjs` (ENTRY_TABLE "Lead-in and
  lead-out") promises that the plunge "sits in the offcut rather than on your part". That
  promise is false while 09-P1-1 is open; fix the copy with that fix.
- **K4 — 02-P2-2 (licensing).** `cnc-data.mjs:45-48` lists Inlay pair as Free. The
  tapered-inlay tier awaits a maintainer decision.
- **K5 — 11-P3-5 (ci-release).** The License page says the notices file is "generated from
  every production package". Workbox ships on kerfdesk.com unlisted.

## Refuted

The refuter (2026-10-22) refuted none of the ten findings above.

- **No severity changes.**
- **P2-1:** downgrading to P3 was weighed: the page omits the tools rather than misstating
  them. It was kept at P2; see its Refuter note.
- **Privacy-page findings (P3-1 to P3-4):** raising them to P2 was weighed and rejected. No
  undisclosed third party or personal data beyond IP and time is involved.
- **Owner and lawyer note:** together they are four inaccuracies on one live legal notice. The
  owner and a lawyer may want to fix them in one pass.

## Verified clean

- **Licence claims (Q1).**
  - The scan covered all 17 built pages and the 5 live pages. Nothing matches
    `open[- ]source|free software|source code|github`.
  - MIT appears only on `license/index.html`: once for versions up to `mit-final` (ADR-543
    Amendment 1 consequences), plus third-party rows.
  - The License page summary of `eula.txt` §§1–5 and of `LICENSE` is accurate, apart from
    P3-9.
  - The commercial installer shows `public/eula.txt`, as the page says.
- **No JS, analytics or cookies (Q2).**
  - No `<script>`, `<form>`, `<iframe>`, `<object>`, `<embed>`, `<video>`, `@import`,
    remote stylesheet or inline handler or style appears in the built or live pages.
  - `site.css` has no `url()` and uses system fonts.
  - `Set-Cookie` count is 0 on `/`, `/privacy/`, `/pricing/`, `/terms/` and `/download`.
  - No Cloudflare beacon or email-obfuscation script is present (`no-transform`).
  - The only exception is NEL (P3-4).
- **Headers (Q4).**
  - The website `_headers` (`lib/meta-files.mjs`) sets:
    - `default-src 'none'`, with `style-src`, `img-src` and `font-src 'self'`;
    - `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'` and
      `upgrade-insecure-requests`;
    - XFO DENY, nosniff, Referrer-Policy `strict-origin-when-cross-origin` and COOP
      `same-origin`;
    - a Permissions-Policy denying camera, mic, geolocation, serial and USB;
    - HSTS 1 year.
  - Against OWASP's HTTP Headers Cheat Sheet, this matches every recommendation except HSTS
    (no `includeSubDomains`/`preload`, OWASP suggests `max-age=63072000; includeSubDomains;
    preload`) and a missing CORP `same-site`. Neither is raised: the site is undeployed, and the
    apex kerfdesk.com HSTS already has `includeSubDomains`.
  - The live policy pages carry a meta CSP with `script-src 'none'` and `connect-src 'none'`.
    `public/_headers` detaches only the header CSP for them; XFO DENY, nosniff, `no-referrer`
    and HSTS still apply (checked live).
- **Prices (Q3).**
  - US$49.50 and US$20 are shown with `salesOpen: true`, authorised by ADR-562 Amendment 1,
    and `wrangler.jsonc` `PAYMENTS_ENABLED: "true"` agrees.
  - Licence email is `LICENCE_EMAIL_ENABLED: "false"`, matching "prepared but not yet switched
    on".
  - The pricing refund FAQ matches `refund-promise.md` v1.2.
  - The live `/pricing/` is byte-identical to `public/pricing/index.html`.
- **Downloads (Q3).**
  - The website file pattern `KerfDesk-<version>-windows-x64-setup.exe` matches the live
    1.0.21 artefact.
  - Mac and Linux are described as "when released": `latest-macos.json` and
    `latest-linux.json` are 404, and no `KERFDESK_UNSIGNED_MACOS/LINUX_RELEASES` variable is
    set.
  - The desktop buttons go to `kerfdesk.com/download.html`, which redirects with 308 to a 200
    page.
- **Desktop Free wording** is correct under ADR-623 Amendment 3; see K1.
- **Links (Q5).**
  - Every external href on the built site and the live pages resolves: OpenAI, the three Paddle
    legal pages, `paddle.net`, and the `kerfdesk.com` support, phone, buy, download, EULA,
    notices and safety pages.
  - The cross-site fragments `support#report` and `phone#mcp` exist.
  - The in-page fragments on the live pages (`#app`, `#main`) exist.
  - Internal links and fragments are covered by `website/tests/build.test.mjs:65-88`.
- **Accessibility (Q5).**
  - Tests enforce `lang`, a single h1, alt text plus dimensions on every image, unique ids and
    no inline styles.
  - Computed WCAG contrast for every text token pair is at least 5.03:1 in light and dark.
    The lowest pairs are `muted`/`bg-alt` at 5.03 and `white`/`accent` at 5.05.
  - `--border-strong` (2.3–3.0:1) is used only on controls that also carry text labels.
  - The focus ring is `outline: 3px solid var(--accent)`.
  - The only heading skip is `privacy` h1→h3, where the cards come before the first h2. It is
    not raised, because WCAG does not mandate sequential levels.
- **Other claims checked and true:**
  - The shortcuts P, Ctrl+I, Ctrl+Shift+E and Ctrl+. (`shortcut-list.ts`).
  - 5–25 lines per mm (`raster-units.ts`, `raster-budget.ts`).
  - 25 bundled fonts (21 + 4).
  - No LightBurn writer exists.
  - The nightly dependency audit (`audit.yml` cron).
  - Frame is the only Start guard, and warnings do not block (PROJECT non-negotiable 21).
  - Abort copy always comes with the software-stop warning (test).
- **L7:** `website:test` runs in CI (`ci.yml:115`) and in `release:check`.

## Not verified

- The website test suite was not run locally. My one allowed run was the build (17 pages, in
  1.9 s). CI runs the suite.
- Whether the committed `public/terms`, `refunds` and `safety` pages equal a fresh
  `--public-info` render. The generator was not run; see P3-7.
- Cloudflare zone settings (NEL toggle, Web Analytics, Bot Fight Mode). Only the response
  headers were visible, and the dashboard was not accessed.
- Browser behaviour for P3-1: no network trace of the first-visit welcome dialog was captured.
  The refuter later reproduced it in a fresh browser pane; see P3-1.
- Real-browser rendering, screen-reader behaviour and dark-mode visuals.
- The legal adequacy of the terms, refund and privacy texts (owner and lawyer scope).
- `docs/safety.md` content, which is rendered live but is outside `website/**`.

```json
[
  {"id":"P2-1","severity":"P2","area":"website","file":"website/commerce.config.mjs","line":42,"anchor":"Twin src/ui/licensing/pro-features.ts:7-16 + edition-command-gate.ts:17-19; Contract ADR-540 Amd 5, ADR-524 Amd 1 decision 2","evidence":"READ+LIVE","verdict":"CONFIRMED","known":false,"summary":"Live pricing page and site Pro list omit Registration Jig and Place Board (Pro since ADR-540 Amd 5); features page lists Registration Jig as non-Pro; commerce test pins the stale list"},
  {"id":"P3-1","severity":"P3","area":"website","file":"website/pages/privacy.mjs","line":305,"anchor":"Twin public/_headers:13 connect-src + BrowserDesktopWelcome auto-open -> dl.kerfdesk.com catalogue; Contract ADR-524 Amd 1 decision 4","evidence":"READ+LIVE+REPRO","verdict":"CONFIRMED","known":false,"summary":"Live privacy page says web CSP allows only kerfdesk.com and loopback; the web app auto-fetches the desktop catalogue from dl.kerfdesk.com on first visit, undisclosed"},
  {"id":"P3-2","severity":"P3","area":"website","file":"website/pages/privacy.mjs","line":237,"anchor":"Contract ADR-623 Amd 3 decision 2; public/desktop-licence-window.mjs:7","evidence":"READ+LIVE","verdict":"CONFIRMED","known":false,"summary":"Live privacy page says an unconfirmed trial stops KerfDesk opening again; 1.0.21 opens straight into Free"},
  {"id":"P3-3","severity":"P3","area":"website","file":"website/pages/privacy.mjs","line":105,"anchor":"Twin ADR-601 grblhal-raw contract; Contract ADR-524 Amd 1 decision 4","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Privacy page names only FluidNC Telnet, omits unencrypted grblHAL raw TCP; says links leave only to kerfdesk.com/OpenAI though it links Paddle"},
  {"id":"P3-4","severity":"P3","area":"website","file":"(Cloudflare zone kerfdesk.com) / website/pages/privacy.mjs","line":116,"anchor":"Contract PROJECT.md non-negotiable 8, ADR-524 decision 2; Ground truth https://developers.cloudflare.com/network-error-logging/","evidence":"SOURCE+LIVE","verdict":"CONFIRMED","known":false,"summary":"kerfdesk.com serves Cloudflare NEL/Report-To headers; browsers report failed requests (url, referrer) to a.nel.cloudflare.com; not disclosed"},
  {"id":"P3-5","severity":"P3","area":"website","file":"website/pages/download.mjs","line":208,"anchor":"Ground truth live dl.kerfdesk.com catalogue (1.0.21 unsigned; previews/mac/linux 404); Twin public/download.html install steps","evidence":"READ+LIVE","verdict":"CONFIRMED","known":false,"summary":"Undeployed download/FAQ/machines copy tells Windows users to refuse non -preview. or unknown-publisher installers (the only real installer) and offers Previews that are not published (overlaps 11-P3-3)"},
  {"id":"P3-6","severity":"P3","area":"website","file":"website/pages/features-data.mjs","line":92,"anchor":"Contract ADR-524 decision 3; Twin import-dispatch.ts, ADR-358/386/468/601/627/628/649, VISIBLE_TRACE_PRESET_NAMES","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Undeployed copy under-claims ~10 shipped capabilities: PDF/AI/HPGL/BMP/GIF/TIFF/PSD import, SVG images, system fonts, barcodes, 12 dithers, 8 trace presets, Image Studio layers, free G-code Inspector, desktop network control"},
  {"id":"P3-7","severity":"P3","area":"website","file":".github/workflows/ci.yml","line":74,"anchor":"Contract ADR-524 Amd 3 decision 2; Twin check:privacy","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No CI freshness check for generated live pricing/terms/refunds/safety pages; commerce test hard-codes the Pro list instead of deriving it from PRO_FEATURES"},
  {"id":"P3-8","severity":"P3","area":"website","file":"website/README.md","line":65,"anchor":"Twin commerce.config salesOpen true, wrangler PAYMENTS_ENABLED, gh repo visibility PUBLIC, LICENSE:26; PROJECT.md:59","evidence":"READ+LIVE","verdict":"CONFIRMED","known":false,"summary":"PROJECT.md and website README describe closed sales, a private repo, MIT-so-far releases and an undeployed site; 5 site renderers ship live via public/"},
  {"id":"P3-9","severity":"P3","area":"website","file":"website/pages/license.mjs","line":63,"anchor":"Twin docs/legal/software-supplier-terms.md (published /terms/) vs kerfdesk-licence-agreement.md (draft); Contract ADR-543 decision 3","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"License page and eula.txt send Pro users to a 'KerfDesk Licence Agreement' that is unpublished; the published document is the Software and Supplier Terms"},
  {"id":"K1","severity":"P3","area":"website","file":"website/pages/pricing.mjs","line":251,"anchor":"ADR-623 Amd 3","evidence":"READ","verdict":"PENDING","known":"PR #1280","summary":"Desktop-Free copy is correct while the licence window is held off; #1280 must stay held until it returns"},
  {"id":"K2","severity":"P2","area":"website","file":".github/workflows/deploy.yml","line":280,"anchor":"11-P2-1","evidence":"LIVE","verdict":"PENDING","known":"11-P2-1 / PR #1339","summary":"Pages deploy token for kerfdesk.com is a repository secret"},
  {"id":"K3","severity":"P1","area":"website","file":"website/pages/cnc-data.mjs","line":101,"anchor":"09-P1-1","evidence":"READ","verdict":"PENDING","known":"09-P1-1","summary":"CNC page promises lead-in plunges sit in the offcut; false while 09-P1-1 is open"},
  {"id":"K4","severity":"P2","area":"website","file":"website/pages/cnc-data.mjs","line":45,"anchor":"02-P2-2","evidence":"READ","verdict":"PENDING","known":"02-P2-2","summary":"Inlay listed as Free; tapered inlay tier awaits maintainer decision"},
  {"id":"K5","severity":"P3","area":"website","file":"website/pages/license.mjs","line":101,"anchor":"11-P3-5","evidence":"LIVE","verdict":"PENDING","known":"11-P3-5","summary":"License page says notices cover every production package; Workbox ships unlisted"}
]
```
