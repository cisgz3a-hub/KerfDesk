# O11 `supply-chain-truth` — Oracle audit O1, batch 4

**Area:** what KerfDesk ships from other people.
- Manifests and lockfiles: `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` (overrides and patches), plus the manifests and lockfiles of `services/remote-control` and `services/desktop-licensing`.
- `patches/`, `THIRD_PARTY_NOTICES.md` and the generated `public/third-party-notices.txt` files.
- Bundled fonts, images, ICC profiles, firmware and fixtures.
- Vendored or adapted code under `src/`, `public/`, `electron/`, `website/` and the phone service.
- What the web, desktop and phone bundles actually contain, judged from their build configs. Nothing was built or packaged.

**Read at:** `origin/main` 5c351a6b3 (2026-11-12). Fixes branch from 420c5f547. Method, severity and rules: [AREAS.md](AREAS.md).

**Fix PRs:**
- [#1814](https://github.com/cisgz3a-hub/KerfDesk/pull/1814): O11-P3-1 to -5, -10, -11 and -12, plus the Zlib part of -6. ADR-017 Amendment 3.
- [#1815](https://github.com/cisgz3a-hub/KerfDesk/pull/1815): O11-P3-13.

Both were opened with auto-merge off, because of the 1.0.32 release freeze.

## Headline

**Nothing KerfDesk ships is licensed against a closed, paid app.** The auditors checked every production package against its own LICENSE files on disk, not just its `license` field: 69 in the web and desktop app (75 name@version pairs) and 24 in the phone service.
- There is no GPL, AGPL, LGPL, SSPL, Commons Clause or non-commercial text.
- Every package has a licence file or a reviewed fallback.
- The committed notices regenerate byte for byte.
- OSV lists **no advisory** for any of the 92 locked production versions, the 18 packages the desktop main process ships, or Electron 44.9.1.
- Fonts ship unmodified, and every converted font avoids its parents' Reserved Font Names.
- The eight OpenClipart files match their pinned hashes and are CC0.
- Nothing from Potrace or any other GPL project reaches a bundle.

The gaps are all about **what the notices name**, not what they allow.
- The biggest: some code reaches the app through **devDependencies**, which the licence tools never see. These are the Workbox service-worker runtime, workbox-window, vite-plugin-pwa's register hook, and the MCP client bundled into the desktop's MCP view. All are MIT or Apache-2.0, but minification strips their copyright lines. They had no notice section, and the licence gate could not have stopped a copyleft package arriving the same way.
- The rest are a drifted hand-written summary, a MeerK40t-derived Ruida swizzle that claimed "no code copied", and an uncredited ZXing port in the phone's QR decoder.

Three auditor P2s were taken down to P3 by the refuters:
- Workbox: already known as rolling v2 11-P3-5, and no user gets a misleading result.
- The desktop MCP view: dead code there, and its licence text already ships under a sibling package.
- The EMS fonts: upstream publishes no copyright line to keep.

| Raised | Duplicates merged | Refuted | Contradicted (research) | P1 | P2 | P3 |
|---|---|---|---|---|---|---|
| 18 (Auditor A 10, Auditor B 8) | 2 | 1 | 0 | 0 | 0 | 15 (9 fixed, 1 partly fixed, 5 listed) |

## Oracle plan

This plan was written before the code was read closely. It is kept as written.

| # | Claim | Oracle |
|---|---|---|
| C1 | Every shipped npm package (web, Electron, phone service) has a licence that allows a closed, paid app; no GPL/AGPL/SSPL/LGPL-static/BUSL/CC-NC terms | each package's LICENSE text in `node_modules`; SPDX licence list |
| C2 | Dual/OR licences resolve to a permissive option; "SEE LICENSE IN", UNLICENSED and missing licences are inspected by hand | LICENSE files; SPDX expression syntax |
| C3 | The notices list every shipped package and asset with its licence and copyright line | the licence texts; MIT notice clause; Apache-2.0 §4(d) |
| C4 | Fonts are OFL-1.1 or permissive; Reserved Font Names respected; licence text ships with them | SIL OFL 1.1 and OFL-FAQ |
| C5 | Images, icons, ICC profiles and firmware are own work or allow commercial redistribution; CC-BY credited | CC deeds; color.org sRGB terms |
| C6 | Vendored or adapted code is identified, permissively licensed and listed | upstream licence files |
| C7 | The licence gate's allowlist matches its documented policy, covers the whole shipped closure, and fails closed | ADR-008/017; SPDX expression semantics |
| C8 | No known advisory reachable in KerfDesk's use affects a locked production version | osv.dev / GitHub advisories for exact versions |
| C9 | `patches/` apply to the locked versions and do not reopen a fixed upstream bug | upstream releases and fixing commits |
| C10 | What ships is the lockfile version: frozen installs, no unpinned runtime fetches, intended files only | lockfile vs manifests; build configs |
| C11 | Electron's licences ship and its version has no relevant known CVE | Electron releases and advisories |
| C12 | No package's licence drifted between the notices and the locked version | LICENSE at the locked version |

## Method as run

- **Auditor A (subagent): the npm closure.**
  - Read every production package's LICENSE, COPYING and NOTICE files and README licence sections, in both closures.
  - Regenerated both notices files into scratch.
  - Ran the real licence gate against a fake `pnpm` that printed 15 crafted SPDX inventories.
  - Mapped what the Electron allow-list, the Vite build and the phone build put into each bundle.
- **Auditor B (subagent): assets, vendored code, advisories and patches.**
  - Parsed every font's `name` table and compared it with the summary.
  - Fetched the EMS and parent-font OFL files, hashed the OpenClipart and engine assets, and swept the source for adapted code.
  - Queried OSV for every locked production version.
  - Compared `patches/` with upstream.
- **Refuter A and Refuter B (fresh subagents, different methods).**
  - Ran workbox-build's `generateSW` and a small Vite 6 build in scratch to see what survives minification.
  - Ran an any-depth NOTICE scan and their own OSV queries.
  - Compared the Ruida swizzle with MeerK40t's `rdjob.py` using 7-word shingles.
  - Fetched ZXing's Java source and the npm registry.
- **Research verifier (fresh subagent, web).** Checked 18 outside facts (37 rows) against primary sources: 37 VERIFIED, 0 CONTRADICTED, 0 UNSOURCED.
- **Owner re-check.** No P1 or P2 survived, so step 5 had nothing to re-check. The owner still re-read the leading finding, O11-P3-1, at 5c351a6b3: `src/ui/app/PwaUpdateWatcher.tsx:23` and the `VitePWA` block of `vite.config.ts`. They also checked that pnpm's dev inventory gives an installed path for each bundled package.

This is a trust boundary, but **no finding is an exploitable security issue**, so nothing is redacted.

## Findings

### O11-P3-1 — Workbox and vite-plugin-pwa code ships with no notice and outside the licence gate (fixed, #1814)

*Was the auditor's P2.* It is also rolling v2 11-P3-5 and website K5, still open in rolling v3 G8.

**Where:**
- `src/ui/app/PwaUpdateWatcher.tsx:23` imports `virtual:pwa-register/react`. That bundles vite-plugin-pwa's hook and `workbox-window` into the app.
- `vite.config.ts` runs `VitePWA` in its default `generateSW` mode. Workbox writes `workbox-<hash>.js` from workbox-core, -precaching, -routing, -strategies, -expiration and -cacheable-response 7.4.1.
- All of these are devDependencies, so `pnpm licenses list --prod` (both the notices and `scripts/check-licenses.mjs`) never saw them.

**Reproduction:**
- `grep -c -i workbox public/third-party-notices.txt` returns 0.
- Refuter A ran `generateSW` with the app's options: `workbox-271d3e69.js`, 21,777 bytes, 0 copyright or licence strings.
- A scratch Vite 6.4.6 build emitted `workbox-window.prod.es5-BBnX5xw4.js` with 0 comments.
- Both file names equal those in the committed build log (`docs/audits/2026-10-14-speed-fixes/build.log`), so the shipped files are the same.

**Oracles:**
- The packages' own LICENSE files: MIT, "Copyright 2018 Google LLC"; vite-plugin-pwa MIT, Anthony Fu.
- MIT's notice condition. **VERIFIED** ([SPDX MIT](https://spdx.org/licenses/MIT.html)).
- Terser's default `comments: 'some'` keeps only `/*!`, `@license`, `@preserve`, `@copyright` and `@cc_on` comments. **VERIFIED** (terser docs). Workbox's headers carry none of these.

**Refuter:** CONFIRMED, P2 → P3. No user gets a misleading result, and it was already a known P3.

**Fix (#1814, ADR-017 Amendment 3):**
- `BUNDLED_BUILD_PACKAGES` in `scripts/third-party-closure.mjs` is read from `pnpm licenses list --dev`.
- The generator reproduces each listed package's licence under "Development packages the build bundles into the app". It fails if a listed package is missing or installed at more than one version.
- `pnpm license-check` checks them too, so the root run reports "69 production … and 9 bundled build package(s)".
- Tests: bundled packages named with their text; fails closed when `workbox-core` leaves the install.

### O11-P3-2 — The desktop ships the phone's MCP view bundle, whose packages its notices do not name (fixed, #1814)

*Auditor A2 and B1 (B's P2).*

**Where:**
- `services/remote-control/scripts/build-app.mjs` writes `electron/mcp/workspace-app-ui.ts` (829,401 bytes) with `legalComments: 'none'`. It contains `@modelcontextprotocol/ext-apps` 2.0.3 and `@modelcontextprotocol/client` 2.3.1.
- `electron/tsconfig.json` compiles all of `electron/`, and every builder config ships `dist-electron/**/*`.

**Reproduction:** 242 ext-apps string literals appear in the bundle; 0 notice mentions.

**Refuter:** CONFIRMED-WITH-CHANGES, P2 → P3.
- The bundle is unreachable from `electron/main.ts`; `electron/packaged-runtime-closure.test.ts:65` shows this.
- ext-apps' and client's LICENSE files are byte-identical to `@modelcontextprotocol/server`'s (SHA-256 `0382b005…`), which the desktop notices reproduce in full. Only the package names were missing.

**Fix:**
- The client joins `BUNDLED_BUILD_PACKAGES`.
- ext-apps gets its own section in `DESKTOP_MCP_VIEW_PACKAGES`. It is pinned to the version `services/remote-control/package.json` names and to the shared LICENSE hash.
- Test: fails closed on version or hash drift.
- Whether this dead bundle should ship at all is listed for the maintainer.

### O11-P3-3 — The root notice generator drops NOTICE and COPYING files; the phone generator drops `LICENSE-*` (fixed, #1814)

**Where:**
- `scripts/third-party-closure.mjs` matched `/^licen[sc]e(?:$|[._-])/i`.
- `services/remote-control/scripts/generate-notices.mjs` matched `/^(?:licen[cs]e|copying|notice)(?:\.[a-z]+)?$/i`.

**Reproduction:** with a fixture holding LICENSE, NOTICE and NOTICE.md, `readPackageLicense()` returned only `["LICENSE"]`. A NOTICE or COPYING file with no LICENSE stopped the generator with an error.

**Exposure today:** none. No package in either production closure, nor any of the desktop allow-list packages at any depth, has a NOTICE it must carry. Refuter A ran an any-depth scan.

**Oracle:** Apache-2.0 §4(d). **VERIFIED** ([apache.org](https://www.apache.org/licenses/LICENSE-2.0)).

**Fix:** both generators use `/^(?:licen[sc]e|copying|notice)(?:$|[._-])/i`. A new test keeps NOTICE, COPYING and LICENSE-MIT.

### O11-P3-4 — The consolidated notices omit pdf.js's QCMS licence (fixed, #1814)

**Where:** `pdf.worker.min.mjs` ships pdf.js's QCMS JavaScript glue. The wasm does not ship, because the app runs with `useWasm: false`.

**Gap:** `wasm/LICENSE_PDFJS_QCMS` (and `LICENSE_QCMS`) shipped beside the code as `pdf-resources/wasm/LICENSE_*`, but `public/third-party-notices.txt` did not include them.

**Refuter:** narrowed. Only the pdf.js glue licence is arguably needed.

**Oracle:** `node_modules/pdfjs-dist/wasm/LICENSE_QCMS`, MIT. **VERIFIED**.

**Fix:** both files join the pdf.js resource sections.

### O11-P3-5 — `THIRD_PARTY_NOTICES.md` drifted from the licences and fonts it summarises (fixed, #1814)

*Auditor A5 and B4 merged, plus the doc remnant of A6.* This file ships as `legal/THIRD_PARTY_NOTICES.md`. Each claim was checked against the package's LICENSE on disk, the font's own `name` record, or the upstream licence. All are **VERIFIED**.

| Row | Said | Is |
|---|---|---|
| three | © 2010-2024 | © 2010-2025 three.js authors |
| bidi-js | Loov Communications | © 2021 Jason Johnston |
| clipper2-ts | ErikSom/Clipper2-ts | countertype/clipper2-ts; port by Jeremy Tribby |
| lucide-static | ISC | ISC plus MIT for the Feather-derived icons; website-only |
| MCP packages | Anthropic, PBC | Model Context Protocol a Series of LF Projects, LLC. |
| full texts | "ship in node_modules/<pkg>/LICENSE" | the web ships no node_modules; the generated notices carry them |
| Roboto | Copyright 2011 | Copyright 2015 Google Inc. |
| Inconsolata, Pacifico | no year | 2006, 2018 |
| Dancing Script | no RFN | Reserved Font Name "Dancing Script" |
| UnifrakturMaguntia | — | also © 2009 Peter Wiegel |
| Liberation Sans ×4 | missing | OFL-1.1, RFN "Liberation" (and "Arimo, Tinos and Cousine") |

`docs/architecture/01-stack-and-why.md:25` ("UNDECIDED — no ADR" for lucide) and an `icons.css` comment were also stale.

**Fix:** the rows were corrected, and a table of the bundled development packages was added.

### O11-P3-6 — The licence gate's allowlist drifts from ADR-017 policy 2 (partly fixed, #1814)

**Where:** `scripts/check-licenses.mjs` matches pnpm's raw `license` string exactly.

**Reproduction:** Auditor A ran the real gate against a fake `pnpm` that printed 15 crafted inventories.
- Every disallowed licence was rejected: GPL, LGPL, "SEE LICENSE IN", Unknown, UNLICENSED, `(MIT AND GPL-3.0)`. **The gate fails closed and has no bypass.**
- It also rejected:
  - standalone `Zlib`, which ADR-017 policy 2 approves;
  - `(MIT OR Apache-2.0)`, which policy 2's compound rule allows;
  - `(Apache-2.0 AND MIT)` with parentheses, though the unparenthesised form passes.
- Policy 2 says the licence "is verified against the package's actual LICENSE file". The gate reads only metadata. The notices generator does read the files, and all 93 current packages agree.

**Fix:** `Zlib` was added. The compound-expression parser and a text check inside the gate are listed for the maintainer.

### O11-P3-7 — Direct runtime dependencies without a RESEARCH_LOG row (listed; known)

This is rolling v2 24-P3-4, now one package wider. @csstools ×3, @modelcontextprotocol/server, zod, linkedom, saxes and **fflate** have no `RESEARCH_LOG.md` row, which ADR-017 policy 7 requires.

### O11-P3-8 — ADR-017's context still calls KerfDesk MIT (listed)

`DECISIONS.md:506` says "The project source code is MIT-licensed under ADR-120/247". `LICENSE` and ADR-543 Amendment 1 say all rights reserved. The policy itself is unaffected. This is ADR wording, so it is left for the maintainer.

### O11-P3-9 — MCP package metadata disagrees with the MCP LICENSE files (upstream; no action)

- ext-apps 2.0.3 declares `"license": "MIT"`, but its LICENSE is Apache-2.0 with retained MIT terms.
- core, server and client 2.3.1 declare Apache-2.0, but their LICENSE retains MIT.

Both generators reproduce the full LICENSE files, so the obligation is met.

### O11-P3-10 — The EMS stroke fonts' notices omitted their parent fonts' copyright lines (fixed, #1814)

*Was Auditor B's P2.*

**Where:** `scripts/third-party-closure.mjs` `CNC_STROKE_FONTS` credits Sheldon B. Michaels and Windell H. Oskay, and names the parent fonts without their copyright lines.

**Refuter:** CONFIRMED-WITH-CHANGES, P2 → P3.
- Upstream EMS `OFL.txt` (oskay/svg-fonts at 8c71f2d9) is the **unfilled template**, and its hash equals the pin. The SVG metadata has no copyright statement, so KerfDesk has nothing upstream to keep. **VERIFIED**.
- The parents are Nixie One (© 2011 Jovanny Lemonad), Petit Formal Script (© 2011 Impallari, Gallo, Fuenzalida, **RFN "Petit Formal Script"**) and Covered By Your Grace (© 2010 Kimberly Geswein). **VERIFIED** (google/fonts `ofl/*/OFL.txt`).
- Nixie One's font file also reserves "Nixie".
- No EMS name contains a reserved name, so OFL condition 3 holds.

**Fix:** the three parent copyright lines are added, and the Petit Formal Script RFN is noted as not used.

### O11-P3-11 — The Ruida swizzle follows MeerK40t statement for statement, but said "no code copied" (fixed, #1814)

**Where:** `src/core/controllers/ruida/swizzle.ts` `swizzleByte`/`unswizzleByte`, mirrored in `electron/ruida-network-wire.ts`. The comment said "clean-room reimplementation, no code copied".

**Reproduction:** Refuter B compared the code with `meerk40t/ruida/rdjob.py` at 7e82652f using 7-word shingles. It found 30 shared runs, and both functions are statement-for-statement identical to `swizzle_byte` and `unswizzle_byte` (rdjob.py:434-450). The other matches are opcode operands and mode names, which are protocol facts.

**Oracle:** MeerK40t is MIT. **VERIFIED** (github.com/meerk40t/meerk40t LICENSE).

**Why only P3:** MeerK40t's identical MIT text, `Copyright (c) 2021 meerk40t`, already ships twice, in the Lihuiyu and Moshi notes. Only the scope statement and an honest comment were missing.

**Fix:**
- `docs/licensing/meerk40t-ruida.txt` (scope plus the MIT notice) is included in the generated notices.
- The comments now say what was carried over.
- B's CH341 and JCZ parts were refuted: CH341 is already in the Lihuiyu note, and JCZ takes only USB IDs.

### O11-P3-12 — The phone's QR decoder is a ZXing port, and nothing credited ZXing (fixed, #1814)

**Where:** `@nuintun/qrcode` 5.0.3 (MIT, "Copyright (c) 2018 nuintun") is served to phones as the scanner fallback. Its Reed–Solomon and decoder code repeats ZXing's Java comments almost word for word, including a credit to "Steven Parkes" for a Hotspot-bug workaround. The package itself credits ZXing only as a README link.

**Oracle:** ZXing is Apache-2.0, © ZXing authors. **VERIFIED** (github.com/zxing/zxing).

**Refuter:** CONFIRMED (P3). It is attribution hygiene, and arguably an upstream packaging gap.

**Fix:** the phone notices generator adds an "Upstream origin" line for the package. The Apache-2.0 text already ships in that file, and the generator now checks that it does.

### O11-P3-13 — The global-agent patch is stale; upstream fixed it (fixed, #1815)

**Where:**
- `patches/global-agent@4.1.3.patch` restores `this.protocol === 'https:'` for TLS options, so electron-builder's `@electron/get` works through an HTTPS proxy.
- `pnpm-workspace.yaml` justified the override with GHSA-hp3w-g68c-fv3c.

**Facts:**
- gajus/global-agent#86 merged and shipped in 4.1.4 (2026-10-23); the latest release is 4.1.7 (2026-11-06). **VERIFIED** (npm registry and the installed `dist/classes/Agent.js:158`).
- The advisory was withdrawn on 2026-10-22. **VERIFIED** (GitHub advisory page and OSV).
- The patch never weakened TLS, and the package is build-only.

**Fix:** the override moves to 4.1.7, and the patch and `patchedDependencies` are removed. The lockfile diff touches only global-agent.

### O11-P3-14 — Toolchain minimatch is in an advisory's range (listed)

GHSA-g3hv-75wg-m249 (introduced 7.0.0, fixed 11.0.1; **VERIFIED**, OSV) covers:
- the root lock's minimatch 9.0.9 and 10.2.5;
- `services/remote-control`'s 10.2.6, which Refuter B found and Auditor B missed.

minimatch is in no production closure, so it is **not reachable** from anything shipped. The fix needs a major bump to 11, which the ESLint, glob and typescript-eslint chains do not yet accept. This is listed for the maintainer.

### O11-P3-15 — Electron 44.9.1 is seven patch releases behind 44.11.1 (listed)

- No advisory names 44.9.1. **VERIFIED**: OSV, and the Electron security advisories.
- The 44.10.1, 44.11.0 and 44.11.1 notes include backported Chromium fixes, such as a MediaStream use-after-free and a libxslt use-after-free. They carry no CVE ids.
- The renderer loads only `app.asar`, with the fuses set. Files the user opens are the only way in, so this needs local access.
- 44.11.1 is one day old, which is under pnpm's release-age threshold. A runtime bump also needs the packaging and installer qualification of a release.

Listed for the maintainer, for the first release after 1.0.32.

## Refuted

- **A6 — "lucide-static is a dead production dependency."** `website/lib/icons.mjs` inlines Lucide icons on kerfdesk.com, and the site ships `lucide-license.txt`. The dependency is live; only its docs were stale, and those went into O11-P3-5.
- Parts of B8 (CH341, JCZ) were refuted, as described under O11-P3-11.

## Verified clean

- **Licences of shipped packages (C1, C2, C12).**
  - All 69 root and 24 phone-service production packages: the field agrees with every top-level LICENSE, COPYING and NOTICE file and README licence section.
  - There is no copyleft, non-commercial, "Good not Evil" or BUSL text. The keyword hits are benign: argparse's PSF history, dompurify's MPL secondary-licence clause, and the Unlicense's "commercial or non-commercial".
  - Only lazy-val 1.0.5 and saxes 6.0.0 lack a licence file, and both have reviewed fallbacks.
  - Refuter A matched 12 random packages' texts to their fields.
- **The notices are complete and reproducible (C3).**
  - `node scripts/generate-third-party-notices.mjs --output <scratch>` is byte-identical to the committed file and covers 75/75 name@version pairs plus Electron.
  - The phone service's `generate-notices.mjs --check` passes, with 24 packages current.
  - All 18 desktop allow-list packages have sections, and the three builder configs carry identical allow-lists.
- **Fonts (C4).**
  - Every TTF's `name` record matches its spdx entry.
  - The calligraphy and Liberation fonts are SHA-256-pinned and unmodified; Vite emits them `?url` verbatim.
  - The full OFL-1.1 and Apache-2.0 texts ship in the PWA and the desktop notices.
  - No converted stroke font uses a parent's Reserved Font Name. **VERIFIED**: OFL-1.1 conditions 2 and 3, and OFL-FAQ 2.2/2.6.
- **Images and assets (C5).**
  - No ICC profile is embedded or written, and no firmware ships.
  - The eight OpenClipart SVGs match their pins. The detail pages and openclipart.org's share page state CC0. **VERIFIED**: 4 pages across the two checks.
  - Test fixtures (`e2e/`, the Noto Arabic fixture) are outside the build inputs.
- **Vendored and adapted code (C6).**
  - The PhotoCraft, Ostromoukhov, MeerK40t Lihuiyu and Moshi notes are accurate.
  - PackingSolver (`public/vendor/packingsolver/49bf6c7`) and HarfBuzz wasm match `scripts/offline-engine-assets.mjs`, including hashes taken from the git blob.
  - Nothing from Potrace, LaserGRBL, grbl, bCNC, UGS, K40 Whisperer, Inkscape or GIMP is in a runtime import.
- **The gate fails closed (C7).** All 10 bad expressions tried were rejected. CI runs it at `.github/workflows/ci.yml:125`, and for the phone service at `:218`.
- **Advisories (C8, C11).**
  - OSV found 0 advisories across 92 production versions, the desktop allow-list and electron 44.9.1.
  - A refuter and the verifier re-queried 21 and 26 versions, with js-yaml 4.1.0 and dompurify 2.0.0 as positive controls.
  - The `pnpm-workspace.yaml` comments that claim fixed versions match the lock.
- **Shipping truth (C9, C10).**
  - Both frozen installs are "Already up to date".
  - There are no git, tarball or URL resolutions, and the only patch is build-only.
  - Production `^` ranges are pinned by the lock.
  - Nothing is fetched from a CDN at runtime. The one exception is Paddle's checkout script on the standalone buy page, which Paddle requires.
  - The fuses and the Electron/Chromium licence files are required by the packaging checks.

## Contradicted (research)

None. Three wording corrections were applied, and none changes a verdict:
- terser also keeps `@copyright` comments;
- B7 missed 44.10.1 and 44.11.0;
- Liberation's licence literally reads "Reserved Font Arimo, Tinos and Cousine", with "Name" missing.

## Not verified

- The emitted `dist/web`, service worker and packaged `app.asar` were not built (the rules forbid it). O11-P3-1 rests on a scratch `generateSW` and Vite build, plus content-hash file names that equal those in the committed build log.
- The THIRD_PARTY_NOTICES.md claim that MCP metadata said MIT before 2.3.0. Older versions were not fetched.

## For the maintainer (not changed)

- **O11-P3-2:** whether `electron/mcp/workspace-app-ui.ts`, which is unreachable from the desktop main process, should ship in `dist-electron` at all.
- **O11-P3-6:** a real SPDX expression check in the gate (OR with one approved side, parentheses), and checking the LICENSE text, not just the metadata.
- **O11-P3-7:** RESEARCH_LOG rows for the eight packages named there.
- **O11-P3-8:** ADR-017's context paragraph wording.
- **O11-P3-14:** minimatch 11 across the ESLint, glob and typescript-eslint toolchain.
- **O11-P3-15:** Electron 44.11.1 (or newer) after 1.0.32, with the usual packaging qualification.

## Scratch artefacts

Auditor, refuter and research notes, with scripts and outputs, are outside the repository, in the session group's notes folder and the session scratchpad: `O11-auditor-A.md`, `O11-auditor-B.md`, `O11-refuter-A.md`, `O11-refuter-B.md` and `O11-research-verifier.md`.
