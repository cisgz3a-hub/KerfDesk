# Documentation-vs-Build Gap Audit

**Date:** 2026-06-29
**Checkout at audit:** `main` @ `e49e227` (post offline-PWA merge)
**Type:** Read-only documentation audit. Per CLAUDE.md collaboration rule #1 this lists
findings only — no source was changed.

## Purpose

Read the repository's Markdown and surface what it describes as required, planned, or
in-flight that is **not built, not finished, or not verified**, plus places where the docs
themselves are **stale or inconsistent** with current source.

## Method

Anchored on the living spec and ledger rather than the ~50 historical audit/roadmap reports:

- `PROJECT.md` — phase plan, scope, non-negotiables.
- `DECISIONS.md` — the ADR ledger (ADR-001..060, plus 092, 093).
- `WORKFLOW.md` — user flows.
- `docs/superpowers/plans/2026-06-25-current-work-tracker.md` — the freshest built-status ledger.

Every candidate gap was then **verified against current source** (`src/...`). This was
necessary because the tracker itself states most older "missing feature" lists are stale —
confirmed repeatedly below (Convert-to-Bitmap render types, Fade Image, Frame, and clipboard
Copy/Cut are all built despite docs implying otherwise). The headline pattern of this audit is
**the code is ahead of the docs.**

## Status key

- **HW** — not a code gap; needs on-machine verification (software cannot prove it).
- **UNBUILT** — documented as a feature or follow-up; confirmed absent in current source.
- **DOC** — documentation defect (missing ADR, stale status line, numbering collision).
- **SCOPE** — intentionally out of scope; listed for completeness, not a defect.

---

## 1. Hardware verification — the dominant standing gap (HW)

Nothing here is a code gap; it is the one thing software cannot prove, and it has never been
closed. Every burn-facing feature carries an unverified flag:

- **F.2.f** — raster image engrave on the Falcon (`WORKFLOW.md` F-F2 checklist, ~line 919).
- **F.3** — Set-work-origin (G92) on real hardware (`PROJECT.md` Phase F.3).
- **Scan / raster offset calibration** — "no default 4040 offsets should ship without
  calibration" (current-work-tracker, "Raster calibration and scan offsets": Partial; ADR-052).
- **Air assist** — M7/M8/M9 emission on a real controller (tracker: Built in software, hardware
  claims held separate).
- **Machine / controller lifecycle** — post-job settle, Home/recovery (tracker: Partial).
- **Registration Jig** — physical placement workflow (ADR-057; jig Slice "Hardware verification"
  still open).
- **Material / Interval test recipes** — that the chosen settings actually burn correctly
  (ADR-044 / ADR-093 verification sections).
- **Offline Web Serial** — driving the laser with the network down (ADR-060, 2026-06-29). The API
  is local USB, so it is software-confirmed; the on-machine burn is the open step.

## 2. Documented code features not built yet (UNBUILT — verified in source)

- **Glyph weld** (Phase D) — no `weld` anywhere in `src/`. Depends on the geometry kernel;
  `PROJECT.md` already says "not implemented ... do not describe it as shipped."
- **Convert-to-Path** and **interactive parametric handles** (Phase G "P2 follow-ups", ADR-051) —
  only SVG-import warnings reference "convert to paths"; no on-canvas tool exists.
- **Persistent work origin** `G10 L20 P1` — `src/ui/state/origin-actions.ts:10` "No persistent
  (G10 L20 P1) mode. Deferred until requested." G92-only today (by design).
- **Re-trace from original raster** (ADR-026 follow-up) — only a "future workflow" comment in
  `src/ui/trace/ImportImageDialog.tsx:24`.
- **Row-by-row raster scrubbing** in preview — deferred (`WORKFLOW.md:326`); the scrubber animates
  vector toolpaths only, raster always renders complete.
- **Trace quality (perceptual, not structural)** — Centerline v2 distance-aware pruning/gap-repair
  and broader real-logo edge cleanup. The tracker rates these "Next-loop / not 10/10." Tests are
  green; per CLAUDE.md #2 the open question is fidelity, which the structural suite does not measure.

## 3. Documentation debt — the genuine "misses" (DOC)

These are oversights in the docs themselves, independent of the code:

- **ADR-054 / ADR-055 / ADR-056 are referenced in `PROJECT.md` but were never written.** The
  *features* shipped (Cross-Hatch, Offset/Island Fill, ordered sub-layer stack — all confirmed in
  source and in the tracker's "Lane 6" row), but `PROJECT.md` "Out of scope" cites three ADRs that
  do not exist in `DECISIONS.md` (which jumps ADR-053 -> ADR-057).
- **ADR-024 (Windows desktop update mechanism) is unwritten** and flagged "before first signed
  release" (`DECISIONS.md` Future ADRs). A real blocker if the `.exe` ships.
- **ADR-023 (web deploy target)** exists only ad-hoc in the Cloudflare Pages commits, never
  formalized (`DECISIONS.md` Future ADRs).
- **ADR-057 numbering collision** — the build-plan allocation table lists 057 as "Offset fill,"
  but 057 shipped as Registration Box; `DECISIONS.md` itself says the table "needs reconciling."
- **Stale status lines now contradicted by source:**
  - `PROJECT.md` F.4 — "A3 Outlines / A4 Use Cut Settings ... pending," but
    `renderType: 'outlines'` and `'use-cut-settings'` exist (`src/core/raster/rasterize-vector.ts`,
    `rasterize-vector.test.ts`, `Toolbar.test.tsx`).
  - ADR-026 "open gaps" — source dimming shipped as **Fade Image** (`src/ui/trace/TracePreview.tsx:76`).
  - `WORKFLOW.md:485` — "Cut (not implemented)," but a Cut command exists
    (`src/ui/help/command-help-topics.ts:55`).
  - `WORKFLOW.md:578` — Phase-B perimeter framing "not implemented," but Frame is built
    (`src/core/job/frame-bounds.ts`, `frame-verification.ts`).
  - `PROJECT.md` ADR-030 trace-control realignment "phase assignment pending," but the controls
    (Cutoff/Threshold band, Sketch Trace, Trace Transparency, Smoothness, Optimize, Ignore-Less-Than)
    exist in `src/core/trace/trace-image.ts` and the Trace UI.
- **Stale roadmaps** (the tracker names these): `docs/LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md`
  Lanes 6/9 describe already-built features (Offset Fill, Sub-layers, Kerf, Tabs, Air Assist,
  Measure tool, movable Registration Jig) as upcoming.

## 4. Intentionally out of scope (SCOPE — for completeness, not defects)

Geometry kernel (weld / boolean / offset / node editing), non-GRBL controllers (Marlin — Phase H),
macOS/Linux desktop builds (Phase I), LightBurn `.clb` / manufacturer profiles / linked "Link"
presets, DXF / AI / PDF import, variable text (CSV / counter / date), system fonts, camera
alignment, rotary attachment, Z / auto-focus beyond homing.

## Verification evidence (source spot-checks)

| Doc claim                                  | Source check                                                  | Result                |
| ------------------------------------------ | ------------------------------------------------------------ | --------------------- |
| Glyph weld not implemented                 | grep `weld` in `src/`                                         | Absent — UNBUILT      |
| Convert-to-Path (Phase G P2)               | grep `convertToPath` / "Convert to Path"                     | Absent — UNBUILT      |
| Persistent origin deferred                 | `src/ui/state/origin-actions.ts:10`                          | "Deferred" — UNBUILT  |
| Re-trace from source                       | `src/ui/trace/ImportImageDialog.tsx:24`                      | "future" — UNBUILT    |
| Convert-to-Bitmap A3/A4 "pending"          | `renderType: 'outlines'` / `'use-cut-settings'` in source    | Built — PROJECT stale |
| ADR-026 source dimming "open"              | `src/ui/trace/TracePreview.tsx:76` Fade Image                | Built — ADR stale     |
| Frame "not implemented" (WORKFLOW:578)     | `src/core/job/frame-bounds.ts`, `frame-verification.ts`      | Built — WORKFLOW stale|
| Clipboard Cut "not implemented" (WF:485)   | `src/ui/help/command-help-topics.ts:51,55`                   | Built — WORKFLOW stale|
| ADR-054/055/056 scope it                   | grep `^## ADR-054/055/056` in `DECISIONS.md`                 | No headers — DOC gap  |

## Not exhaustively verified

The ~50 historical `audit/reports/*` files and the June parity roadmaps were **not** read
line-by-line; the current-work-tracker flags them stale and spot-checks confirmed it. Two deeper
passes are available on request: (a) mine `LIGHTBURN-STUDY.md` plus the parity gap lists for any
LightBurn behaviour that is neither built nor scoped, and (b) walk every ADR's "Verification"
section against source to find other stale status lines like §3.

## Suggested follow-ups (maintainer's call)

1. Write the missing ADR-054 / ADR-055 / ADR-056 (or change `PROJECT.md` to point at the ADRs the
   features actually shipped under) and reconcile the ADR-057 numbering note.
2. Write ADR-024 before any signed Windows release.
3. Refresh the stale status lines in §3 (`PROJECT.md` F.4 + ADR-030, `WORKFLOW.md` 485/578, ADR-026).
4. Treat the hardware-verification list in §1 as the real remaining backlog to "done."
