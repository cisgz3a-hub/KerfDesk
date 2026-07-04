# AUDIT.md — LaserForge 2.0 (post-Phase F.1)

> Professional audit, written 2026-05-28 after Phase F.1 (Fill mode)
> shipped, plus the canvas auto-zoom, Cmd+D duplicate, Frame-feed
> decoupling, input-focus shortcut fix, Cloudflare Pages deploy, and
> Electron 42 + Vite 6 + Vitest 3 + boundaries plugin v6 bumps.
>
> Findings are evidence-backed (file paths, line counts, command output),
> severity-rated, and labeled honestly:
> **VERIFIED** = passing tests OR observed on real hardware;
> **CLAIMED** = code looks right but I haven't proven it on hardware;
> **DEFERRED** = known gap, intentional, documented.
>
> Prior audits: `AUDIT-2026-05-26-phase-b.md`, `AUDIT-2026-05-27-phase-e.md`.
> See **External cross-checks** at the end for how each finding lines up
> against current (2026) Electron / React / OWASP / TypeScript / Vite /
> WebSerial / GRBL published guidance.

## Repo at a glance

| Metric | Value | Verdict |
|---|---|---|
| Total source LOC | 67 153 across 520 TS/TSX source files | ✅ compact enough for current scope |
| Total test LOC | 54 343 across 389 test files (~81% of source) | ✅ unusually high coverage density |
| Tests passing | **2420 / 2420** (`pnpm release:check`, 2026-06-28) | ✅ |
| Test files | 389 | ✅ |
| Production deps | 7 (clipper2-ts, dompurify, imagetracerjs, opentype.js, react, react-dom, zustand) | ✅ tight |
| **Dependency vulns** | **0** (`pnpm audit:deps`) | ✅ |
| Files over hard cap (400 counted LOC) | **0** | ✅ |
| Raw file-size backstop | **0 over 600 physical lines** | ✅ |
| ESLint errors | 0 | ✅ |
| ESLint warnings | 1 (boundaries plugin v6 legacy-selector — non-fatal) | ⚠️ |
| TypeScript strict | clean (no `any`, no `!`, no `eval`, no `innerHTML=`) | ✅ |
| `@ts-expect-error` in src | 1 (`trace-image.ts`, imagetracerjs untyped lib) | ✅ justified |
| Bundle (main JS, raw / gzip) | 972.93 KB / 291.01 KB | ⚠️ over Vite's 500 KB raw warning; under 1 MB compressed target |
| Bundle (fonts, lazy) | 1.08 MB across 4 .ttf files | ✅ loaded on demand |
| Web prod deploy | `https://laserforge-2fj.pages.dev` serves commit `2777513` with CSP+HSTS headers | ✅ live checked 2026-06-28 |
| Local release gate | `pnpm release:check` passes end-to-end | ✅ |

---

## Findings — severity-ordered

### A1 — ASAR fuses not flipped (no signed Windows build yet)

**Severity:** Medium for a future signed release; **N/A** for the current dev / web build.

**Evidence:** No `afterPack` hook in `package.json#build`, no
`@electron/fuses` config file in repo. Electron's own security checklist
flags this as a must-have for signed binaries (CVE-class: tampering with
the packaged ASAR to inject Node mode).

**Risk path:** Once a signed `.exe` ships, an attacker who modifies the
unpacked ASAR can flip `runAsNode` back on and gain Node access. With
fuses set the binary refuses to load.

**Fix path:** Add an `afterPack` step that calls
`@electron/fuses.flipFuses()` with:
```
runAsNode: false,
nodeOptions: false,
nodeCliInspect: false,
embeddedAsarIntegrityValidation: true,
onlyLoadAppFromAsar: true,
```
~30 LOC plus an electron-builder hook entry.

**Status:** DEFERRED until first signed release. Tracked here.

---

### A2 — WebSerial `port.forget()` never called on disconnect

**Severity:** Low. Privacy / hygiene rather than exploitable.

**Evidence:** `src/platform/web/web-serial.ts` handles `disconnect` events
(lines 11, 106, 126) and properly removes its listener, but never calls
`port.forget()`. The W3C/WICG spec exposes `forget()` specifically so a
page can revoke the in-page permission for a port the user is no longer
using.

**Risk path:** A long-running tab that's connected to several lasers
over a day accumulates per-port permissions in the browser's permission
store. The user has to clear them manually via browser settings.

**Fix path:** When the user clicks Disconnect (explicit), call
`port.forget()` after `port.close()`. Don't call on cable-yank
(`disconnect` event) — the user probably wants to plug it back in.

**Status:** **RESOLVED** — `web-serial.ts` close() now calls
`port.forget?.()` after `port.close()`. Optional chain because
forget() is Chromium 103+; older runtimes silently no-op rather
than throw. Cable-yank path is unchanged (goes through the
`disconnect` event, never reaches close()).

---

### A3 — gnea/grbl references should mention upstream is discontinued

**Severity:** Low — documentation freshness.

**Evidence:** `gnea/grbl` repo carries an explicit notice: "not received
new commits or accepted pull requests since Aug 30, 2019." 1.1h remains
the canonical streaming protocol but the project itself is dormant.
Active maintained forks: **grblHAL**, **FluidNC**, **µCNC**.

Three files still reference gnea/grbl as the live protocol authority:
- `PROJECT.md:342` — "GRBL v1.1 official docs (gnea/grbl wiki) — protocol authority."
- `RESEARCH_LOG.md:166` — `https://github.com/gnea/grbl/wiki`
- `RESEARCH_LOG.md:276` — describes `grbl` as the source, GPL-3.0

The wire protocol is still correct; the wording is just stale.

**Fix:** One-line addendum to each: "1.1h is the de-facto wire protocol;
actively maintained forks: grblHAL, FluidNC, µCNC."

**Status:** **RESOLVED** — RESEARCH_LOG.md GRBL protocol entry now
carries an explicit "Upstream status" line; the planner-references
section also flags grbl as archived. PROJECT.md:342 already had the
addendum; verified in this pass.

---

### A4 — Electron renderer loads via `file://` instead of `protocol.handle()`

**Severity:** Low. Defense-in-depth, no current exploit.

**Evidence:** `electron/main.ts:165` uses `window.loadFile(indexPath)`.
The 2026 Electron security checklist (item #18) recommends a custom
protocol via `protocol.handle()` instead, so the renderer runs under a
predictable origin (e.g. `app://`) rather than the special-case `file://`
that has historically had CSP and same-origin quirks.

Our existing CSP (set via `webRequest.onHeadersReceived` since F-9) gates
behavior more strictly than the `file://` quirks reach, so the practical
risk is small. Worth flagging.

**Fix path:** Register `app://` via `protocol.handle()` in `app.whenReady`;
change `loadFile` to `loadURL('app://./index.html')`. ~20 LOC.

**Status:** **RESOLVED** — `electron/main.ts` now registers `app` as a
privileged standard+secure scheme via `protocol.registerSchemesAsPrivileged`,
installs a `protocol.handle('app', ...)` mapping `app://app/<path>` onto
`dist/web/<path>` via `net.fetch(file://...)` for correct MIME inheritance,
and calls `loadURL('app://app/index.html')` instead of `loadFile`. Path-
traversal guard re-resolves every request and 404s anything escaping the
bundle root.

---

### A5 — typescript-eslint at `strict`, not `strict-type-checked`

**Severity:** Low. Type-aware lint rules would catch a class of bugs we
currently rely on review to catch.

**Evidence:** `eslint.config.mjs:78` spreads `tseslint.configs.strict +
stylistic`. The 2026 recommendation is `strict-type-checked` (the
type-aware variant), which enables:
- `no-floating-promises` (highest value for our serial I/O paths)
- `no-misused-promises`
- `no-unnecessary-condition`
- `no-unsafe-assignment` / `no-unsafe-call` / `no-unsafe-return`

We already pass `parserOptions.project: './tsconfig.json'` (line 89), so
type-aware rules are technically usable today. The upgrade is a one-line
change plus fix-the-flagged-issues work.

**Risk path:** Floating promises in `laser-store.ts` (the serial-write
path) would be a real foot-gun — a missed `await safeWrite(...)` would
let the streamer advance before bytes hit the wire. We don't have a
documented case but the rule would catch one if it appeared.

**Fix path:**
```
- ...tseslint.configs.strict,
+ ...tseslint.configs.strictTypeChecked,
```
Then run lint, audit each finding, fix or `eslint-disable` with comment.

**Status:** **RESOLVED (targeted variant).** A full `strictTypeChecked`
flip fights project conventions — that preset wants `!` non-null
assertions (which CLAUDE.md bans) and dot-notation that loses
`noUncheckedIndexedAccess`'s benefit. Instead, `eslint.config.mjs`
turns on the four high-value rules the audit specifically called out:
- `@typescript-eslint/no-floating-promises` (the big one — would have
  caught a missed `await safeWrite()` in laser-store)
- `@typescript-eslint/no-misused-promises` (async functions in sync
  signatures), with `checksVoidReturn: false` so React event handlers
  stay idiomatic
- `@typescript-eslint/use-unknown-in-catch-callback-variable`
- `@typescript-eslint/prefer-promise-reject-errors`
Lint now passes type-aware. Whole-preset upgrade tracked here as
future work if a class of bug surfaces those rules want.

---

### A6 — Bundle main chunk 972.93 KB raw (over the 500 KB warning)

**Severity:** Low. The gzip size is still well under the project's 1 MB
compressed target, but Vite's raw 500 KB chunk warning is active again.

**Evidence:** `pnpm release:check` on 2026-06-28 emits the main
`assets/index-*.js` chunk at **972.93 KB raw / 291.01 KB gzip**. Vite's
chunk-size warning fires at 500 KB raw.

**Current split:** opentype.js and imagetracerjs remain lazy chunks, but the
main app chunk has grown with route preview, machine setup, material library,
and workspace UI code.

**Mitigation paths:**
- Split heavy route-preview / material-library / machine-setup surfaces with
  dynamic imports where they are not needed for first paint.
- Add Rollup `manualChunks` for stable vendor and feature chunks.
- Re-check after route-preview UI stabilizes; do not trade correctness for a
  smaller initial chunk while this feature is still moving.

**Status:** **REOPENED / NON-BLOCKING**. The release gate passes, sourcemaps
remain disabled, and gzip size is below the project target. Keep this visible
for the next performance pass.

---

### A7 — UI layer test coverage still thin (acknowledged gap)

**Severity:** Medium — same finding as prior audits.

**Evidence:** Tests now span 49 files / 427 cases / 5572 LOC, but
`src/ui/laser/`, `src/ui/text/`, `src/ui/trace/`, `src/ui/workspace/`
remain mostly untested at the React-component level. Hardware verification
on the Falcon covers the integrated flow, but a UI-only regression (e.g.,
a `useEffect` that drops its cleanup) wouldn't be caught.

**What changed since prior audits:**
- `src/ui/app/shortcuts.test.ts` is new — 9 cases pinning the keyboard
  shortcut input-focus guard + Cmd+D duplicate + Shift+F fit-to-selection.
- `src/ui/state/store.test.ts` + `duplicate.test.ts` give the
  project-store actions 13 cases of coverage.

**What's still uncovered:**
- `LaserWindow`, `ConnectionBar`, `StatusDisplay`, `JogPad`, `JobControls`
- `AddTextDialog`, `FontPicker`
- `ImportImageDialog`, `TracePreview`
- `LayerRow` (incl. the new Fill sub-row)
- `Toolbar` (incl. the new BuildBadge)
- The workspace render-loop and drag-state React glue

**Verdict:** Same trade-off as before — jsdom + react-testing-library
setup is expensive; hardware verification + core/io test density is the
better risk/effort allocation at this stage. **Accepted gap, documented.**

---

### A8 — Hardware-claimed-not-verified inventory (Phase F.1 + recent)

**Severity:** Tracking, not a finding.

| Feature | Status | Evidence |
|---|---|---|
| Phase F.1 Fill mode | **CLAIMED** | 10 unit + property tests for fillHatching, compile-job dispatch tests; no real Falcon burn yet |
| Phase F.2 Image mode (a-e shipped) | **CLAIMED** | 12 dither tests + 20 emit-raster unit tests + 5 fast-check property tests + 9 draw-raster regression tests + scene-mutations + back-fill; **F.2.f hardware burn pending** — see WORKFLOW.md F-F2 acceptance checklist |
| F.2 raster perf (skip blank rows + clip active span) | **CLAIMED** | Added post-kickoff per user UX feedback; covered by `emit-raster.test.ts` unit + `emit-raster.property.test.ts` fuzz (100 seeds × 5 invariants). Banner-shaped images should now skip large white bands; needs the same Falcon burn before VERIFIED. |
| F.2 drawRasterImage transform fix | **CLAIMED** | Selection box and rendered image were drifting at scale != 1; fix in 3b9c4139 rewires the Canvas2D transform chain to mirror `applyTransform` exactly. Regression suite in `src/ui/workspace/draw-raster.test.ts` (9 cases) pins the convention. User-confirmed visually pre-deploy; not yet burned. |
| Post-trace large-scene responsiveness | **CLAIMED** | Audit in `audit/reports/image-scan-freeze-audit-2026-06-01.md`; bounded display-polyline cache + preview toolpath memoization covered by workspace/trace focused tests. No geometry/G-code simplification. |
| F.2.e UI card layout | **CLAIMED** | Cuts/Layers redesigned from horizontal 7-col table → vertical card-per-layer (93277657). Visually confirmed on the live site; no automated component-level tests (A7 accepted gap). |
| Frame feed decoupling | VERIFIED | User confirmed Frame works at speed after the change |
| Build badge | VERIFIED | Visible in DOM; defines confirmed inline in dist/web/assets/index-*.js |
| Canvas auto-zoom on import | CLAIMED | Logic tested via the new combinedBBox + zoomToBounds math; not verified on a real import workflow |
| Cmd+D duplicate | CLAIMED | Tests pin behaviour; no real-use confirmation yet |
| Cloudflare Pages auto-deploy | VERIFIED (with 2026-07-03 outage, fixed) | Secrets set; `workflow_run`-gated deploys have published for weeks. **Broke 2026-07-03** when the repo was renamed `LaserForge-2.0`→`KerfDesk` — `scripts/assert-correct-repo.mjs` rejected the new identity so every Deploy failed at `guard:repo` and production stalled at `d839c96`. Fixed same day: guard accepts both identities (allowlist) + KerfDesk regression test in `deploy-workflow-gate.test.ts` |
| Windows desktop installer + auto-update (ADR-024) | **CLAIMED** | `electron-updater` wired burn-safe (`electron/auto-update.ts` + 4 tests, never `quitAndInstall`); `release-desktop.yml` builds NSIS on `v*` tags → Cloudflare R2 feed; **built locally to a real 111 MB `…-x64-setup.exe` + valid `latest.yml`**; unsigned v1 (signing scaffolded, ADR-024 §5). Pending: the GitHub release run, R2 bucket hosting, and the Windows 10/11 install → serial-connect → auto-update pass (WORKFLOW.md "Desktop app" flows) |
| Set-origin from head position | DEFERRED — captured in PROJECT.md "Future feature notes" |

---

## What's working — verified inventory (unchanged from prior audit)

| Feature | Status |
|---|---|
| SVG import + parse + sanitize | VERIFIED |
| Workspace render + select + drag + scale + rotate | VERIFIED |
| Cuts/Layers panel + per-color params | VERIFIED |
| G-code compile + emit | VERIFIED |
| Connect (`$$` handshake) | VERIFIED |
| Home (`$H`) | VERIFIED |
| Auto-focus (`$HZ1`) | VERIFIED |
| Jog | VERIFIED |
| Frame (with bed-bounds preflight) | VERIFIED |
| Start job (char-counted buffer streaming) | VERIFIED |
| Job progress reporting | VERIFIED |
| Job time estimate (planner-aware) | VERIFIED |
| Path optimization (nearest-neighbor) | VERIFIED |
| Autosave + recovery | VERIFIED |
| Settings panel (now collapsible) | VERIFIED |
| Keyboard shortcuts (now input-focus-safe) | VERIFIED |
| SVG re-import diff | VERIFIED |
| Text-to-path (4 fonts) | VERIFIED |
| Image trace (imagetracerjs) | VERIFIED |
| F-7 auto-detect machine settings | VERIFIED |
| Visible zoom controls | CLAIMED — built in this session, not yet user-confirmed on hardware |
| Input-focus shortcut fix | VERIFIED — tests pin the regressions + user confirmation |

---

## External cross-checks — 2026 published references

### 1. Electron security checklist (electronjs.org/docs/latest/tutorial/security)

> Must-haves 2026: contextIsolation, nodeIntegration:false, sandbox:true,
> webSecurity:true, CSP via webRequest, deny-by-default permission
> handlers, `event.senderFrame` validation on every IPC, ASAR fuses
> flipped, custom protocol.handle() instead of file://.

**Us:**
- ✓ All four webPreferences set (`electron/main.ts:37-41`)
- ✓ CSP via `session.webRequest.onHeadersReceived` (F-9 fix)
- ✓ Permission handlers narrowed to `'serial'` + `'fileSystem'` prefixes
- ✓ **No IPC handlers exist** — grep `ipcMain` returns 0 hits, so
  the sender-validation rule is vacuously satisfied.
- ✗ ASAR fuses — **A1**
- ✗ `protocol.handle()` — **A4**

CVE-2026-34769 (command-line switch injection): Electron 42.3.0 patches
it — we're on 42.3.0. ✓
CVE-2026-34780 (VideoFrame preload bypass): patched in 42.3.0, and we
don't use WebCodecs. ✓

### 2. React 18+ patterns (react.dev — "You might not need an effect")

> Must-haves: StrictMode at root; cleanup on every external-resource
> effect; useSyncExternalStore for external stores; don't mirror props
> into state-via-effect.

**Us:**
- ✓ StrictMode wraps the root (`main.tsx:18`)
- ✓ Zustand provides its own `useSyncExternalStore` integration
- ✓ `use-autosave.ts` returns its cleanup; `useGlobalErrorHandlers`
  returns its removeEventListener pair; `use-shortcuts.ts` cleans up
  both keydown listeners.
- ✓ The serial connection is NOT useEffect-owned — driven by
  user-clicks on Connect/Disconnect — so StrictMode's double-mount
  doesn't double-open the port.

### 3. OWASP Desktop App Security Top 10

**Status check:** Still the 2021 release as of 2026-05-28 — no 2025/2026
revision exists. The November 2025 OWASP Top 10 release is web-only.

**DA1 Injections** — DOMPurify on SVG; `parseFloat` (not `eval`); type
guards on `.lf2` deserialize; G-code emit only formats numbers it
controls. ✓
**DA2 Authentication** — N/A (no auth).
**DA3 Sensitive Data Exposure** — local-only; no telemetry; autosave to
localStorage. ✓
**DA4 Cryptography** — N/A (no crypto).
**DA5 Authorization** — All grants allowlisted ('serial' + 'fileSystem');
strict CSP. ✓
**DA6 Misconfig** — Open: **A1** (fuses) + **A4** (protocol.handle).
**DA7 Communication** — N/A (no network).
**DA8 Code Quality** — Strict TS, no `any` or `!`, license-check in CI,
file-size cap in CI. ✓
**DA9 Components w/ Known Vulns** — `pnpm audit` 0/0/0/0. ✓
**DA10 Logging** — LaserLog panel + ErrorBoundary clipboard export. ✓

### 4. TypeScript anti-patterns (typescript-eslint current rules)

> Recommended: `strict-type-checked` config covers `no-floating-promises`,
> `no-misused-promises`, `no-unnecessary-condition`, `no-unsafe-*`.

**Us:** ✗ on `strict` not `strict-type-checked` — **A5**.
Beyond that: zero `any`, zero `!` (grep-verified) outside test scaffolding.
`@ts-expect-error` appears 1× with comment justification. `as Foo`
casts limited to: imagetracerjs API boundary (3×), KnownFontKey narrowing
post-validity-check (1×). ✓

### 5. Vite 6 production (vite.dev)

> Must-haves: `base` explicit; CSP-compatible nonce or hash strategy;
> assetsInlineLimit acknowledged; CSS code-splitting on by default;
> modulepreload allowed in CSP.

**Us:**
- ✓ `base: './'` set
- ✓ `script-src 'self'` allows the entry script and Vite's emitted
  modulepreload
- ✓ Default assetsInlineLimit (4 KB); the fonts in `dist/web/assets/`
  are above the limit so they're not data-URI'd
- ✓ Source maps: `sourcemap: true` is set; the `.js.map` is in
  `dist/web/assets/` and Cloudflare serves it. Acceptable for a private
  proprietary app whose primary deployment audience is the owner
  (Cloudflare access logs aren't a leakage concern). Flag for
  consideration if the URL ever goes public.

### 6. WebSerial spec (wicg.github.io/serial)

> Still WICG CG Report; permissions persist per origin until profile
> clear; call `forget()` to revoke in-page; handle `disconnect` for cable
> yanks.

**Us:**
- ✓ `disconnect` handled (`web-serial.ts:11, 106, 126`)
- ✗ `forget()` not called — **A2**
- ✓ Per-launch re-grant via `setDevicePermissionHandler` in Electron

### 7. GRBL streaming (gnea/grbl wiki + grblHAL)

> gnea/grbl repo discontinued (no commits since Aug 2019). 1.1h is
> the de-facto wire protocol. Maintained forks: grblHAL, FluidNC, µCNC.

**Us:**
- ✓ Streaming logic matches 1.1h spec exactly (character-counted
  127-byte buffer, RT_STATUS/HOLD/RESUME, ALARM mapping)
- ✗ Doc references should mention discontinued status — **A3**

### 8. Sonny Jeon's grbl planner (2014 derivation)

**Us:** `src/core/job/planner.ts` writes the canonical junction-deviation
formula. Empirically: ±10s on real burns. ✓

### 9. imagetracerjs anti-aliasing (issue #15)

> Maintainer-acknowledged: pre-binarize the input before tracing.

**Us:** `thresholdToMonochrome` does exactly that, shipped in the Phase
E.2 audit-fix. ✓

---

## Verdict (post-Phase F.1)

**Ship-ready** for the proprietary / private use case.

Open items by priority:
1. **A1** ASAR fuses — block on first signed release.
2. **A5** typescript-eslint `strict-type-checked` — small focused PR, real value for serial I/O.
3. **A2** WebSerial `forget()` — 5-line addition.
4. **A4** custom protocol — defense-in-depth, defer.
5. **A3** doc freshness on gnea/grbl status — 3-line addendum.
6. **A7** UI test coverage gap — accepted.
7. **A6** bundle weight — acceptable, address if first-launch perf degrades.
8. **A8** F.1 hardware verification — engrave a square + letter "O" on the Falcon.

**No critical, no high-severity issues open.** Every architectural
pillar from PROJECT.md non-negotiables is satisfied. The 2026 external
cross-check found two new advisory items (CVE-2026-34769 / 34780) that
are already patched by our F-2 bump to Electron 42.

---

## Re-audit (2026-05-28 — independent second pass)

The first pass above used the same author. This second pass was done by
an independent agent that did NOT read AUDIT.md until after forming its
own findings. New findings below — three of them are concrete bugs the
first pass missed.

### R-H1 — `useTracePreview` decoder effect uses stale options (HIGH, functional bug)

**Evidence:** `src/ui/trace/use-trace-preview.ts:44-75`. The file-effect
captures `options` from closure but only depends on `[file]`. The first
`runTrace(img, options, setState)` after a decode uses whatever `options`
was at the render that fired the effect — not the live current value.
The dropped-dep is a known react-hooks/exhaustive-deps catch (see R-H4).

**Risk path:** User opens dialog, changes preset to "Photo," picks a PNG.
First trace renders with whatever preset was current when the effect was
queued — usually "Line Art" (the default). Preview lies; user submits
the "wrong" trace.

**Fix:** Use a ref to read the latest `options` inside the file-effect
without re-running the effect on every options change. ~4 LOC.

**Status:** **FIX THIS SESSION.**

### R-H2 — `resumeJob` / `stopJob` race against ack-driven state updates (HIGH, safety-relevant)

**Evidence:** `src/ui/state/laser-store.ts:265-274` (resume) and 275-279
(stop). Both do `await safeWrite(...)` then `const s = get().streamer`
then `set({ streamer: ... })`. During the await, GRBL's ack stream feeds
`handleLine` → `advanceStream` → onAck/step → `set`, which mutates
streamer state under our feet. Our subsequent `set({ streamer: stepped })`
clobbers those concurrent updates with a state derived from the stale
snapshot.

**Risk path:** The streamer's `inFlight` / `inFlightBytes` accounting
drifts vs reality. If accounting underestimates inFlight bytes (because
the ack that already landed was overwritten), `step()` could push more
bytes into the 127-byte GRBL serial buffer than fit → GRBL drops bytes
mid-command → unpredictable head moves or stuck job with laser still on.
A genuinely safety-relevant bug on a laser.

**Fix:** Use Zustand's functional `set((s) => ...)` form so the read
happens at the moment of write. Pattern:
```ts
set((s) => {
  if (s.streamer === null) return s;
  const stepped = step(resumeStreamer(s.streamer));
  toSend = stepped.toSend;
  return { streamer: stepped.state };
});
```

**Status:** **FIX THIS SESSION** — highest priority.

### R-H3 — Public sourcemaps leak full proprietary source over Cloudflare (HIGH, IP exposure)

**Evidence:** `vite.config.ts:47` sets `sourcemap: true`. The 2 MB
`dist/web/assets/index-*.js.map` contains `sourcesContent` for ~120
source files (every `.ts` in `src/`, plus resolved pnpm paths for our
deps). Cloudflare Pages serves it with `Cache-Control: public,
max-age=31536000, immutable`.

**Risk path:** The project is **proprietary, All Rights Reserved
(ADR-018)**. The Cloudflare URL is **public**. Anyone who hits
`laserforge.pages.dev/assets/index-*.js.map` gets the full TS source
including planning comments, vendor-quirks notes, audit-fix annotations.
First-pass audit acknowledged this as "acceptable for a private
proprietary app" — that wording mis-frames the situation: the *repo* is
private, the *deploy URL* is public. These are different things.

**Fix:** `build.sourcemap: false` in `vite.config.ts`. Sourcemaps are
useful only for error trackers (Sentry-class) we don't run. If we add
one later, switch to `'hidden'` and upload maps server-side.

**Status:** **FIX THIS SESSION.**

### R-H4 — `eslint-plugin-react-hooks` installed but never wired (MEDIUM)

**Evidence:** `package.json:56` lists `eslint-plugin-react-hooks ^5.0.0`
in devDependencies. `eslint.config.mjs` does not import or enable it
(`grep -c react-hooks eslint.config.mjs` = 0). The exhaustive-deps rule
would have flagged R-H1 at lint time.

**Fix:** Add to `eslint.config.mjs`:
```js
import reactHooksPlugin from 'eslint-plugin-react-hooks';
// in plugins: { 'react-hooks': reactHooksPlugin },
// in rules:   'react-hooks/rules-of-hooks': 'error',
//             'react-hooks/exhaustive-deps': 'warn',
```

**Status:** **FIX THIS SESSION.**

### R-H5 — Deploy workflow lacks gating on CI (MEDIUM)

**Evidence:** `.github/workflows/deploy.yml:34` sets `needs: []` with a
comment explicitly noting CI and deploy run in parallel; a commit that
fails tests/lint but builds will publish. The workflow's own preamble
("Runs on every push to main AFTER CI has had a chance") contradicts
this.

**Risk path:** A commit that breaks the streamer's char-buffer math but
passes `vite build` ships to production. Next user to connect their
laser gets the broken streamer.

**Fix:** Trigger via `workflow_run` against CI's success:
```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success' || github.event_name == 'workflow_dispatch'
```

**Status:** **FIX THIS SESSION.**

### R-M1 — Dialogs lack Escape close, focus trap, and `aria-modal` (MEDIUM, a11y)

**Evidence:** `AddTextDialog.tsx:60` and `ImportImageDialog.tsx:62` render
`<div role="dialog" aria-label="...">` with:
- no `aria-modal="true"`
- no Escape handler at the dialog level
- no focus trap (tabbing reaches Toolbar buttons under the backdrop)
- no return-focus on close

Keyboard-only and screen-reader users can't dismiss without clicking
Cancel; focus escapes the modal.

**Fix:** Add `aria-modal="true"`, an `onKeyDown` on the form calling
close() for Escape, and trap focus to the dialog while open. ~30 LOC.
Separate session — needs a small focus-trap utility (~50 LOC) which is
worth its own module + tests.

**Status:** **RESOLVED** — `src/ui/common/use-dialog-a11y.ts` ships a
reusable hook handling all four behaviours (Escape → onClose, Tab /
Shift+Tab focus cycle, initial focus on mount, return focus on
unmount). Both dialogs now pin `aria-modal="true"`, `tabIndex={-1}`
on the dialog root, and `useDialogA11y(ref, close)`. WCAG 2.1 dialog
pattern compliance.

### R-L1 — Toast `setTimeout` not tracked across manual dismiss (LOW)

**Evidence:** `src/ui/state/toast-store.ts:39`. Timers are fire-and-forget.
On manual dismiss the timer still runs and no-ops at fire time.

**Status:** **TRACKED** — harmless; cleanup adds ~10 LOC.

### R-L2 — `runHandshake` busy-waits on Date.now (LOW, code smell)

**Evidence:** `src/ui/state/laser-store.ts:319-322` polls with 50 ms
loop instead of `Promise.race([... timeout])`. Fine in prod, brittle
under fake-time testing.

**Status:** **RESOLVED** — `laser-line-handler.ts` now races a single
deadline `setTimeout` against a one-shot `onLineArrived` callback that
`handleLine` fires the moment any line lands. No `Date.now()` reads,
no 50 ms poll loop. Event-driven; clean under `vi.useFakeTimers`.

### R-L3 — `URL.createObjectURL` cleanup correct but brittle (NOTE)

**Evidence:** `src/ui/trace/image-loader.ts:23-39`. The `finally`-revoke
is fine. Document this so a future refactor doesn't drop it.

**Status:** **RESOLVED** — `image-loader.ts` now carries a doc comment
on the createObjectURL / revokeObjectURL pairing explicitly flagging
this as load-bearing for refactors.

### Comparison: where the first-pass audit was over- or under-rated

| Original | Re-audit verdict | Why |
|---|---|---|
| A1 ASAR fuses (Medium) | Still Medium but **DEFERRED status mis-uses severity field**. Should be a tracked future-task note, not a finding. | First pass conflated present state with hypothetical-future risk. |
| A4 `protocol.handle()` (Low) | Closer to **Note** — pure defense-in-depth on top of a strict CSP. |  |
| **Vite sourcemap** | First pass buried this in External-cross-check #5 as "acceptable" — **R-H3 elevates it to HIGH** given the proprietary license + public URL. | First-pass missed that "private repo" ≠ "private deploy URL." |
| A7 UI test gap (Medium) | Accurate, but **didn't note `react-hooks` plugin would catch a chunk of those issues at lint** — R-H4. |  |

### Re-audit verdict

First-pass audit was correct in its broad assessment (no critical or
high security findings) but missed three concrete bugs and one IP-exposure
issue. After fixing R-H1/R-H2/R-H3/R-H4/R-H5 this session, the project
returns to ship-ready.

---

## How this audit was produced

Verified locally:
- `pnpm release:check` → guard, typecheck, lint, electron lint, format check,
  license check, dependency audit, 2420 tests, web build, electron build, and
  file-size backstop all green
- `grep`-counted: `any`, `!`, `eval`, `innerHTML=`, `ipcMain`, `Math.random` / `Date.now` / `fetch(` / `window.` in `src/core/`
- `wc -l` against every source file vs the 250/400 caps
- `pnpm exec wrangler pages deployment list` → confirmed production deploy serves commit `2777513`
  over HTTPS+HSTS/CSP headers at `https://laserforge-2fj.pages.dev`

Cross-checked via WebFetch / WebSearch against:
- `electronjs.org/docs/latest/tutorial/security` (security tutorial #1–18, fuses tutorial)
- `react.dev/learn/you-might-not-need-an-effect`, `react.dev/reference/react/StrictMode`
- `owasp.org/www-project-desktop-app-security-top-10/` + repo `index.md`
- `typescript-eslint.io/rules/`, `typescript-eslint.io/users/configs`
- `vite.dev/guide/build`, `vite.dev/guide/features`
- `wicg.github.io/serial/`
- `github.com/gnea/grbl/wiki`, `github.com/grblHAL/core`, `advisories.gitlab.com/pkg/npm/electron/`

Findings I could NOT verify against primary sources and therefore did
not include: a "renderer kill switch" in Electron 42 (no current docs
support), a 2025/2026 OWASP Desktop Top 10 (doesn't exist), a
maintained MIT-licensed JS GRBL streamer outside CNCjs.

---

## Documentation re-audit (2026-05-28, third pass)

Triggered by user request to verify the spec files still match the
code. Run by an independent agent; verified by reading the cited
file:line evidence. **No code findings** beyond what the re-audit
already covered — the doc layer had slipped during the fast Phase F.1
iteration. Every finding below is FIXED in this same commit unless
marked TRACKED.

### D-Critical

- **D-H2 `package.json` license field** — said `"license": "MIT"`
  even though ADR-018 made the project proprietary. License appears
  in every SBOM and npm-related tool; the contradiction with the
  LICENSE file was a real legal-metadata bug. **FIXED:** changed to
  `"SEE LICENSE IN LICENSE"`, description rewritten.

### D-High

- **D-H1 README.md "Pre-development. No code yet."** — totally
  stale; project is post-Phase-F.1 with 12,539 source LOC and a live
  deploy. **FIXED:** Status section rewritten.
- **D-H3 ADR count** — README said 17 ADRs; actual is 19
  (001..019, with ADR-018 superseding ADR-008). **FIXED.**
- **D-H4 README "Five spec files"** — omitted AUDIT.md from the
  project-document table. **FIXED:** AUDIT.md added as a sixth row.

### D-Medium

- **D-M1 CONTRIBUTING.md preamble** said "in pre-development …
  placeholder." **FIXED** — rewrote intro paragraph to reflect that
  CI gates and deploy workflow are live.
- **D-M2 WORKFLOW.md header** said "Phase A complete. Phase B/C/D/E
  sections are stubs." Phase B is now fully fleshed out and Phase
  F.1 has F-F1. **FIXED** — header re-stated.
- **D-M3 RESEARCH_LOG umbrella stack** versions were stale (vite 5,
  vitest 2, no electron/wrangler rows). **FIXED** — table refreshed
  to match package.json + added 4 entries to the Re-verification log.
- **D-M4 PROJECT.md security posture** said
  `setPermissionRequestHandler returns false except for 'serial'`.
  Actual code (`electron/main.ts`) also accepts `fileSystem*` after
  commit `2965bd0`. **FIXED.**
- **D-M5 imagetracer.js typo** — appeared in PROJECT.md (×2),
  DECISIONS.md (×2), README ack section. The actual npm package is
  `imagetracerjs` and its license is Unlicense, not MIT. **FIXED**
  everywhere.
- **D-M6 gnea/grbl status** — A3 finding from the prior audit was
  still open. **FIXED:** PROJECT.md + RESEARCH_LOG Re-verification
  log both now mention the archive status + the active forks
  (grblHAL, FluidNC, µCNC).
- **D-M7 WORKFLOW.md Cmd+D tag** said "(Phase C)" — feature shipped
  as commit `32f30ca`. **FIXED:** retagged as shipped, with the
  related Cut/Copy/Paste lines clarified as not-implemented.
- **D-M8 DECISIONS.md "Phase A fixture corpus" open item** — Phase
  A shipped; item should be marked done. ✅ **RESOLVED** — both
  open items in DECISIONS.md "Open items" now struck through with
  the corresponding evidence (fixture files + bundled font list).

### D-Low / Note

- D-L1 PROJECT.md Brave issue stamp — ✅ RESOLVED. Re-verification
  date appended ("status last re-verified 2026-05-28 — still open").
- D-L2 README pnpm script list incomplete — **FIXED:** added
  `lint:fix`, `format`, `format:check`, `license-check`,
  `deploy:web:preview`.
- D-L3 RESEARCH_LOG Re-verification log empty — **FIXED** (added
  four entries this pass).
- D-L5 Anchor links — verified, OK.
- D-L6 AUDIT.md size — borderline, intentional.

### Code spot-check (B-N findings from the agent's Part B)

- **B-N1 laser-store.ts at 399/400** — one line shy of the hard cap.
  TRACKED — will split when the next edit lands (per CLAUDE.md
  "stop and split before continuing"). No actionable code change
  this session.
- **B-N2 no new test gaps** — every post-AUDIT commit added or
  updated tests.
- **B-N3 no new `any` / `!` / `@ts-ignore`** in modified files.
- **B-N4 vacuous assertions scan** — none. Three `toBeDefined()`
  calls are all followed by stronger assertions + nullable handling.
- **B-N5 R-H1 fix dep omission has prose comment, not directive** —
  Low; left as-is.

---

## MIT-comparison audit (2026-05-28, fourth pass)

User asked whether our wrapper / use of each MIT-compatible library is
as good as or better than upstream. Independent agent compared each
wrapper against the upstream source via WebFetch. Five sections;
three fixes shipped this same commit, four items TRACKED.

### Library-by-library verdict

| Library | Where we use it | Verdict |
|---|---|---|
| DOMPurify | `src/io/svg/sanitize.ts` | **Parity, slight edge** (removeAllHooks bracketing isn't documented upstream and is the safer pattern) |
| Raster emit (vs LightBurn / LaserGRBL behaviour) | `src/core/raster/emit-raster.ts` | **Parity** — we skip blank rows + clip active spans (LightBurn calls this "image bounds optimization", LaserGRBL does similar pre-scan trimming). Reference: behaviour-only, no code copied (LaserGRBL is GPL-3 per ADR-017; LightBurn is closed-source so we only match the visible G-code shape). Our property tests fuzz the laser-off-on-travel and bounds invariants 100×; both LightBurn and LaserGRBL handle these but their test discipline isn't observable. Counts as parity with a slight edge on test rigour. |
| opentype.js | `src/core/text/text-to-polylines.ts` | **Behind on ligatures (FIXED); ahead on closure detection** (our `CLOSURE_EPS_MM` is something upstream itself should ship) |
| imagetracerjs | `src/core/trace/trace-image.ts` | **Ahead** — `thresholdToMonochrome` is a real novel addition; our presets are tuned per-domain |
| CNCjs streamer | `src/core/controllers/grbl/streamer.ts` | **Parity on math, off-by-7 on buffer-margin (FIXED)** |
| Sonny Jeon planner | `src/core/job/planner.ts` | **Parity** — formula, lookahead order, edge cases all match the canonical derivation |

### Fixed this commit

- **MIT-1 — opentype.js ligatures (`text-to-polylines.ts:154`).** Was
  missing `features: { liga: true, rlig: true }` on the `getPath` call.
  v2 defaults kerning on but ligatures off. Real visual regression vs
  Inkscape / CorelDRAW: "fi" / "fl" came out as two separate glyphs
  instead of the designer's ligature. Added explicit features + kerning
  flag. ~3 LOC.
- **MIT-2 — GRBL streamer buffer 127 → 120 (`streamer.ts:16`).** CNCjs
  uses 120 bytes (8-byte safety margin on GRBL's 128-byte RX buffer);
  we used 127 (1-byte margin), which is conservative enough most of
  the time but lacks headroom for senders that occasionally add CR/LF.
  Matches CNCjs's documented practice. No observed bug — preventive.
- **MIT-3 — Fill preview overlay (`draw-scene.ts`).** Not from the
  library audit per se, but the same session's user ask. When a layer
  is in Fill mode, draw the actual hatch lines (via the same
  `fillHatching` compileJob uses) over a faint dashed outline guide.
  LightBurn pattern. WYSIWYG; what the user sees is what the G-code
  emits.

### TRACKED for follow-up

- **MIT-T1 — Streamer disconnect state.** `StreamerStatus` is
  `idle | streaming | paused | done | cancelled`. CNCjs treats
  disconnect as a controller event that destroys the streamer; we
  have no `'disconnected'` status, so a mid-stream port drop leaves
  the consumer without a clean way to mark in-flight lines as lost.
  Add `'disconnected'` and an `onDisconnect()` reducer in the next
  laser-store edit (laser-store.ts is currently at 399/400 LOC — the
  next edit should split it anyway).
- **MIT-T2 — Status-poll cadence backoff.** Today we poll status at
  250 ms regardless of streamer state. CNCjs uses a longer cadence
  when idle. Bump to ~1000 ms when no streamer is active; keep 250 ms
  while streaming. Low priority — current load on GRBL is fine.
- **MIT-T3 — `pathOmit: 16` fixture test.** ✅ RESOLVED.
  `trace-image.test.ts` now ships a 40×40 fixture with a 24×24 body
  + a 4×4 corner dot; asserts a polyline whose centroid lies in the
  dot region exists in the trace output. Guards against a future
  preset tweak dropping small features.
- **MIT-T4 — DOMPurify `SAFE_FOR_XML` reliance.** ✅ RESOLVED. The
  sanitize.ts header now documents the deliberate reliance on the
  upstream `true` default so a future reader knows not to flip it.
- **MIT-T5 — opentype.js RTL.** ✅ RESOLVED. `text-to-polylines.ts`
  carries a known-limitation note covering Hebrew/Arabic ordering
  + Arabic shaping; full fix would need the Unicode Bidirectional
  Algorithm and is parked.

### Process note

This is the second time an independent agent has caught fixable bugs
the same-author audit missed (first time: R-H2 race condition; this
time: opentype.js ligatures + streamer buffer margin). The
independent-second-pass pattern is paying off. Keeping it as standard
practice for future audits.

---

### Verdict after this pass

**Ship-ready.** Critical license-metadata inconsistency closed.
13 doc items refreshed; one TRACKED. Code itself was clean coming in
and stays clean — 429/429 tests, 0/0/0/0 vulns, 1 file at exactly the
soft cap, 1 file (laser-store) at 399 lines (one shy of hard cap,
flagged for pre-emptive split next edit). Karpathy principles
preserved: every change carried evidence, single-responsibility, and
verifiable verdicts.

## CNC router mode verification (Phase H — ADR-098, 2026-07-02)

Tracks the hardware-verification state of every CNC-output-affecting
feature. Statuses follow the house convention: **VERIFIED** = proven on
the 4040 via the standing air-cut protocol (ADR-098), **CLAIMED** = tests
pass but no hardware evidence, **DEFERRED** = intentional documented gap.

### Standing 4040 air-cut protocol (from ADR-098)

Home → clamp scrap / set work XY zero → set Z zero ~30 mm above the
spoilboard (air gap) → feed override 50% → run the job end-to-end →
verify: retract before every travel, pass ordering (pockets/engraves
before profiles, inner before outer), spindle spin-up dwell before first
plunge, correct park. Log the result here; only then flip CLAIMED →
VERIFIED.

### Inventory

| Feature | Status | Evidence |
|---|---|---|
| CNC MVP (profile/pocket/engrave, depth passes, tabs, spindle/Z GRBL, preflight) — `032d476` | **CLAIMED** | Full suite green (2595 tests at audit time); parity audit `audit/reports/cnc-easel-parity-audit-2026-07-02.md`; no 4040 run yet |
| Plunged-travel invariant (`findPlungedTravelIssues`) | **CLAIMED** | Unit + property tests; enforced in CNC preflight |
| H.1 pass-model union + overdeep-cut invariant | **CLAIMED** | 2026-07-02: unit + 100-seed properties (emitter × motion/depth invariants); snapshots byte-identical |
| H.2 simulation + stock model | **CLAIMED** | 2026-07-02: simulator ≡ emitter property (100 seeds); pocket IoU ≥ 0.98 perceptual; full suite 2627 green. Sim-vs-machine side-by-side air-cut still pending (maintainer) |
| H.3 V-carve | **CLAIMED** | 2026-07-02: perceptual pyramid-field match (max err ≤ δ+2·cell, IoU ≥ 0.97); 100-seed properties; G-code snapshot; suite 2639 green. Air-cut + MDF caliper check (groove width = 2·depth·tan(θ/2)) pending (maintainer) |
| H.4 STL import + heightmap + relief object | **CLAIMED** | 2026-07-02: 17 focused tests (parser corpus + round-trip property; heightmap vs analytic pyramid/ramp; .lf2 round-trip + rejection); full suite 2656 green. Not output-affecting — no air-cut applies; canvas depth-map appearance not yet visually reviewed |
| H.5 relief roughing | **CLAIMED** | 2026-07-02: marching-squares cases + 100-seed closed/deterministic property; no-gouge vs dilated target; depth-major ordering; compile→emit invariant-clean + G-code snapshot. Air-cut + foam/MDF terrace cut pending (maintainer) |
| H.6a DXF import (clean-room) | **CLAIMED** | 2026-07-03: tag/entity/spline/INSERT unit corpus + ACI color table tests; drag-drop verified in isolated preview (LINE/ARC/LWPOLYLINE-bulge/SPLINE render at correct mm scale). Not output-affecting beyond existing vector pipeline; DXF air-pass pending (maintainer) |
| H.6b .nc re-import → simulator | **CLAIMED** | 2026-07-03: modal-parser unit corpus (G0/1/2/3 IJ+R, G90/91, G20/21, M2/30); re-import parity test pins removal-grid IoU ≥ 0.98 vs the native compile. Read-only preview path — no G-code emitted; simulator-vs-machine check pending (maintainer) |
| H.6c CNC text defaults | **CLAIMED** | 2026-07-03: new-layer-only defaulting (v-carve when a v-bit is active, else engrave) pinned by unit tests; existing layers untouched. PROVISIONAL semantics — maintainer review |
| ADR-101 gate-and-hide (laser⇄CNC UI separation) | **CLAIMED** | 2026-07-03: command-registry gate tests both directions + hidden-panel tests; noun-aware labels checked in isolated preview. UI-only — no G-code path touched |
| Relief on-canvas param editor (width/depth/background) | **CLAIMED** | 2026-07-03: aspect-locked rescale + background-mode unit tests; edited values flow into roughing compile (test-pinned). Perceptual pass on a real carve pending |
| ADR-102 3D relief viewer (three.js, UI-only) | **CLAIMED** | 2026-07-03: mesh-builder unit tests; jsdom fallback test; real-WebGL render verified by canvas pixel sampling in isolated preview. Never touches compile/emit |
| H.7 tool library / feeds presets / machine profiles | **CLAIMED** | 2026-07-03: localStorage round-trip + corrupt-payload tests; survives newProject; library merge into machine tool list pinned. UI/persistence only until a layer selects a bit |
| H.7 multi-tool jobs (M0 change, park, re-zero comments, drill/peck, v-carve clearance) | **CLAIMED** | 2026-07-03: per-bit sectioning (profiles last), M5→park→M0→M3 block content, peck cycle shape, clearance flat-floor depth law — all test-pinned; single-tool output byte-identical (snapshot corpus untouched). **Highest-risk hardware gap: full 4040 tool-change session pending (maintainer)** |
| H.8 relief finishing (ball-nose tip surface, scallop rows) | **CLAIMED** | 2026-07-03: no-gouge property vs max-plus tip surface; scallop row-spacing law 2·sqrt(c(2r−c)); serpentine ordering; roughing+finishing group compile tests. Two-tool air job + caliper peak/valley check pending (maintainer) |
| H.9 motion polish (ramp entry, climb/conventional, entry rotation, parking) | **CLAIMED** | 2026-07-03: direction-orientation tests (climb: outside CCW / inside CW under M3), ramp-descent geometry + level re-cut lap, longest-segment entry rotation, park fields in change blocks; defaults byte-identical. Helical entry + arc lead-in/out DEFERRED (documented in DECISIONS.md). Air-cut + park check pending (maintainer) |
| H.10 tiling (grid, clipping, registration holes, per-tile export) | **CLAIMED** | 2026-07-03: Liang–Barsky clip + Z-lerp tests, shared-stock-position registration holes, all-tiles-preflight-before-any-write, indexed file names. Two-tile air job with physical re-registration pending (maintainer) |
| H.11/G2 probing wizard (Z + XYZ corner, G38.2) | **CLAIMED** | 2026-07-03: sequence builders pinned exactly (two-stage, G10 L20, per-corner signs); protocol runner mock-serial tests (ok pacing, ALARM:4/5, timeout); panel gating verified in isolated preview. **Real probe cycle on the 4040 pending — the plate geometry model is PROVISIONAL** |
| H.11/G3 real-time overrides (feed/spindle/rapid) | **CLAIMED** | 2026-07-03: byte constants + Ov: parse + ovCache tests; component fires exact bytes. Live mid-job override on hardware pending (maintainer) |
| H.11/G1 booleans + offset (subtract/intersect/exclude, inflate) | **CLAIMED** | 2026-07-03: area/bounds tests incl. transform baking + collapse rejection; **live-verified in isolated preview** (two text objects → one "Subtracted paths" object). Geometry-only — no G-code path touched |
| H.11/G4 general 3D cut preview | **CLAIMED** | 2026-07-03: downsample tests + jsdom fallback; **live-verified**: dialog reaches ready in real WebGL from the CNC preview at scrubber position. UI-only |
| H.11/G5 chipload feeds calculator | **CLAIMED** | 2026-07-03: feed-law + band + floor tests; **live-verified** (12,000 RPM × 2 × 0.060 → 1440 mm/min shown and applied). Chart values PROVISIONAL starting points |
| CNC provenance banner fix (router wording) | **CLAIMED** | 2026-07-03: header variant tests; **live-verified in a real export** ($30=12000 S↔RPM, $32=0 router mode). Snapshot corpus untouched (headers excluded by design) |
| H.11/G8 spoilboard surfacing generator | **CLAIMED** | 2026-07-03: coverage/ladder/bracketing/determinism tests. Standalone program — air-run of a generated file pending (maintainer) |
| H.11/G6 dogbone corner relief | **CLAIMED** | 2026-07-03: area/bounds tests (square 4-corner relief, L-shape reflex untouched, 12-gon refusal). Corner-overcut style PROVISIONAL. Geometry-only |
| H.11/G7 start-from-line resume | **CLAIMED** | 2026-07-03: modal-replay preamble tests (spindle/feed/depth re-entry, laser Z-silence, G91/range refusals). **Highest-risk of the stretch set on hardware — resume into a real cut pending (maintainer)** |
| ADR-105 G9 persistent 3D result pane | **CLAIMED** | 2026-07-03: **live-verified** — pane renders in CNC mode, goes live on inserted art, empties on impossible cuts, revives on engrave. UI-only |
| ADR-105 G10 pocket raster fill (X/Y) | **CLAIMED** | 2026-07-03: sweep containment + axis + wall-last tests; default absent = byte-identical. Air-cut comparison vs offset rings pending (maintainer) |
| ADR-105 G11 bundled design library (lucide ISC) | **CLAIMED** | 2026-07-03: **live-verified** — dialog categories render, Star inserted through the SVG pipeline. license-check green with the new dependency |
| Phase K box generator (ADR-106, S0–S6) | **CLAIMED** | 2026-07-03: virtual 3D assembly referee (exact per-edge complementarity + corner single-claimant + size, 100-seed fuzz, negative controls); clearance referee (uniform play == c, zero interference); relief radius bounds; perceptual sheet fixture (laser IoU 1.0000, CNC precision 1.0); seeded benchmark **1063/1063 (100%)** over 54 specs; determinism pinned; suite 3042 green. Geometry-only until cut. **Pending hardware check: cut a 60×40×30 T=3 box (Falcon laser with kerf comp; 4040 router at 0.15 mm clearance + 1/8 in relief) and assemble it.** Full in-app UI walk (menu → dialog → insert) not driven against the live scene (side-effect-free rule); covered by component + insertion tests |
| ADR-111 #1 layer material picker (auto-fills feeds) | **CLAIMED** | 2026-07-04: apply-patch + normalize round-trip (unknown key dropped) + jsdom pick→feeds-fill tests; materialKey display-only, absent = byte-identical output. **Real-output check (1/8″, 2fl, 12k RPM): plywood 1440/580/1.6, aluminium 480/70/0.3 — material-appropriate, not the blunt 1000/1.5 default.** Live browser render not driven (shares maintainer's scene per CLAUDE.md §4); jsdom covers the DOM |
| ADR-111 #4 Basic/Advanced disclosure + through-cut | **CLAIMED** | 2026-07-04: jsdom tests (Basic hides Feed, keeps Material + Cut depth; Advanced reveals Feed; Through-cut sets depth = 6.35 mm stock); persisted flag, view-only. Perceptual toggle pass pending |
| ADR-111 #3a machine auto-fill from detected `$$` | **CLAIMED** | 2026-07-04: 6 threshold unit tests + jsdom Apply test (patches params.spindleMaxRpm + device bed, leaves stock untouched). NOT verified against a real controller handshake |
| ADR-111 #3b stock/feed limit advisories | **CLAIMED** | 2026-07-04: 9 threshold unit tests (null/laser silence, width/height overhang, feed-over-max, output-off ignored, absent max-rate, combined); advisory-only, callers without a snapshot byte-identical. NOT verified against a real controller's reported limits |

### Camera Mode inventory (ADR-107..110, added 2026-07-03)

Camera Mode shipped after the CNC ledger was written and had no rows here
(audit gap D7). Convention note: for camera, **VERIFIED means aligned against a
real overhead/USB camera on a real bed** — none of that has happened, so every
row is CLAIMED. `src/core/camera/` (35 src / 28 test) is pure math; `src/ui/camera/`
is the panels/wizard. "live-verified" below = exercised in an isolated
side-effect-free preview per the git history, not on a machine.

| Feature | Status | Evidence |
|---|---|---|
| ADR-107 v1 — manual 4-point homography overlay + workspace wiring (F-CAM1, F-CAM3) | **CLAIMED** | homography/alignment unit tests; persisted-alignment round-trip in `io/project`; overlay show/fade/still/live wired. No real-camera alignment on a bed |
| ADR-108 v2 — fisheye lens calibration wizard (F-CAM2) | **CLAIMED** | checkerboard detect + focal-sweep + Levenberg–Marquardt unit tests; A/B trust review; persists on device profile. Reprojection quality never checked against a real lens |
| ADR-109 v3 — automatic marker alignment (F-CAM4) | **CLAIMED** | X-corner detection + origin-pair orientation + degenerate-solve refusal tests. Never run against a burned marker pattern under a live feed |
| ADR-110 v4 — capture-to-trace at true bed coordinates (F-CAM5) | **CLAIMED** | bed-flatten + basis-mismatch refusal tests; opens the normal Trace dialog. No physical object traced from a real camera |
| Remembered camera + machine-camera auto-probe (85d8daa) | **CLAIMED** | device-UX persistence tests. Not exercised against real hardware |
