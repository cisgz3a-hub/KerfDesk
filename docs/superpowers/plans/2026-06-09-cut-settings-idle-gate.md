# Cut Settings Idle Gate Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Keep this slice narrow. The current Cut Settings dialog already exposes backed fields; this patch only fixes the machine-safety workflow gate.

**Goal:** Prevent the full-screen Cut Settings dialog from opening or staying open while LaserForge has active machine motion.

## Research Anchor

- LightBurn opens the Cut Settings Editor by double-clicking a Cuts / Layers row and uses it for full layer settings: <https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/>
- LightBurn's Cuts / Layers window exposes a narrower inline set and double-clicks into the full editor: <https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/>
- LaserForge research says the first editor should be idle-only until Stop remains reachable through modal focus: `audit/reports/lightburn-advanced-cut-settings-editor-research-2026-06-05.md`.
- LaserForge controls real hardware. A full-screen modal must not cover Stop during streaming, frame/jog, or autofocus.

## Tasks

### Task 1: Red Tests

- [x] Active job streamer disables the Edit button and blocks row double-click open.
- [x] Active frame/jog motion disables the Edit button and blocks row double-click open.
- [x] Active autofocus disables the Edit button and blocks row double-click open.
- [x] If motion starts while the dialog is already open, the dialog closes.

### Task 2: Implementation

- [x] Derive `cutSettingsBlocked` from `useLaserStore`: active streamer, active motion operation, or autofocus busy.
- [x] Disable the Edit button with clear title text while blocked.
- [x] Guard row double-click with the same boolean.
- [x] Close the dialog if the boolean becomes true while the dialog is open.

### Task 3: Verify

- [x] Run focused layer tests.
- [x] Run typecheck, lint, format, and file-size checks.
- [x] Browser-smoke the local app side-effect-free.
- [x] Commit and push after verification passes.

## Non-Goals

- No new LightBurn advanced settings in this patch.
- No Material Library integration.
- No sub-layers, Offset Fill, kerf, lead-in/out, Z, air assist, or full Common / Advanced tab rewrite.
