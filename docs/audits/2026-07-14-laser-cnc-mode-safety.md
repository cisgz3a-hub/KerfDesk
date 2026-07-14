# Audit — CNC mode on a laser-only machine (2026-07-14)

**Question (maintainer, operator of a laser-only GRBL machine):** if I flip the app to
CNC mode and press CNC buttons, will it be auto-blocked because my machine is a laser, or
can it damage the machine?

**Method:** 6-dimension parallel investigation + dual independent adversarial verification
(Workflow), each finding cross-checked against source, plus hand-verification of the two
decisive paths (Start readiness gate; probe preflight).

**Short answer:** The Laser|CNC choice is a pure software toggle with **no** laser-vs-router
hardware model, so nothing "knows" the machine is a laser. Pressing **Start** on a connected
laser is nevertheless **blocked** — but incidentally, by a firmware-setting check whose remedy
text is dangerous for a laser. Two real gaps below; the default state is safe.

---

## What is already safe (verified — do not "fix" these)

- **The toggle itself is inert.** Switching to CNC mode changes only `project.machine`; it emits
  nothing to the controller (`setMachineKind`, `src/ui/state/machine-actions.ts:74`).
- **Running a CNC job is blocked in every realistic laser configuration.** On Start,
  `runControllerReadiness` routes a `kind: 'cnc'` project through `cncReadiness`
  (`src/core/preflight/controller-readiness.ts:87`), which blocks on a laser's `$32=1`
  (`laser-mode-enabled`, `:141`), on a laser's `$30` (`spindle-scale-mismatch`, `:121`), on an
  absent `$32` (`laser-mode-unknown`, `:127`), and when disconnected (`controller-settings-unknown`,
  `:65`). `runStartJobFlow` returns on `!prepared.ok` **before** `laser.startJob(...)`
  (`src/ui/laser/start-job-flow.ts:69` vs `:79`), so the CNC G-code — which does contain an
  unclamped `M3 S<rpm>` (`src/core/output/cnc-grbl-strategy.ts:236`) — never streams. The beam
  does not fire.
- **Fire is blocked in CNC mode.** The button is hidden (`MomentaryFireControl.tsx:94`) and the
  action rejects with "Fire is unavailable for CNC projects" (`src/ui/state/laser-fire-actions.ts:108`).

---

## Finding A — no laser-vs-router hardware model (root cause, by-design)

`MachineKind = 'laser' | 'cnc'` is derived only from `project.machine`
(`src/core/scene/machine.ts:293`); `DeviceProfile` has no `kind`/`hasSpindle`/`hasZ`
discriminator and `ProfileCapability` has no spindle/router value
(`src/core/devices/device-profile.ts:50`, `:122`). `setMachineKind('cnc')` is unguarded
(`machine-actions.ts:74`); the toggle button is always enabled (`MachineModeToggle.tsx:19`).
The only machine-vs-CNC Start gate keys on **firmware family** (`cncJobsSupported`, true for all
GRBL-family firmware — `start-job-readiness.ts:87`), not on whether the hardware is a laser.

**Severity:** informational. This is the reason Findings B and C exist, but on its own it is a
design choice, not a defect.

## Finding B — the `$32=1` block gives a laser operator dangerous advice

`cncReadiness` blocks a laser (correctly reporting `$32=1`) with:

> "Controller reports $32=1 (laser mode). **Set $32=0 for spindle work**: laser mode cuts
> spindle power to zero during rapids, so plunges would start with the bit not at speed."
> — `src/core/preflight/controller-readiness.ts:145`

That guidance is correct for a router but **hazardous for the laser it is actually talking to.**
A laser operator who follows it (disables laser mode, and sets `$30` to clear the paired
`spindle-scale-mismatch`) lifts the block — and the next CNC Start streams `M3 S<rpm>` to the
laser. With `$32=0`, GRBL no longer suppresses the beam during rapids/dwell, so the beam can sit
**on and stationary** through the emitter's post-`M3` `G4` spin-up dwell
(`cnc-grbl-strategy.ts:237`). The message never considers that the machine is likely a laser or
suggests returning to Laser mode.

**Severity:** medium-high (requires active user action, but the app's own instructions lead there).
**Repro:** laser-only GRBL, `$32=1`; flip to CNC; Start → block advises `$32=0`; follow it → beam
can fire. **Failing test added:** `controller-readiness.test.ts` →
"warns a likely-laser operator to return to Laser mode, not just to disable $32" (red; no fix applied).

**Proposed fix (maintainer's call):** in the `laser-mode-enabled` branch, augment the message to
recognise the likely-laser context and steer the operator back to Laser mode, while keeping the
router-correct `$32=0` note. Message-only change; no gating logic changes.

## Finding C — Z jog / Frame / Probe in CNC mode are not gated by any Z capability

Unlike Start, these stream directly and bypass `runControllerReadiness`:

- **Z jog (Z+/Z-)** is enabled whenever the mode is CNC, with no z-axis check — `focusJogReady`
  short-circuits to `true` for CNC (`src/ui/laser/FocusJogControls.tsx:72`).
- **Frame** prepends a Z retract in CNC mode (`src/ui/state/laser-jog-actions.ts:90`).
- **Probe** streams a live `G38.2 Z-<travel>`; its preflight checks only connection/Idle/busy —
  no `$32` gate, no Z-capability check (`src/ui/state/laser-probe-actions.ts:143`). The CNC emitter
  itself takes the device as an **unused** parameter (`cnc-grbl-strategy.ts:62`).

On a typical no-Z diode/CO₂ laser these do nothing (probe alarms on no-contact). On a machine with
a **motorised focus Z** they drive that axis — a possible crash. None of them set `S`, so none fire
the beam.

**Severity:** medium if a motorised Z is present; otherwise low. **Proposed fix (needs design
input):** gate CNC Z jog/frame/probe on an actual Z-axis capability, or warn when none is declared.
Not implemented — the right gating model is a maintainer decision.

---

## Suggested operator guidance (until fixed)

Keep the app in **Laser mode**. CNC mode offers nothing on a laser-only machine. If a CNC Start is
refused, the safe response is to switch back to Laser mode — **not** to disable `$32`.

## Not verified

The beam's exact physical response depends on the machine's GRBL wiring and live `$32`/`$30`
values, which are not observable from the source. The above states what the app *emits and gates*;
the controller's physical behaviour is standard GRBL, not measured on the hardware.

---

## Appendix — Finding C design options

**The tension.** CNC mode *assumes* a Z axis (every plunge is a Z move), which is why
`focusJogReady` short-circuits to `true` for CNC (`FocusJogControls.tsx:72`). That assumption is
safe for a router but wrong for a laser user who entered CNC mode (Finding A). Meanwhile the app's
CNC machine config sets **none** of the Z-presence fields — `z-axis` capability,
`zTravelConfirmed`, `zTravelMm`, `zProbePresent` are laser-focus-setup fields
(`device-profile.ts:129,173-175`) that `applyCncMachinePreset` never touches
(`machine-actions.ts:128`). So naively *requiring* them would block every legitimate router.

**Existing primitive to reuse.** The laser focus path already has exactly the gate we want:
`focusJogReady = machineKind === 'cnc' || (z-axis cap && zTravelConfirmed && zTravelMm > 0)`
(`FocusJogControls.tsx:72`). The CNC short-circuit is the only reason Z streams ungated.

### Option 1 — control-level gate + CNC setup establishes Z  *(recommended)*

- Drop the `machineKind === 'cnc'` short-circuit; require `z-axis` + `zTravelConfirmed` +
  `zTravelMm > 0` for CNC Z jog too. Gate Frame's Z-retract (`laser-jog-actions.ts:90`) and Probe
  (add `zProbePresent` to `ProbeControls` / probe preflight) the same way.
- To keep routers unblocked, make CNC setup **establish** Z presence: applying a CNC machine
  preset (and first configuring the CNC machine) adds `'z-axis'` to `capabilities`, sets
  `zTravelConfirmed = true` and a `zTravelMm` (from the preset or a sensible default), and sets
  `zProbePresent` when a probe is configured.
- Result: a set-up router has working Z controls; a laser device that wandered into CNC shows the
  same "Confirm Z travel in Machine Setup before using Z jog" hint the laser path already shows
  (`FocusJogControls.tsx:64`) instead of silently streaming Z.
- **Scope:** `focusJogReady`, the frame Z path, the probe gate, and CNC preset/setup application.
  Medium, localized, mirrors an existing trusted pattern, straightforward to test.
- **Caveat:** does not stop a laser user *entering* CNC mode (that is Finding A / the toggle) — but
  combined with Finding B's message and the Start block, the Z controls themselves become safe.

### Option 2 — model machine class properly (root cause, bigger)

Give the device a Z-presence / machine-class signal (e.g. a `hasZ`, or derive from a real
laser-vs-router device property); default routers Z-present and lasers Z-absent-unless-confirmed.
Use it to gate CNC Z controls **and** to warn/gate entering CNC mode on a laser device — fixing
Findings A and C together, including the toggle. **Pros:** fixes the whole class. **Cons:** schema
+ `.lf2` round-trip + migration surface; a product decision about whether "laser vs router" becomes
a device property.

### Option 3 — confirmation nag (cheapest, weakest)

Leave gating as-is; the first Z control used in CNC mode on a device with no confirmed Z shows a
one-time confirm ("This machine has no confirmed Z axis — Z moves may do nothing or crash a focus
axis. Continue?"). No schema change. **Cons:** a nag, not a real gate; easily clicked through.

### Recommendation

**Option 1.** It reuses the exact `z-axis` + `zTravelConfirmed` gate the laser focus path already
trusts, makes the dangerous default (silent Z streaming in CNC) safe, and keeps routers unblocked by
having CNC setup establish Z. Escalate to Option 2 only if we decide to make "laser vs router" a
true device property — the real fix for Finding A, which would also let us gate the toggle itself.

### Open questions for the maintainer

1. Should applying a CNC machine preset auto-confirm Z (`z-axis` / `zTravelConfirmed` / `zTravelMm`)?
   What default `zTravelMm` for a router — bed-dependent, preset-provided, or a fixed value?
2. Solve Finding A now too (warn/gate the toggle on a laser device), or keep CNC mode a free choice
   and rely on Option 1 + Finding B?
3. Probe: require `zProbePresent` in CNC, or keep the firmware-`probing` gate only?
