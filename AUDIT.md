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
| Total source LOC | 12 539 | ✅ small for scope |
| Total test LOC | 5 572 (~44% of source) | ✅ unusually high — most projects ≤ 30% |
| Tests passing | **427 / 427** | ✅ |
| Test files | 49 | ✅ |
| Production deps | 6 (dompurify, imagetracerjs, opentype.js, react, react-dom, zustand) | ✅ tight |
| **Production vulns** | **0** (`pnpm audit --prod`) | ✅ |
| **Dev vulns** | **0** (`pnpm audit`) | ✅ down from 34 pre-F-2 |
| Files over hard cap (400 LOC) | **0** | ✅ (store.ts at exactly 400) |
| Files over soft cap (250 LOC) | 11 source + 4 test | ⚠️ documented, monitor |
| ESLint errors | 0 | ✅ |
| ESLint warnings | 1 (boundaries plugin v6 legacy-selector — non-fatal) | ⚠️ |
| TypeScript strict | clean (no `any`, no `!`, no `eval`, no `innerHTML=`) | ✅ |
| `@ts-expect-error` in src | 1 (`trace-image.ts`, imagetracerjs untyped lib) | ✅ justified |
| Bundle (JS, raw / gzip) | 573 KB / 173 KB | ⚠️ over 500 KB warning; under 1 MB project target |
| Bundle (fonts, lazy) | 1.08 MB across 4 .ttf files | ✅ loaded on demand |
| Web prod deploy | `https://laserforge.pages.dev`, CSP+HSTS+SRI headers ✓ | ✅ |
| CI status | every `ci.yml` step green; deploy.yml awaits secrets | ✅ |

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

**Status:** **TRACKED** — adds 5 LOC in `web-serial.ts` and `laser-store.ts`.

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

**Status:** **TRACKED** — 3-line doc edit.

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

**Status:** **TRACKED** — defer until next Electron-security pass.

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

**Status:** **TRACKED** — separate PR worth doing.

---

### A6 — Bundle main chunk 573 KB (over the 500 KB warning)

**Severity:** Low. Under the 1 MB project target; pre-existing across
multiple audits (Phases C, D, E, F.1). Mentioned for completeness.

**Evidence:** `pnpm build:web` emits `assets/index-*.js` at 573 KB raw
/ ~173 KB gzipped. Vite's chunk-size warning fires at 500 KB.

**Source of weight (in order):** React 18 + react-dom (~145 KB),
opentype.js (~110 KB), imagetracerjs (~80 KB), DOMPurify (~65 KB),
Zustand + our own code.

**Mitigation paths (none ship today):**
- Dynamic-import opentype.js — only loaded when the Text dialog opens.
- Dynamic-import imagetracerjs — only loaded when Trace Image dialog opens.
- Manual chunk splitting via `build.rollupOptions.output.manualChunks`.

**Status:** **TRACKED** — would shave ~40% off initial load.
First-launch UX is still <2s per PROJECT.md success metric, so deferred.

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
| Frame feed decoupling | VERIFIED | User confirmed Frame works at speed after the change |
| Build badge | VERIFIED | Visible in DOM; defines confirmed inline in dist/web/assets/index-*.js |
| Canvas auto-zoom on import | CLAIMED | Logic tested via the new combinedBBox + zoomToBounds math; not verified on a real import workflow |
| Cmd+D duplicate | CLAIMED | Tests pin behaviour; no real-use confirmation yet |
| Cloudflare Pages auto-deploy | CLAIMED | Workflow file exists; the two secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are not yet set in GitHub, so the first auto-deploy attempt will fail |
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

## How this audit was produced

Verified locally:
- `pnpm audit` → 0/0/0/0
- `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test --run && pnpm build:web` → all green
- `grep`-counted: `any`, `!`, `eval`, `innerHTML=`, `ipcMain`, `Math.random` / `Date.now` / `fetch(` / `window.` in `src/core/`
- `wc -l` against every source file vs the 250/400 caps
- `pnpm exec wrangler pages deployment list` → confirmed production deploy serves commit `a709747` over HTTPS+HSTS

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
