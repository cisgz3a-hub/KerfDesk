# Rayforge Learning Audit

Date: 2026-06-16
Repo audited: `C:\Users\Asus\LaserForge-2.0`
Reference audited: `C:\Users\Asus\LaserForge-2.0\references\rayforge-main`

## Scope

This is a read-only audit. No production code was changed.

The user called the learning platform "Rayburn"; the local reference checkout is
Rayforge, so this audit uses Rayforge as the learning/reference repo unless a
different Rayburn source is provided later.

Current LaserForge checkout:

- Branch: `codex/lane-6e-tabs-bridges`
- Latest commit: `a55eb9d feat: add automatic line tabs`
- Note: `C:\Users\Asus\LaserForge` is not a Git repository in this shell; the
  active repo is `C:\Users\Asus\LaserForge-2.0`.

## Rayforge Patterns Worth Learning From

Rayforge is useful as a reference, not as a template to copy directly. Its Python
desktop architecture, addon system, and multi-controller scope are much broader
than LaserForge's focused GRBL browser/Electron target.

The strongest reusable patterns are:

1. Declarative device packages.
   Rayforge keeps machine facts in `device.yaml` and G-code command shape in
   `dialect.yaml`. The loader validates manifests and dialect templates before a
   machine is created (`rayforge/machine/device/profile.py:203`,
   `rayforge/machine/device/profile.py:310`,
   `rayforge/machine/models/dialect/base.py:306`). Device examples carry concrete
   firmware quirks such as `poll_status_while_running: false`,
   `rx_buffer_size_override`, axis extents, origin, continuous laser mode, and
   modal feed behavior (`rayforge/resources/devices/creality-falcon-a1/device.yaml:6`,
   `rayforge/resources/devices/creality-falcon-a1/device.yaml:9`,
   `rayforge/resources/devices/creality-falcon-a1/device.yaml:10`,
   `rayforge/resources/devices/creality-falcon-a1/dialect.yaml:26`,
   `rayforge/resources/devices/creality-falcon-a1/dialect.yaml:29`).

2. Separate streaming implementations and runtime probing.
   Rayforge has both fast char-counted GRBL transport and a simpler serial driver
   path, plus GRBL probing that extracts RX buffer details when available
   (`rayforge/machine/driver/grbl/grbl_serial.py:76`,
   `rayforge/machine/driver/grbl/grbl_serial_simple.py:94`,
   `rayforge/machine/driver/grbl/grbl_probe.py:124`,
   `rayforge/machine/driver/grbl/grbl_probe.py:160`,
   `rayforge/machine/transport/grbl.py:274`).

3. Sanity checks after planning, before motion.
   Rayforge runs machine extent, work-area, and no-go-zone checks over planned
   operations (`rayforge/machine/sanity/checker.py:29`,
   `rayforge/machine/sanity/checks/workarea_2d.py:14`,
   `rayforge/machine/sanity/checks/extent_2d.py:14`,
   `rayforge/machine/sanity/checks/nogo_zones_2d.py:12`). This is the right
   conceptual layer: validate the motion representation, not just UI intent.

4. Pure post-processing transformers.
   Tabs, overscan, lead-in/out, merge lines, multipass, and optimization are
   independent transformer steps (`rayforge/builtin_addons/rayforge-addon-post/post_processors/transformers/tabs_transformer.py:31`,
   `rayforge/builtin_addons/rayforge-addon-post/post_processors/transformers/overscan_transformer.py:21`,
   `rayforge/builtin_addons/rayforge-addon-post/post_processors/transformers/lead_in_out_transformer.py:21`,
   `rayforge/builtin_addons/rayforge-addon-post/post_processors/transformers/optimize_transformer.py:18`).
   LaserForge already has many of these operations; the learning is to make the
   pipeline more explicit over time.

## What LaserForge Already Adopted Well

LaserForge's current Rayforge-inspired slice is directionally good:

- Device profiles now carry controller and dialect compatibility facts, including
  RX buffer size, streaming mode, polling cadence, homing requirement, WCS support,
  modal feed, repeated S-word behavior, and return-to-origin behavior
  (`src/core/devices/device-profile.ts:38`,
  `src/core/devices/device-profile.ts:46`,
  `src/core/devices/device-profile.ts:137`,
  `src/core/devices/device-profile.ts:178`).
- The Neotronics safe profile picks ping-pong streaming, disables polling during
  jobs, lowers the RX buffer assumption, requires homing, repeats burn S/F words,
  and disables automatic final return-to-origin
  (`src/core/devices/device-profile.ts:178`,
  `src/core/devices/device-profile.ts:185`,
  `src/core/devices/device-profile.ts:186`,
  `src/core/devices/device-profile.ts:187`).
- G-code output resolves a dialect from the active device and uses it for vector
  and fill output (`src/core/output/gcode-dialect.ts:7`,
  `src/core/output/grbl-strategy.ts:63`,
  `src/core/output/grbl-strategy.ts:84`,
  `src/core/output/grbl-strategy.ts:194`).
- The streamer supports both char-counted and ping-pong modes and carries
  per-job polling cadence (`src/core/controllers/grbl/streamer.ts:59`,
  `src/core/controllers/grbl/streamer.ts:149`,
  `src/core/controllers/grbl/streamer.ts:157`).
- The diagnostic flow sends read-only `$I`, `$$`, `$#`, `$G`, and `?`, then
  exports a bundle with profile, controller, status, stream, and transcript
  evidence (`src/ui/state/machine-diagnostic-actions.ts:42`,
  `src/ui/state/machine-diagnostic-bundle.ts:71`,
  `src/ui/laser/MachineSettingsPanel.tsx:145`,
  `src/ui/laser/MachineSettingsPanel.tsx:153`).

## Findings

### RF-LF-001 - Safe profile says homing is required, but Start does not enforce it

Severity: High
Confidence: High

Evidence:

- The Neotronics profile sets `requiresHomingBeforeJob: true`
  (`src/core/devices/device-profile.ts:178`).
- Deserialization preserves the field (`src/io/project/deserialize-project.ts:173`).
- `prepareStartJob` only checks active job, autofocus, alarm, known status, and
  `Idle` state before output/preflight/controller-readiness
  (`src/ui/laser/start-job-readiness.ts:47`,
  `src/ui/laser/start-job-readiness.ts:124`).
- `requiresHomingBeforeJob` is not referenced by Start readiness or controller
  readiness outside profile definition/deserialization/tests.

Trigger path:

1. Select the Neotronics 4040 safe profile.
2. Connect and receive an `Idle` status.
3. Do not home or otherwise prove machine coordinates.
4. Start a job.

Failure mode:

The safe-profile metadata does not affect Start gating. A job can start even
though the profile explicitly says homing is required.

Consequence:

On a real laser, this can turn a "safe profile" into only an output/streaming
profile. Unknown machine coordinates are exactly where return-origin, overscan,
frame, and bed-boundary assumptions become dangerous.

Concrete fix:

Add a homing readiness state to the laser store, or a conservative "homing
required but not confirmed" block in `prepareStartJob`. At minimum, if
`project.device.controller.requiresHomingBeforeJob` is true, block Start until
the session has either seen a successful `$H` action or the user explicitly
confirms a recovery workflow that establishes trusted machine position. Tests
should pin Neotronics/required-homing behavior in
`src/ui/laser/start-job-readiness.test.ts`.

### RF-LF-002 - Ack-triggered refill write failure marks stream disconnected, not errored

Severity: High
Confidence: High

Evidence:

- The streamer comment says a refill write failure on a possibly-live port
  should be represented by `markErrored`, keeping recovery controls active
  (`src/core/controllers/grbl/streamer.ts:28`,
  `src/core/controllers/grbl/streamer.ts:246`).
- `resumeJob` follows that rule and marks refill failure `errored`
  (`src/ui/state/laser-job-actions.ts:105`,
  `src/ui/state/laser-job-actions.ts:111`).
- `advanceStream`, the normal ack-driven refill path, instead catches failed
  writes and sets `disconnectStreamer(acked.state)`
  (`src/ui/state/laser-line-handler.ts:216`,
  `src/ui/state/laser-line-handler.ts:230`).
- `isActiveJob` includes `errored` but not `disconnected`
  (`src/ui/state/laser-store-helpers.ts:40`).

Trigger path:

1. A job is streaming and GRBL acknowledges a line.
2. `advanceStream` steps queued follow-up bytes.
3. The write of those follow-up bytes fails, while the port may still be alive
   and earlier buffered motion may still be executing.

Failure mode:

The stream becomes `disconnected`, not `errored`. Since `disconnected` is not an
active job, the UI can drop active-job recovery semantics even though the machine
may still be executing buffered lines.

Consequence:

The operator may lose the most relevant recovery affordance: Stop/soft-reset
while the serial connection is still possibly usable.

Concrete fix:

Change the catch path in `advanceStream` to mark the stream `errored`, matching
`resumeJob` and the `markErrored` design comment. Keep the safety notice. Update
`src/ui/state/laser-line-handler.test.ts`, which currently expects
`disconnected`, to pin the safer `errored` behavior.

### RF-LF-003 - Raster output is still dialect-blind

Severity: Medium
Confidence: High

Evidence:

- `grbl-strategy` resolves a dialect but calls raster output without passing it
  through (`src/core/output/grbl-strategy.ts:214`,
  `src/core/output/grbl-strategy.ts:215`,
  `src/core/output/grbl-strategy.ts:241`).
- The raster emitter hardcodes `M5` then `M4 S0`
  (`src/core/raster/emit-raster.ts:8`,
  `src/core/raster/emit-raster.ts:81`,
  `src/core/raster/emit-raster.ts:86`,
  `src/core/raster/emit-raster.ts:88`).
- The Rayforge study explicitly says raster output was not rewritten in this
  slice (`docs/machine-compatibility-rayforge-study.md:107`).

Trigger path:

1. Select a safe/unknown-controller profile.
2. Start an Image-mode raster job.
3. The vector/fill dialect protections do not apply to raster output.

Failure mode:

Controller-specific settings like repeated S/F words, alternate laser mode
choice, or stricter command templates do not affect raster emission.

Consequence:

The Neotronics safe profile is stronger for vector/fill than for raster. If the
target controller is the reason the safe profile exists, raster remains the least
proven job type.

Concrete fix:

Either pass a resolved raster dialect into `emitRasterGroup`, or block raster
Start for `safeModeDefault` / unverified profiles until a tiny raster hardware
test has been captured. The better long-term fix is a raster dialect object with
explicit M3/M4, S modal, feed modal, row preamble, and final off behavior.

### RF-LF-004 - Diagnostics collect evidence but do not yet produce profile suggestions

Severity: Medium
Confidence: High

Evidence:

- The diagnostic sequence exists and exports evidence
  (`src/ui/state/machine-diagnostic-actions.ts:42`,
  `src/ui/state/machine-diagnostic-bundle.ts:71`).
- The study lists structured profile suggestion as still pending
  (`docs/machine-compatibility-rayforge-study.md:134`).

Trigger path:

1. Run diagnostic on an unknown GRBL controller.
2. Export diagnostic.
3. The operator still has to manually interpret `$I`, `$$`, `$#`, `$G`, status,
   and transcript evidence.

Failure mode:

LaserForge gathers the right evidence, but it does not yet convert it into a
recommended profile patch or mismatch warning.

Consequence:

This slows field debugging and increases the chance that a user keeps an unsafe
or mismatched profile after the app already has enough evidence to warn them.

Concrete fix:

Add a pure `inferProfileFromDiagnostic()` module that consumes controller
settings, build info, modal state, WCO, and status snapshots and returns:

- suggested profile patch;
- confidence;
- warnings;
- hard blockers for `$32=0`, `$30` mismatch, unknown work offset, and bed-size
  mismatch.

Then surface it as a review/apply flow rather than auto-mutating the project.

### RF-LF-005 - Device profiles are still code constants, not validated shareable packages

Severity: Low
Confidence: High

Evidence:

- Rayforge validates and installs profile packages with separate manager logic
  (`rayforge/machine/device/manager.py:75`,
  `rayforge/machine/device/manager.py:155`,
  `rayforge/machine/device/manager.py:241`).
- LaserForge profile definitions currently live in TypeScript constants
  (`src/core/devices/device-profile.ts:124`,
  `src/core/devices/device-profile.ts:166`).

Failure mode:

Every new hardware profile is a code change, not a user-importable artifact.

Consequence:

That is acceptable for the current stage, but it will not scale if LaserForge
keeps adding OEM variants. Field support will become a release-cycle problem.

Concrete fix:

Do not build a full package manager yet. First stabilize a JSON schema for the
current profile shape, then add import/export for `.lfdevice.json` with strict
validation and no executable hooks. Rayforge's zip/device manager is a later
reference, not an immediate requirement.

## Prioritized Suggestions

1. Fix the two safety semantics issues first:
   enforce `requiresHomingBeforeJob`, and change ack-triggered refill write
   failure from `disconnected` to `errored`.

2. Turn the diagnostic bundle into a profile suggestion pipeline:
   evidence in, suggested patch/warnings out. Keep it pure and testable.

3. Make Start preflight more Rayforge-like:
   add explicit checks for `$20/$21/$22`, `$30/$31/$32`, `$130/$131/$132`,
   WCO/G92 state, return-origin risk, profile/detected-controller mismatch, and
   whether a required homing session is confirmed.

4. Bring raster under the same dialect/profile contract as vector and fill.
   Until then, treat raster on safe/unknown profiles as "needs hardware proof."

5. Keep adopting Rayforge's transformer-pipeline idea, especially for tabs,
   overscan, lead-in/out, merge/optimize, and future no-go-zone clipping. Do
   this inside LaserForge's TypeScript pipeline rather than importing Rayforge
   concepts wholesale.

6. Defer Rayforge's broad scope:
   addons, cameras, AI workpiece tools, network controller fan-out, Ruida/Marlin,
   macros/hooks, projector, print-and-cut, and update checking should not be
   adopted opportunistically. They are separate product-scope decisions.

## Verification Run

Commands run in `C:\Users\Asus\LaserForge-2.0`:

- `corepack pnpm typecheck` - passed.
- `corepack pnpm lint` - passed with the existing boundaries legacy-selector
  warning only.
- `corepack pnpm test -- src/ui/state/laser-line-handler.test.ts src/ui/laser/start-job-readiness.test.ts src/core/output/grbl-strategy-machine-compatibility.test.ts src/ui/state/laser-store-machine-compatibility.test.ts src/ui/state/laser-store-machine-diagnostic.test.ts`
  - passed. Vitest ran the full suite in this invocation: 261 files, 1747 tests.
  - Existing React `act(...)` warnings appeared from
    `src/ui/workspace/use-canvas-bitmap-size.test.tsx`.
