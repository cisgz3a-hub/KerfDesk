# LaserForge 2.0 — Code Audit

**Date:** 2026-05-27
**Reviewer:** Claude (post-Phase-B-implementation)
**Tooling baseline:** lint ✓ · typecheck ✓ · format ✓ · 220 tests pass · license-check ✓ · build:web ✓ · build:electron-main ✓

---

## TL;DR

The codebase is in **good shape** for a pre-1.0 product. No blockers, the discipline from ADR-010/ADR-015 is holding (zero files over the 400-line hard cap, zero `any` types, zero `@ts-ignore`), and the pure protocol code (SVG parsing, G-code emission, GRBL streaming) has thorough property + snapshot coverage. The gaps are concentrated in **UI integration testing** and a few **operator-visibility holes** (most notably: GRBL responses aren't shown to the user, which is why the autofocus debugging is hard).

Three things I'd fix before declaring Phase B "shipped":

1. **Surface the GRBL log to the operator** (Important — blocks debugging on connect, autofocus, alarms).
2. **Split `Workspace.tsx`** before it overflows the 400-line cap (Important — currently 390).
3. **Handshake validation on connect** (Important — silently-wrong-baud connections look "connected").

---

## Objective metrics

| Metric | Value | Cap / target | Status |
|---|---|---|---|
| Source files | 102 | — | — |
| Total source lines | 7,395 | — | — |
| Largest file | `Workspace.tsx` 390 lines | 400 hard / 250 soft | ⚠ 97.5% of cap |
| Files over soft cap (250) | 3 | — | acceptable |
| Files over hard cap (400) | **0** | 0 | ✓ |
| Test files | 29 | — | — |
| Tests passing | 220 | all pass | ✓ |
| Snapshot fixtures | 5 | 5 (Phase A acceptance) | ✓ |
| Property tests | 4, 100 fuzz runs each | 4 invariants | ✓ |
| `any` usages | 0 | 0 | ✓ |
| `@ts-ignore` / `@ts-expect-error` | 0 | 0 | ✓ |
| `eslint-disable` | 0 | 0 | ✓ |
| Type assertions (`as X`) | 5, all narrowing after a `has`/regex check | minimize | ✓ |
| Production deps | 4 (react, react-dom, zustand, dompurify) | minimum viable | ✓ |
| Web bundle gzipped | 77 KB | < 1 MB | ✓ (8%) |
| Production licenses | 3 × MIT + 1 × MPL-2.0/Apache-2.0 | per ADR-008 | ✓ |

---

## Findings — Important (fix before next phase)

### I-1. GRBL log is invisible to the operator
**Severity:** Important · **Location:** `src/ui/state/laser-store.ts:49` + missing UI component

The store accumulates every line GRBL sends in `state.log` (capped at 200), but **no UI component renders it**. The operator can't see `error:9`, `error:22`, `ALARM:N`, or the welcome banner. This is why the autofocus debugging is opaque — there's no way to know whether GRBL refused the probe command or accepted it.

**Recommendation:** Add a collapsible `<LaserLog />` panel to `LaserWindow.tsx`. Each line tagged by classification kind (`ok` muted, `error` orange, `alarm` red, raw `<…>` status hidden by default to avoid spam). 50 lines of UI.

### I-2. `Workspace.tsx` at 97.5% of hard cap
**Severity:** Important · **Location:** `src/ui/workspace/Workspace.tsx` (390 / 400 lines)

Adding one more `draw*` helper or a single rotation-handle implementation pushes this file over the ADR-015 limit and breaks the build. Split now while the layout is fresh:

- `Workspace.tsx` — React component + `useDragMove` hook (~150 lines)
- `draw-scene.ts` — all `draw*` helpers (~200 lines)
- `view-transform.ts` — `computeView` + `canvasMouseToScene` (~30 lines)

The two callsites that need updates are `useDragMove` and the `useEffect` that renders the scene.

### I-3. No GRBL handshake validation on connect
**Severity:** Important · **Location:** `src/ui/state/laser-store.ts:136`

Right now, `connect()` opens the port at 115200 and immediately starts the status poll. There's no:

- Welcome-banner detection (`Grbl 1.1h ['$' for help]`)
- `$$` settings dump → auto-populate `$30`, `$32`
- Baud-rate retry (if 115200 fails, try 230400 / 250000)

Symptoms: a wrong-baud connection looks "Connected" (green dot) but every status report comes back as `kind: 'unknown'` and the status display stays empty. The operator may think the machine is hung when really we're just speaking the wrong language.

**Recommendation:** On connect:
1. Send `?` and wait ≤ 2 s for a `<…>` reply OR `Grbl 1.1h` welcome
2. If no reply, fail with "No GRBL response at 115200 — check baud rate"
3. If reply, send `$$`, parse the settings stream into a known-properties object, auto-populate `device.maxPowerS` from `$30`

### I-4. Autofocus default likely doesn't work on Falcon A1 Pro
**Severity:** Important · **Location:** `src/core/devices/device-profile.ts:29`

The default `G38.2 Z-30 F100` probe command assumes a probe pin and a Z axis. The Falcon A1 Pro has neither in the GRBL sense — its autofocus is a vendor-extension command (Creality's firmware uses M-codes that aren't publicly documented). When sent on a probe-less machine, GRBL replies `error:9` (G-code lock) and the operator sees nothing because of I-1.

**Recommendation:** Two fixes together:
1. Land I-1 so the operator can see the error.
2. Add a one-line "Sniff your machine's command via Device Manager + PuTTY while CrealityPrint runs autofocus" note in `DeviceSettings.tsx` near the textarea.
3. Add a small "Common machine presets" dropdown alongside the textarea: "Falcon A1 Pro · paste your command", "Generic GRBL with Z + probe (current default)", "Diode laser without Z (no autofocus)". Selecting a preset rewrites the textarea.

### I-5. `deserializeProject` trusts the JSON shape
**Severity:** Important · **Location:** `src/io/project/deserialize-project.ts:48`

After verifying `schemaVersion === 1`, we do `return { kind: 'ok', project: raw as Project }`. A user opening a `.lf2` file with a corrupt body (e.g., `layers: null` instead of `[]`) will crash at first access deep in the rendering code. The error message lands inside React's error boundary stack rather than the friendly "Could not open" modal we promise in WORKFLOW.md F-A12.

**Recommendation:** Either:
- Add Zod (or a hand-rolled shape walker) to validate the parsed object structurally before casting.
- Or wrap every consumer in try/catch and surface to the load modal.

Lighter Phase B fix: validate the top-level shape (`device`, `workspace`, `scene` exist as objects; `scene.layers` is an array). Defer field-level checks.

---

## Findings — Polish (acceptable trade-offs, document for follow-up)

### P-1. `window.alert` used for error dialogs (6 sites)
**Location:** `file-actions.ts`, `LaserWindow.tsx`, `JobControls.tsx`

Works, but visually breaks the app's chrome and on Electron looks like an OS-level interrupt. A custom `<Modal>` would be polished. Phase C item.

### P-2. UI components lack render tests
**Location:** `src/ui/**/*.tsx` — only `store.test.ts` and `handles.test.ts` exist

The pure layer is well-tested (state, transforms, parsers, streamer, predicates). The components are compile-checked but never exercised with `@testing-library/react`. Risk: a CSS or layout regression slips through to manual testing.

Phase B is acceptable as-is given the manual verification we've done. Add `@testing-library/react` + render tests for `LaserWindow`, `Toolbar`, `CutsLayersPanel`, `StatusBar`, `JobControls`, `JogPad` in Phase C.

### P-3. Status polling fires even when port isn't responding
**Location:** `src/ui/state/laser-store.ts:151` (the `setInterval` for `RT_STATUS`)

We write `?` every 250 ms regardless of whether the previous one was acknowledged. If GRBL is hung or the port is half-open, the writes pile up in the OS-level write queue. Low risk (writes are tiny) but worth adding a "skip if last status > 1 s ago" guard.

### P-4. `frame` action assumes positive coord rectangle
**Location:** `src/ui/state/laser-store.ts:200` (the `frame` action) + `src/core/job/job-bounds.ts`

`computeJobBounds` returns coords already in machine space (post-`toMachineCoords`). For `center` origin, those are negative; the absolute `$J=G90` jogs we emit are still valid (GRBL accepts negative absolute targets when in laser mode with soft-limits off), but **the bounds-check predicate in `preflight.ts` short-circuits on `origin === 'center'`** because the predicate assumes a `[0, bedW] × [0, bedH]` rectangle. Mid-job out-of-bed detection is disabled for center-origin operators.

Phase B polish: extend `findOutOfBoundsCoords` to take a `{ minX, minY, maxX, maxY }` rectangle and pass the origin-aware one in preflight.

### P-5. Bezier flatness hard-coded at 0.25 mm
**Location:** `src/io/svg/flatten-curves.ts:12` (`DEFAULT_FLATNESS_MM`)

Tighter tolerance = smoother curves = more polyline points = larger G-code. Some users want < 0.1 mm for engraving fine detail; others want 1 mm for fast cuts. Expose as a project-level setting in Phase C.

### P-6. Documentation drift
**Locations:** `WORKFLOW.md` F-A6, F-A8, F-B5

- F-A6 spec says "Alt+drag scales from center" and "Edge handles scale one axis". I shipped corner handles only, anchored on opposite corner, no Alt modifier.
- F-A8 spec says a play scrubber animates along the path. I shipped a toggle that shows cut + travel paths but no animation.
- F-B5 spec says "continuous, step, return to zero". I shipped step-only.

Either ship the missing UX or downgrade the spec lines to "Phase B polish" with explicit notes. Don't let docs lie.

### P-7. No keyboard shortcut for Auto-focus
**Location:** `src/ui/app/shortcuts.ts`

Home (no shortcut), Frame (no shortcut), Auto-focus (no shortcut) — all useful for operators who keep one hand on keyboard. Common LightBurn defaults: Home = `Ctrl+H`, Frame = `Ctrl+L`, Auto-focus = `Ctrl+Shift+F`. Add to F-A15 / F-B shortcut table.

### P-8. `pnpm dev:desktop` rebuilds the whole web bundle every launch
**Location:** `package.json:scripts.dev:desktop`

`pnpm build:electron-main && vite build && electron .` — that `vite build` takes ~1 s but is wasteful when only the main process changed. Phase B polish: run Vite dev server + Electron pointing at `http://localhost:5173` (the existing `LASERFORGE_DEV_URL` plumbing supports this) so renderer hot-reloads without rebuilding.

---

## Findings — Code quality (passes, noteworthy)

### CQ-1. ✓ ESLint discipline holding
Module boundaries (`core` → only `core`, `io` → `core+io`, `ui` → `core+io+platform-types`, no `ui` → `platform-web`), file size, function size, complexity, no default arms without exhaustiveness, no inline `import()` types, no `any` — every guard is on, every guard is green.

### CQ-2. ✓ Pure-core invariant preserved
Nothing in `src/core/` reads from `window`, `document`, `process`, `Date.now()`, or `Math.random()`. Enforced by the `no-restricted-globals` and `no-restricted-syntax` rules under the `src/core/**/*.ts` override.

### CQ-3. ✓ All type assertions justified
Five `as Foo` casts in production code, every one narrowing a string→union literal after a runtime `has` / regex check, or narrowing `JSON.parse`'s `unknown` after a schema-version verification. No drive-by casts.

### CQ-4. ✓ Determinism property holds
`grbl-strategy.property.test.ts` passes 100 fuzz seeds for the determinism + laser-off + bounds + power-scale invariants. The 5 fixture snapshots regenerate identically. PROJECT.md non-negotiables 3, 5, 7 are actually checked, not just claimed.

### CQ-5. ✓ License posture clean
Production tree: 3 × MIT (react, react-dom, zustand) + 1 × MPL-2.0/Apache-2.0 (DOMPurify). All permitted by ADR-008. No GPL transitive deps. `pnpm license-check` enforced in CI.

### CQ-6. ✓ Single-responsibility per file holds
Spot-checked: `compile-job.ts` (Scene → Job), `grbl-strategy.ts` (Job → G-code string), `sanitize.ts` (SVG → clean SVG), `parse-path-d.ts` (path `d` → polylines), `hit-test.ts` (point + scene → object id), `streamer.ts` (gcode → pure state machine). Each describable in one sentence without "and."

---

## Findings — Architecture (passes, worth noting)

### A-1. Platform adapter contract is the right size
4 methods (`pickFilesForOpen`, `pickFileForSave`, `serial.requestPort`, `serial.isSupported`). Adding Phase B's serial didn't require restructuring the file/io types. The two-impls-one-interface pattern (web + future electron-native) is paying off.

### A-2. `SceneObject` discriminated union is extensible
ADR-014's promise — Phase D/E can add `text` / `traced-image` variants by editing one file (`scene-object.ts`) + the switch arms in `compile-job.ts` + (rendering) `Workspace.tsx`. `@typescript-eslint/switch-exhaustiveness-check` enforces caller updates.

### A-3. Pure / impure separation is clean
`src/core/controllers/grbl/` is fully pure — the parser, classifier, streamer state machine, command builders, and code tables have zero I/O. The `ui/state/laser-store.ts` is the single place that holds the live `SerialConnection` reference and bridges pure state to impure side effects. This is what made Phase B testable without hardware.

---

## Open bugs

### B-1. Autofocus not firing on Falcon A1 Pro
**User-reported · Reproducible**

Clicking **Auto-focus** sends the default G38.2 probe sequence; the Falcon's GRBL fork replies with an error (probably `error:9` "G-code lock" or `error:20` "Unsupported G-code") because the machine has no probe pin nor user-configured probe behavior. The operator sees no visible change because of finding I-1.

**Workaround until I-1 + I-4 land:** open DevTools (it's auto-opened in dev mode), Console tab, filter for `[renderer 2]` lines — GRBL response lines flow through. Find the `error:N` reply that fired after Auto-focus.

**Fix path:** I-1 first (visible log), I-4 second (presets + better hint).

---

## Recommendation order

If I had to do five things next before declaring Phase B "shipped to operator":

1. **I-1**: Add the `<LaserLog />` panel. Roughly 50 lines of new UI; unblocks all subsequent debugging.
2. **I-3**: Welcome-banner + `$$` handshake on connect. Auto-populates `device.maxPowerS`. ~60 lines + a small test against a recorded handshake transcript.
3. **I-2**: Split `Workspace.tsx`. Mechanical refactor; no behavior change.
4. **I-4**: Autofocus presets + Falcon hint, gated on I-1 landing.
5. **I-5**: Top-level shape validation in `deserializeProject`. Prevents the worst loading-bad-file crashes.

After those, Phase B is genuinely shipped. Phase C polish (autosave, settings panel, copy/paste, path optimization) is the next horizon.
