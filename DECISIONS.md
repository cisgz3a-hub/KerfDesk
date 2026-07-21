# DECISIONS.md — LaserForge 2.0

> Architecturally significant decisions only. A future maintainer should understand the *why* without needing to ask.
>
> **Current Start policy — frame-first (ADR-228, ADR-230, ADR-232).** A completed Frame for the exact
> current job is the sole Start guard on laser and CNC; the Job Review dialog is the single
> warning surface. Older gate ADRs below that mandated Start blocks are stamped
> "Superseded by ADR-228" in their Status lines — their evidence models often remain in use,
> but their *refusals* do not. Per-gate disposition:
> `docs/audits/2026-07-18-guard-inventory-frame-first.md`.

## Decision index

> The index is numerically complete; gaps in the numbering are reserved blocks with no ADR body
> (e.g. most of 054–091, reserved by the build plan). The body itself is in insertion order, not
> numeric order — locate any ADR by searching `## ADR-NNN`.

| ID | Date | Status | Title |
|---|---|---|---|
| ADR-001 | 2026-05-26 | Accepted | Adopt LightBurn workflow as the product model |
| ADR-002 | 2026-05-26 | Accepted | Fully clean rewrite — no port from LF1 |
| ADR-003 | 2026-05-26 | Accepted | Ship both web app and Windows desktop from one codebase |
| ADR-004 | 2026-05-26 | Accepted | Streaming to laser is in MVP; delivered in phases |
| ADR-005 | 2026-05-26 | Accepted | Color-driven layers (multi-op); only Line mode in MVP |
| ADR-006 | 2026-05-26 | Accepted | GRBL v1.1+ only; extensible strategy for future controllers |
| ADR-007 | 2026-05-26 | Accepted | Windows-only desktop; web app covers macOS and Linux |
| ADR-008 | 2026-05-26 | Superseded | MIT open source, public from first commit (see ADR-018) |
| ADR-009 | 2026-05-26 | Accepted | TypeScript + React + Vite + Vitest stack |
| ADR-010 | 2026-05-26 | Accepted | Architectural discipline to prevent cascading regressions |
| ADR-011 | 2026-05-26 | Accepted | Platform adapter pattern for web vs Electron |
| ADR-012 | 2026-05-26 | Accepted | Text + fonts as Phase D; bundle MIT fonts |
| ADR-013 | 2026-05-26 | Accepted | Image vectorize as Phase E feature, not MVP |
| ADR-014 | 2026-05-26 | Accepted | SceneObject as discriminated union, extensible from day one |
| ADR-015 | 2026-05-26 | Accepted | File-size discipline and anti-god-file enforcement |
| ADR-016 | 2026-05-26 | Accepted | Documentation-as-spec: WORKFLOW.md and CLAUDE.md |
| ADR-017 | 2026-05-26 | Accepted | Third-party library evaluation policy; DOMPurify pinned for Phase A |
| ADR-018 | 2026-05-27 | Accepted | Proprietary license, private repo (supersedes ADR-008) |
| ADR-019 | — | Accepted | Phase F kickoff: Fill is a geometry decision in `compileJob` |
| ADR-020 | — | Accepted | Phase F.2 raster image engrave (kickoff) |
| ADR-021 | 2026-05-28 | Accepted, code shipped, hardware verification pending | Phase F.3 set-work-origin via G92 (kickoff) |
| ADR-022 | 2026-06-01 | Accepted, code shipped, hardware verification pending | Origin-aware job placement and physical Frame/Start preflight |
| ADR-024 | 2026-07-04 | Accepted | Windows desktop distribution + auto-update (revises non-negotiable #8 "no network calls") |
| ADR-025 | 2026-05-29 | Accepted, harness shipped, scope limits documented below | Perceptual fidelity harness for the trace pipeline |
| ADR-026 | — | Accepted | Trace keeps its source image (LightBurn-style overlay) |
| ADR-027 | 2026-05-29 | Accepted | LightBurn is the source of truth; divergences are defects to redesign |
| ADR-028 | 2026-05-29 | Accepted | Raster engrave preview renders in scene space via the compile path's dither |
| ADR-029 | 2026-05-29 | Accepted (A1 Fill-All rasterizer + A2 UI/PNG/`RasterImage... | Convert to Bitmap (vector → raster engrave source) |
| ADR-030 | 2026-05-29 | Proposed (documentation gate | Trace control model realigned to LightBurn (Cutoff/Threshold band) |
| ADR-031 | 2026-06-01 | Accepted | Fill hatch overscan lead-in/out |
| ADR-032 | 2026-06-01 | Accepted | Bidirectional raster rows after overscan runtime regression |
| ADR-033 | 2026-06-03 | Accepted, code shipped, hardware verification pending | Skip fill overscan on short hatch runs; emit runway as rapid |
| ADR-034 | 2026-06-03 | Accepted, code shipped, hardware verification pending | Continuous-sweep fill: one G1 per scanline, S0-blanked gaps |
| ADR-035 | 2026-06-03 | Accepted, code shipped, hardware verification pending | Split a fill scanline at large gaps so the emitter rapids across them |
| ADR-036 | 2026-06-03 | Accepted, code shipped, hardware verification pending | Fill engraving emits M4 dynamic power (was M3 constant); supersedes ADR-020 #4 |
| ADR-037 | 2026-06-03 | Accepted, code shipped, visual verification pending | Raise the image-trace decode cap 1024 -> 2048 px for small-feature fidelity |
| ADR-038 | 2026-06-03 | Accepted, code shipped, hardware verification pending | Per-layer unidirectional fill option (was: snake hardcoded) |
| ADR-039 | 2026-06-03 | Accepted, code shipped, hardware verification pending | Split a raster row at wide white gaps so the emitter rapids across them |
| ADR-040 | 2026-06-03 | Accepted, code shipped | Shared prepared-output pipeline (preview = save = start = estimate) |
| ADR-041 | 2026-06-04 | Accepted, code shipped | A GRBL error:N ack is terminal for the stream (stop sending + safety notice) |
| ADR-042 | 2026-06-04 | Accepted, code shipped | Ack-driven follow-up write failure raises the disconnect safety notice (P0-3) |
| ADR-043 | 2026-06-05 | Accepted, code shipped | Trace is vector-only; remove the Photo and Detailed trace presets |
| ADR-044 | 2026-06-09 | Accepted | Minimal Material/Interval Test calibration workflow |
| ADR-045 | 2026-06-09 | Accepted | Native Material Library IO foundation |
| ADR-046 | 2026-06-10 | Accepted | SVG import unit resolution (viewBox scaling + 96 DPI px) |
| ADR-047 | 2026-06-10 | Superseded by ADR-049 (chrome is now light | Design tokens + shared chrome classes (dark chrome, light bed) |
| ADR-048 | 2026-06-11 | Accepted | Metadata-less bitmap imports default to 254 DPI (LightBurn parity) |
| ADR-049 | 2026-06-13 | Accepted | Unified light chrome (supersedes ADR-047's dark-chrome decision) |
| ADR-050 | 2026-06-13 | Accepted | Module-level memoization caches in core/job (narrow exception to "no module-level mutable") |
| ADR-051 | 2026-06-14 | Accepted | Phase G: on-canvas drawing tools (shape SceneObject variant + tool-mode) |
| ADR-052 | 2026-06-17 | Accepted | Scanning offset compensation: a per-speed table cancels the bidirectional zipper |
| ADR-053 | 2026-06-17 | Accepted | Verified Origin: hand-set origin + mandatory verified frame for no-homing / hand-positioned machines |
| ADR-057 | 2026-06-24 | Accepted | Registration Box: camera-free placement jig |
| ADR-058 | 2026-06-25 | Accepted | Centerline trace rework: a measured pixel-centering bar + junction chaining |
| ADR-059 | 2026-06-25 | Accepted | Edge Detection trace mode: clean-room Canny → single-stroke vectors |
| ADR-060 | 2026-06-26 | Accepted | Offline-first PWA: installable service worker + safe update model |
| ADR-092 | 2026-06-24 | Accepted | Connect-time Device Setup wizard (manual, draft-commit, guarded firmware sync) |
| ADR-093 | 2026-06-26 | Accepted | In-app multi-library Material Library UI: create/edit wizard, Saved Libraries browser, auto-save |
| ADR-094 | 2026-07-02 | Accepted | Phase H multi-controller architecture: ControllerDriver seam + capability-gated UI |
| ADR-095 | 2026-07-02 | Accepted | Marlin controller support (queued status, stream-side pause, inline/fan dialects) |
| ADR-096 | 2026-07-02 | Accepted | Smoothieware controller support (fractional S power scale) |
| ADR-097 | 2026-07-02 | Accepted | Ruida: experimental .rd export, file-only transport |
| ADR-098 | 2026-07-02 | Amended by ADR-209 | CNC router mode becomes a first-class product track (Phase H "Router") |
| ADR-100 | — | Accepted | Trace quality rebuild: medial-axis Centerline, chained Edge Detection, true Sharp params |
| ADR-101 | 2026-07-02 | Accepted | CNC/laser UI separation policy: gate-and-hide |
| ADR-102 | 2026-07-03 | Accepted | three.js for the 3D relief viewer (explicit ADR-098 §2 override) |
| ADR-103 | — | accepted (maintainer session directive) | Market-parity build-out: sender workflows, vector booleans, 3D cut preview (2026-07-03) |
| ADR-104 | — | accepted (recorded at the merge of `claude/determined-dew... | Integration numbering: controllers keep 094–097 + Phase I; CNC renumbers to 098/101/102/103 + keeps Phase H (2026-07-03) |
| ADR-105 | — | accepted (maintainer directive: "make sure that we have | Easel-parity UX pack: persistent 3D pane, pocket raster fill, bundled design library (2026-07-03) |
| ADR-106 | — | accepted (maintainer-approved build plan, 2026-07-03) | Parametric finger-joint box generator: claim-model joinery (2026-07-03) |
| ADR-107 | 2026-06-27 | Accepted | Camera Mode: overhead-camera alignment (manual 4-point homography v1; staged v1–v4) |
| ADR-108 | 2026-06-28 | Accepted | Camera Mode v2: fisheye lens calibration + de-fisheye render |
| ADR-109 | 2026-07-03 | Accepted | Camera Mode v3: automatic marker alignment (no-click homography) |
| ADR-110 | 2026-07-03 | Accepted | Camera Mode v4: capture-to-trace at true bed coordinates |
| ADR-111 | — | accepted (maintainer directive after a real 4040 cut wand... | CNC beginner-mode UX pack: material picker, machine auto-fill, limit advisories, Basic/Advanced disclosure (Phase H.13, 2026-07-04) |
| ADR-112 | — | accepted (maintainer follow-up to ADR-111: on the live ap... | Project-level CNC material picker: set material once for the job (Phase H.14, 2026-07-04) |
| ADR-113 | — | accepted (maintainer-directed follow-up to the trace-fide... | Region-enhance re-trace (dialog boundary mode) (Trace fidelity, 2026-07-05) |
| ADR-114 | — | Accepted | Commercial legal pack: EULA, installer acceptance, shipped third-party notices (2026-07-05) |
| ADR-115 | — | accepted (maintainer-directed after rejecting ADR-059's l... | Edge Detection engine: local-contrast mask + potrace geometry (Trace fidelity, 2026-07-05) |
| ADR-116 | — | accepted (maintainer directive: "I need my box designer t... | Box generator v2: panel cutouts, divider grid, slide lid (2026-07-07) |
| ADR-117 | — | accepted | Keep-awake during active jobs: renderer screen wake lock, Electron permission allowlist (2026-07-07) |
| ADR-118 | — | amended (repository schema v3, exact-artifact provenance, execution archive, 2026-07-19) | Interrupted-job checkpoint: fingerprint-verified resume after a crash (2026-07-07) |
| ADR-119 | — | accepted | Box designer usability pack: fit test coupon, assembled 3D preview (2026-07-07) |
| ADR-120 | 2026-07-07 | Accepted | MIT license, open-source release (supersedes ADR-018) |
| ADR-121 | — | accepted | Machine-camera frames ride the loopback bridge: frame proxy and server-side discovery (Camera, 2026-07-07) |
| ADR-122 | — | accepted | Camera-driven positioning and burn-target alignment wizard (Camera, 2026-07-07) |
| ADR-123 | 2026-07-08 | Accepted | Own-engine trace: remove the potrace-derived backend (closes the ADR-120 blocker) |
| ADR-124 | — | accepted (maintainer directive: "jog the head to each cor... | Capture Board Corners: build the registration box from jogged machine coordinates (2026-07-08) |
| ADR-125 | — | accepted (maintainer directive: expand Place Board — chos... | Fill the board: auto-fit + array artwork onto the placed board (2026-07-08) |
| ADR-126 | — | accepted (maintainer directive: capture round boards - "o... | Generalize Place Board to a board-shape union; circle boards (2026-07-08) |
| ADR-127 | — | Accepted | Rotary axis engine: one machine-space job for chuck/roller Y-scaling (Phase N, 2026-07-09) |
| ADR-128 | — | Accepted | Measured-boundary trace pipeline: sub-pixel extraction, supersampling, and fair-then-fit finishing |
| ADR-129 | — | accepted (audit DEV-04: no-go zones gated Start/Frame/exp... | Enforce no-go/keep-out zones on app-initiated jog and click-to-position motion (2026-07-10) |
| ADR-130 | — | accepted (audit CAM-04: the Registration Jig panel could... | Registration-box provenance: protect a captured board from the jig panel (2026-07-10) |
| ADR-131 | — | accepted (audit ARC-01/ARC-02: core geometry ops throw us... | Canonical Result<T, E> for core control-flow errors (2026-07-11) |
| ADR-132 | — | accepted (audit ARC-03: the 250 soft tier promised by ADR... | The 250-line soft tier is a report-only script, not an ESLint warning (2026-07-11) |
| ADR-133 | — | accepted (audit ELE-02: residual-risk hardening of ADR-12... | Camera bridge trusts only the exact production origins and refuses all loopback frame-proxy targets (2026-07-11) |
| ADR-134 | — | accepted (Codex re-audit R2: the overlay applied a rectif... | The workspace camera overlay honors the alignment basis, matching Trace (2026-07-11) |
| ADR-135 | 2026-07-12 | Accepted | Gate desktop auto-update on a trusted, code-signed channel |
| ADR-136 | 2026-07-12 | Superseded | CNC interruption recovery rewinds to a retract-first safe boundary (see ADR-143) |
| ADR-137 | 2026-07-11 | Accepted | Trace reliability: latest request wins and completed work is reusable |
| ADR-138 | 2026-07-13 | Accepted | Primary toolbar is icon-first and never wraps |
| ADR-139 | 2026-07-13 | Accepted | Right workspace rails collapse independently with fail-visible machine controls |
| ADR-140 | 2026-07-13 | Accepted | CNC profile finish allowance and finishing pass |
| ADR-141 | 2026-07-12 | Accepted | Network-camera bridge is desktop and local-development only |
| ADR-142 | 2026-07-12 | Accepted | Production desktop tags require a valid Windows signature |
| ADR-143 | 2026-07-13 | Accepted (narrowed by ADR-215) | Disable executable CNC checkpoint and start-from-line recovery |
| ADR-144 | 2026-07-13 | Accepted | Parametric shape edits rematerialize canonical geometry |
| ADR-150 | 2026-07-13 | Accepted | Adopt bounded variable-data production as a Phase D extension |
| ADR-151 | 2026-07-13 | Accepted | Quick Nest uses bounded outline compaction with rectangular fallback |
| ADR-152 | 2026-07-13 | Accepted | Offset pockets may use locally tangent native helical entries |
| ADR-153 | 2026-07-13 | Accepted | Two-tool pocket rest machining uses bounded 2D stock subtraction |
| ADR-154 | 2026-07-13 | Accepted | Adaptive pockets require verified constant-load ring sequences |
| ADR-155 | 2026-07-13 | Accepted | Straight inlays compile as one radius-matched linked pair |
| ADR-156 | 2026-07-13 | Accepted | Manual CNC tabs use persisted normalized contour anchors |
| ADR-157 | 2026-07-13 | Superseded in part (ADR-228: Start qualification deleted) | Detected controller identity gates profile transport and output |
| ADR-158 | 2026-07-13 | Accepted | Browser smoke is independent from the release and deploy gate |
| ADR-159 | 2026-07-13 | Accepted | Schema v2 curves are canonical and compatibility polylines are invalidated |
| ADR-160 | 2026-07-13 | Accepted | Rotary raster is an explicit experimental amendment to ADR-127 |
| ADR-161 | 2026-07-13 | Accepted | Labs gates experimental laser features locally and fail closed |
| ADR-162 | 2026-07-13 | Accepted | Low-power Fire is profile-opted, hard-capped, and momentary |
| ADR-163 | 2026-07-13 | Accepted | Cut Planner exposes five persisted deterministic policies |
| ADR-164 | 2026-07-13 | Accepted | Adopt bounded offline editing and interoperability already shipped |
| ADR-171 | 2026-07-13 | Superseded in part (ADR-228: readiness no longer blocks Start) | Work-Z readiness uses source-qualified, epoch-bound evidence |
| ADR-172 | 2026-07-13 | Superseded by ADR-228 (demoted to Job Review warning) | Missing qualified work Z blocks CNC Start |
| ADR-173 | 2026-07-13 | Superseded in part (ADR-228: mismatch warns, not blocks) | Bind work-Z evidence to the compiled CNC tool plan |
| ADR-179 | 2026-07-13 | Superseded by ADR-228 (demoted to Job Review warning) | Block controller-reported active spindle/coolant before CNC Start |
| ADR-180 | 2026-07-13 | Accepted | Generic same-session CNC Resume is manual-recovery-only |
| ADR-181 | 2026-07-13 | Accepted | CNC Start requires epoch-bound exclusive-access attestation |
| ADR-182 | 2026-07-13 | Accepted | grblHAL MPG ownership is a latched CNC Start blocker |
| ADR-183 | 2026-07-13 | Accepted | Unexpected GRBL terminal responses invalidate controller ownership |
| ADR-184 | 2026-07-13 | Accepted | Probe cycles are exclusive, typed, and settlement-qualified |
| ADR-185 | 2026-07-13 | Accepted | Commit XYZ corner-probe offsets in one GRBL block |
| ADR-186 | 2026-07-14 | Accepted | Keep guided device setup machine-relevant and directly repairable |
| ADR-187 | 2026-07-14 | Accepted | Validate every supported laser G-code dialect with one property corpus |
| ADR-188 | 2026-07-14 | Accepted | Reject unproved XYZ corner-probe plate geometry before controller output |
| ADR-189 | 2026-07-14 | Accepted | Bind controller observations and Home proof to controller sessions |
| ADR-190 | 2026-07-14 | Accepted | Make vector power mode explicit per layer without changing defaults |
| ADR-191 | 2026-07-14 | Accepted | CNC 3D result pane is drag-resizable with a persisted width |
| ADR-192 | 2026-07-14 | Accepted | CNC frame retracts to safe Z, traces, then restores the pre-frame Z |
| ADR-193 | 2026-07-14 | Accepted | No-homing placement defaults to guided relative positioning |
| ADR-194 | 2026-07-14 | Superseded | Add native Hershey single-line CNC text without a runtime dependency (see ADR-213) |
| ADR-195 | 2026-07-14 | Accepted | Make the CNC layer card guided, honest, and narrow-panel safe |
| ADR-196 | 2026-07-14 | Accepted | Separate selection movement from ordinary geometry picking |
| ADR-197 | 2026-07-15 | Accepted | Let operators hide static canvas start markers without hiding live motion |
| ADR-198 | 2026-07-14 | Superseded | Add a pinned OFL EMS stroke-font family with lazy data loading (see ADR-213) |
| ADR-199 | 2026-07-14 | Superseded | Fair decorative stroke fonts with the shared trace cubic fitter (see ADR-213) |
| ADR-200 | 2026-07-14 | Amended (ADR-215) | CNC recovery is evidence-gated and software Abort is not an E-stop |
| ADR-201 | 2026-07-15 | Amended (ADR-209); Start gate superseded by ADR-228 | Gate CNC Start by protocol capability and exact override acknowledgement (see ADR-209) |
| ADR-202 | 2026-07-15 | Accepted | Separate burn raster fidelity from bounded preview and stream work |
| ADR-203 | 2026-07-15 | Amended | Recover Work-Z only from owned controller offset readback (see ADR-209) |
| ADR-204 | 2026-07-15 | Accepted | Refuse project saves that would normalize machine or output semantics |
| ADR-205 | 2026-07-15 | Accepted | Machine Setup is one controller-first atomic workflow |
| ADR-206 | 2026-07-15 | Accepted | Require explicit maintainer permission for every new guard |
| ADR-207 | 2026-07-15 | Amended | One layout-stable live-motion bar owns run controls |
| ADR-208 | 2026-07-15 | Accepted | Remove obstructive 4040 and advisory machine policies |
| ADR-209 | 2026-07-15 | Accepted | Remove universal CNC expiry, depth, override, and spin-up policies |
| ADR-210 | 2026-07-15 | Accepted | Enforce explicit machine output capability at every project entry point |
| ADR-211 | 2026-07-15 | Amended | Artwork binds explicitly to named process operations |
| ADR-212 | 2026-07-15 | Accepted | Make laser pause, recovery, disconnect, and laser-mode boundaries fail-dark |
| ADR-213 | 2026-07-16 | Accepted | Remove bundled single-line writing and retain the original four outline fonts |
| ADR-214 | 2026-07-16 | Accepted | Version-stamp pen-drawing fairing instead of re-deriving fitter output |
| ADR-215 | 2026-07-16 | Accepted | CNC recovery rewinds to a pass boundary and re-enters as a new sealed job |
| ADR-216 | 2026-07-16 | Accepted | Show CNC pass progress on the live canvas from the ADR-215 span sidecar |
| ADR-217 | 2026-07-16 | Accepted | Show the live controller feed rate on the canvas motion badge |
| ADR-218 | 2026-07-16 | Accepted | CNC line-art contour side selection (inner / outer / both) |
| ADR-219 | 2026-07-16 | Accepted | Centerline arc-length quadratic fairing (anti-wobble stage) |
| ADR-220 | 2026-07-16 | Accepted | Show the live spindle RPM on the CNC canvas motion badge |
| ADR-221 | 2026-07-17 | Accepted | Show wall-clock elapsed job time on the canvas motion badge |
| ADR-222 | 2026-07-17 | Accepted | Single-artwork scenes select the artwork by default |
| ADR-223 | 2026-07-17 | Accepted | Default CNC laptop layouts to Canvas Focus while preserving explicit 3D choice |
| ADR-224 | 2026-07-17 | Accepted | Pre-start Job Review dialog consolidates the Start confirmations |
| ADR-225 | 2026-07-17 | Accepted | Machine-rail control order, go-green actions, and origin coaching |
| ADR-226 | 2026-07-17 | Accepted | Add four reviewed OFL native-stroke fonts for CNC writing |
| ADR-227 | 2026-07-17 | Accepted | Status-bar Update button replaces the PWA update popup |
| ADR-228 | 2026-07-18 | Accepted (governing) | Frame-first Start gate: Frame is the sole guard |
| ADR-229 | 2026-07-18 | Accepted | Super console: expanded diagnostics and guarded command dialog |
| ADR-230 | 2026-07-19 | Accepted | Exact-artifact Frame authorization and one-use Start permit |
| ADR-231 | 2026-07-19 | Superseded in part by ADR-232 | A valid Frame proves physically safe motion and the live output contract |
| ADR-232 | 2026-07-19 | Accepted (governing) | Physical Frame completion is the spatial source of truth |
| ADR-233 | 2026-07-19 | Accepted | Revisioned machine-aware CNC starters initialize new operations without rewriting jobs |
| ADR-234 | 2026-07-19 | Accepted, hardware verification pending | Bounded feed-matched fill entries for the 4040-safe profile |
| ADR-235 | 2026-07-19 | Accepted, hardware verification pending | New laser traces default to materialized Raster/Image output |
| ADR-236 | 2026-07-19 | Accepted, hardware verification pending | Profile-scoped 4040 scan quality hardening |
| ADR-237 | 2026-07-21 | Accepted | Job Review runs at Start; plain Frame is dialog-free |
| ADR-238 | 2026-07-21 | Accepted | Laser trace output defaults to editable vectors; raster scan remains selectable |

---

## ADR-001 — Adopt LightBurn workflow as the product model

**Status:** Accepted | **Date:** 2026-05-26

### Context
LaserForge 2.0 enters a category dominated by LightBurn with credible open-source contenders. Users moving between tools expect a recognizable mental model.

### Decision
Adopt LightBurn's user-facing workflow and naming: workspace with bed dimensions, color-as-layer, Cuts/Layers window, preview in-viewport, Laser window for streaming control, `.lf2` project files analogous to `.lbrn`.

### Alternatives considered
- **Rayforge model:** rejected — smaller install base.
- **Invent a new workflow:** rejected — no evidence LightBurn's model is the bottleneck.
- **Clone LightBurn 1:1:** rejected — feature breadth contradicts ADR-010, ADR-015.

### Verification
A LightBurn user completes Phase A's primary flow on first launch without docs.

---

## ADR-002 — Fully clean rewrite — no port from LF1

**Status:** Accepted | **Date:** 2026-05-26

### Context
LF1 audit scored 9/10 on pipeline correctness, but the user's lived experience is shotgun surgery (Q10). A 9/10 module that breaks under maintenance is not 9/10.

### Decision
No code carries over from LF1. ADR-010 and ADR-015 govern.

### Alternatives considered
- **Port the pipeline:** rejected — coupling carried forward.
- **Refactor in place:** rejected — user explicitly chose "from scratch."
- **Port only pure modules:** rejected — drawing the line is itself coupling analysis.

### Verification
- **Clean-room confirmation:** `git log --diff-filter=A` shows every source file authored in the 2.0 repo; no file imported from LF1.
- **Behavioral parity sanity check (separate goal):** an LF1 fixture set is run through 2.0's pipeline; G-code output matches LF1 byte-for-byte where the two specify the same behavior, or each divergence is documented in `RESEARCH_LOG.md` with rationale. This is a correctness signal, not a re-implementation of the "no port" decision.

---

## ADR-003 — Ship both web app and Windows desktop from one codebase

**Status:** Accepted | **Date:** 2026-05-26

### Decision
One codebase, two build targets. Both share `core/`, `ui/`, `io/`. They differ only in `platform/web/` vs `platform/electron/`.

### Verification
Phase A: both builds open and complete primary flow; same `.lf2` opens losslessly in both.

---

## ADR-004 — Streaming to laser is in MVP; delivered in phases

**Status:** Accepted | **Date:** 2026-05-26

### Decision
Phase A file-only, Phase B streaming, Phase C polish. Each independently shippable.

### Verification
Phase A merges with all acceptance green before Phase B starts.

---

## ADR-005 — Color-driven layers; only Line mode in MVP

**Status:** Accepted | **Date:** 2026-05-26

### Decision
Color-driven Layers. Mode dropdown matches LightBurn's three options; only **Line** enabled in MVP. Fill and Image visible-but-disabled with tooltip. UI contract stable; future modes are `core/output` strategy implementations.

### Verification
SVG with five colors → five rows.

---

## ADR-006 — GRBL v1.1+ only; extensible strategy for future controllers

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- MVP ships **GRBL v1.1+ only**.
- `OutputStrategy` interface designed for multi-controller.
- Connection handshake refuses non-GRBL with clear error.
- **MIT availability of alternative controllers (CNCjs has Marlin/Smoothie/g2core/TinyG) does not change this.** ADR-017 explicitly notes that library availability is not a scope-expansion trigger.

### Verification
Connection handshake rejects non-GRBL. `OutputStrategy` is implementable by a stub `TestStrategy`.

---

## ADR-007 — Windows-only desktop; web app covers macOS and Linux

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- Desktop: Windows 10 and 11 only.
- macOS / Linux: web app only in MVP.
- electron-builder packages all three for free, but this ADR says ship one in MVP — same discipline rationale as ADR-006.

### Verification
Phase A: Windows `.exe` opens and runs on Windows 10 and 11.

---

## ADR-008 — MIT open source, public from first commit

**Status:** Superseded by ADR-018 (2026-05-27) | **Date:** 2026-05-26

### Decision
- License: **MIT**.
- Repo public from first commit.
- Permitted dependency licenses: MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD.
- Rejected: GPL family (GPL-2, GPL-3, AGPL, LGPL), proprietary, source-available (BSL, Elastic).
- Enforcement: `license-checker` runs in CI; GPL transitive deps fail the build.

### Verification
`LICENSE` in repo root. CI dependency audit fails on GPL.

### Why superseded
Phase B hardware verification on a real Falcon A1 Pro changed the
project's posture from "open-source from day one" to "private hobby
project that may become a commercial product." Public-then-private is
not reversible (forks persist), so the cautious option is private now
with the license decision deferred. The dependency policy (MIT-compatible
deps only) survives unchanged — that's about what we *consume*, not how
we *publish*. See ADR-018.

---

## ADR-009 — TypeScript + React + Vite + Vitest stack

**Status:** Accepted | **Date:** 2026-05-26

### Context
The stack needs to: (a) compile to both a static web bundle and an Electron renderer; (b) support strict typing with discriminated unions (required by ADR-010 and ADR-014); (c) host a snapshot/property/E2E test pyramid with low ceremony; (d) keep cold-start budgets achievable (web < 2 s, desktop < 3 s); (e) be familiar to a wide solo-dev contributor pool so the first outside PRs are not blocked by tooling.

### Decision
TypeScript strict, React 18 hooks, Vite, Vitest, `fast-check`, Playwright, Zustand, CSS Modules, ESLint with `eslint-plugin-boundaries`, Prettier.

### Alternatives considered
- **Svelte / SolidJS:** rejected — smaller talent pool; less battle-tested with `eslint-plugin-boundaries`-style module isolation; not worth the migration cost from a React-first plan.
- **Webpack instead of Vite:** rejected — slower dev loop; not necessary for our bundle size; Vite's ESM-first dev server keeps cold reload under a second.
- **Jest instead of Vitest:** rejected — Vitest is Vite-native, runs the same TS pipeline as the app, and has equivalent snapshot semantics.
- **Redux instead of Zustand:** rejected — Redux toolkit's boilerplate fights ADR-015 file-size limits; Zustand slices map naturally to one-responsibility-per-file.
- **Tailwind / Chakra / Mantine instead of CSS Modules:** rejected for MVP — UI surface is small and bespoke; UI frameworks impose a class-name namespace and runtime cost not justified by Phase A scope (revisit at Phase D).

### Verification
- `tsconfig.json` enforces `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (verified by intentional-error fixture in CI).
- `pnpm test` runs Vitest unit + property + snapshot suites green.
- `pnpm dev:web` cold-loads in < 2 s on a developer laptop; documented in Phase A acceptance.

---

## ADR-010 — Architectural discipline to prevent cascading regressions

**Status:** Accepted | **Date:** 2026-05-26

### Context
Q10's pain is shotgun surgery. Paired with ADR-015 which addresses the same problem from the file-size angle.

### Decision
Enforced in code, tests, CI:
1. Pure-function pipeline core. `core/` is pure.
2. No platform imports in core (ESLint boundaries).
3. Module public APIs explicit (only `index.ts` exposed).
4. Invariants property-tested via `fast-check`.
5. G-code output snapshot-tested.
6. Discriminated unions over flags, with exhaustiveness.
7. State updates reducer-pure.
8. Tests before fixes.
9. Exceptions require new ADRs.

### Verification
Deliberately-coupled commit rejected by CI. Bug-fix PR without regression test rejected. Snapshot diff acknowledged.

---

## ADR-011 — Platform adapter pattern for web vs Electron

**Status:** Accepted | **Date:** 2026-05-26

### Decision
One `PlatformAdapter` interface, two implementations. Responsibilities: file I/O, serial port, dialog, drag-and-drop. Adapter narrow (~12 methods). Adapter injected at React root.

### Verification
`MockAdapter` lets entire app run headless. Phase A E2E uses both real adapters.

---

## ADR-012 — Text + fonts as Phase D; bundle MIT fonts

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- Phase D feature, not MVP.
- **Bundled MIT-licensed fonts only.** No system font access. No user-uploaded fonts in MVP-D.
- `opentype.js` (MIT) for text-to-path.
- `TextObject` variant of `SceneObject` (ADR-014). Flows through Line pipeline.

### Verification
Phase D acceptance: typing each bundled font produces G-code that cuts at correct dimensions. Web and desktop produce byte-identical G-code.

### Open question
Specific font set TBD at Phase D kickoff. Likely candidates from OFL/MIT collections.

---

## ADR-013 — Image vectorize as Phase E feature, not MVP

**Status:** Accepted | **Date:** 2026-05-26

### Decision
- Phase E feature, not MVP.
- `imagetracerjs` (Unlicense — MIT-compatible). `potrace-wasm` rejected (GPL-2).
- `TracedImage` Scene object flows through Line pipeline.

---

## ADR-014 — SceneObject as discriminated union, extensible from day one

**Status:** Accepted | **Date:** 2026-05-26

### Decision
`SceneObject` is a tagged union: `imported-svg` (Phase A), `text` (Phase D), `traced-image` (Phase E). `JobCompiler` exhaustively pattern-matches with `assertNever` default arm.

### Verification
Phase A acceptance: stub `TextObject` variant compiles through `JobCompiler` without modifying existing tests.

---

## ADR-015 — File-size discipline and anti-god-file enforcement

**Status:** Accepted | **Date:** 2026-05-26

### Context
LF1's `App.tsx` was 1,631 lines. AI-assisted coding tends to pile into existing files. Enforcement (not aspiration) prevents recurrence.

### Decision
Hard limits enforced by ESLint (the soft tier is surfaced report-only, not by ESLint — see ADR-131):
- File: 400 lines hard, 250 soft
- React component: 250 hard, 150 soft
- Function: 80 hard, 40 soft
- Cyclomatic complexity per function: 12 hard, 8 soft
- Default exports per file: 1
- `index.ts` public exports: 20 hard, 10 soft

Plus: co-located tests required, single responsibility (no "and" in description), new-file-first default. See `CLAUDE.md` for operational rules.

### Verification
ESLint's `max-lines` rule is the authoritative gate and fails CI on violation: 400 lines **excluding blank and comment lines** (`skipBlankLines: true, skipComments: true`). CI additionally runs a coarse raw-line backstop (`wc -l`, threshold 600) that counts *every* line — including the explanatory comments CLAUDE.md mandates — purely as a guard against catastrophic bloat; its threshold is deliberately looser than the 400 code-line rule and is not the real limit.

The **soft** tier (250 counted lines/file) is **not** an ESLint warning — ESLint keys rules by name, so a second `max-lines` config for the same files *replaces* the error/400 one (last-wins) rather than stacking, so warn/250 and error/400 cannot coexist on the built-in rule (ADR-131). The soft tier is instead surfaced by the report-only `check:soft-size` script (`scripts/check-soft-line-limit.mjs`), which lists non-test files over 250 counted lines and **always exits 0** — it never blocks CI; only the ESLint error/400 rule does.

---

## ADR-016 — Documentation-as-spec: WORKFLOW.md and CLAUDE.md

**Status:** Accepted | **Date:** 2026-05-26

### Decision
Five spec documents, each with single audience and purpose, plus a README entry index:
- `README.md` — entry index (audience: humans landing on the repo)
- `PROJECT.md` — scope, non-negotiables, phase plan
- `WORKFLOW.md` — detailed user flows (4 states each)
- `DECISIONS.md` — ADRs
- `CLAUDE.md` — Claude Code operating manual
- `RESEARCH_LOG.md` — external claims and library adoptions

`PROJECT.md` references the others rather than duplicating. `README.md` is an index, not a spec — it must never carry decision rationale or workflow details (those live in the dedicated docs).

### Verification
Reviewer answers "what should this UI do?" from `WORKFLOW.md` alone; "why this architecture?" from `DECISIONS.md` alone. Claude Code session opens by reading `CLAUDE.md`.

---

## ADR-017 — Third-party library evaluation policy; DOMPurify pinned for Phase A

**Status:** Accepted | **Date:** 2026-05-26

### Context
The project source code is proprietary (ADR-018) but uses MIT-compatible dependencies freely (the dep-policy half of the original ADR-008 survived into ADR-018 unchanged). The user has indicated that "if there is proven MIT code for extra features, we can do research and add it." This is a powerful capability — well-maintained libraries reduce bug surface, and proven implementations are often safer than hand-rolled equivalents.

It is also the most common cause of project drift. "We can add X because the library is free" is the most common rationalization that leads to scope explosions, dependency bloat, and the exact cascading-bug pattern Q10 warned against. Library availability does not change product scope. The phase plan in `PROJECT.md` is what determines what ships when.

This ADR defines the policy that lets us adopt third-party code safely.

### Decision

**Policy.** A third-party library may be adopted as a runtime dependency only when **all** of the following are true:

1. **It serves a use case in the current phase or an earlier phase's debt.** Not "it might be useful later." Speculative dependencies are rejected. Future-phase libraries are *evaluated* at the start of their phase, not adopted preemptively.

2. **Its license is in the permitted list** (ADR-008): MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD. The license is verified against the package's actual `LICENSE` file, not just the npm metadata.

3. **It is actively maintained.** Last release within 12 months, no unresolved security advisories in the version we'd pin, issue response time visible in the repo.

4. **It fits the architecture.** Specifically:
   - Does not require global state.
   - Does not throw for control flow (or its throws are catchable at a clear boundary).
   - Works in both web and Electron with no platform-specific patches.
   - If it lives in `core/`, it is pure (no I/O, no side effects). If it does I/O, it lives in `platform/` or `io/`.
   - Does not introduce a competing pattern for state, routing, styling, or data flow.

5. **Bundle-size impact is acceptable.** Web bundle target is < 1 MB compressed. New dependency must show its compressed contribution. If it pushes past budget, alternatives must be evaluated.

6. **CVE status is clean.** The pinned version must have no unfixed critical or high CVEs. Recent CVEs in earlier versions are acceptable if the fix is in the pinned version and noted in `RESEARCH_LOG.md`.

7. **Adoption is logged.** Every adopted dependency gets a `RESEARCH_LOG.md` row: name, version, license, last release date, justification, evaluation date, who evaluated, alternatives considered.

**Anti-policy.** A library is *not* adopted because:
- "It's the standard." (Investigate why; the standard may not fit our architecture.)
- "It would be nice to have feature X." (Feature X is in or out per the phase plan, not per library availability.)
- "Everyone uses it." (Audit it like anything else.)
- "It saves time." (Maybe — measure the time saved against the maintenance, dependency-update, and CVE-watching tail.)

**Phase-by-phase evaluation, not bulk adoption.** Library decisions are made at the start of each phase, against a concrete acceptance bar. Libraries pinned for phases not yet started are anticipations, not commitments.

### Phase A library decisions (pinned now)

| Use case | Library | Version | License | Notes |
|---|---|---|---|---|
| SVG parsing | native `DOMParser` | n/a | n/a | Available in browser and via jsdom in Node tests. No dependency. |
| SVG sanitization | **DOMPurify** | **>= 3.3.2** | MPL-2.0 OR Apache-2.0 | Verified MIT-compatible. CVE-2026-0540 fixed in 3.3.2. Used with `USE_PROFILES: { svg: true, svgFilters: true }` and a custom hook stripping external `xlink:href` and non-image data URIs. |

That's the only new runtime dependency Phase A adds. Everything else in Phase A is in `package.json` already from the stack choice (React, Vite, Zustand, Vitest, fast-check, ESLint plugins).

### Phase B library candidates (evaluated at Phase B kickoff)

| Use case | Candidate | Notes |
|---|---|---|
| GRBL protocol reference | **CNCjs** source code | MIT (github.com/cncjs/cncjs). Read for protocol details. **Not adopted as a dependency** — too large, brings its own architecture. |
| Serial port (Electron) | `serialport` | MIT, the standard for Node serial. Phase B-only. |
| Serial port (web) | native `Web Serial API` | n/a, no dependency |

### Phase C library candidates

| Use case | Candidate | Notes |
|---|---|---|
| Path simplification | `simplify-js` | BSD-2-Clause (compatible). Douglas-Peucker; tiny. |
| Polyline flattening | `flatten-svg` | ISC (verified via npm metadata; ISC is in the permitted list per ADR-008). Alternative to hand-rolled bezier subdivision. |

### Phase D / E candidates already pinned in ADR-012 / ADR-013

- `opentype.js` (MIT) — Phase D text-to-path.
- `imagetracerjs` (Unlicense — MIT-compatible) — Phase E raster trace.

### What this policy explicitly rejects

- Adopting `cncjs` as a dependency to "support more controllers in MVP" — ADR-006 stands.
- Adopting raster-dither libraries to "add Fill mode to MVP" — ADR-005 stands.
- Adopting `paper.js` or `fabric.js` to "make rendering easier" — they introduce a competing data model and would require pipeline changes. Our Canvas2D approach is sufficient.
- Adopting `electron-builder` macOS / Linux targets to "support more OSes" — ADR-007 stands.

### Alternatives considered for the policy itself

- **No policy (treat every dep as a one-off decision):** rejected — exactly the kind of unrigorous adoption that bloats projects.
- **Stricter policy (no new deps without a full RFC):** rejected — too heavyweight for solo development.
- **Centralized "dependency review" step in CI:** considered. The `license-checker` plus `RESEARCH_LOG.md` discipline plus this policy provides the same protection at lower process cost.

### Consequences
- Easier: justifiable adoption decisions; clean license audit; CVE tracking; bounded bundle size.
- Harder: no quick "throw a library at it" shortcuts. Every new dep is a small ADR-shaped artifact in `RESEARCH_LOG.md`.

### Verification
- Phase A CI includes `license-checker` step.
- `RESEARCH_LOG.md` has an entry for DOMPurify before the first PR that imports it lands.
- Future PR that adds a runtime dependency without a `RESEARCH_LOG.md` entry is rejected by CI lint (custom rule).

---

## Open items

1. ~~**Phase A fixture corpus.** Five SVG fixtures for snapshot tests.~~ ✅
   Shipped — see `src/__fixtures__/svg/` (rectangle-single-color,
   two-color-paths, multi-shape, closed-polygon, zigzag).
2. ~~**Bundled MIT fonts list** for Phase D~~ ✅ Resolved at Phase D
   kickoff. The set that actually shipped (LU34 doc correction): Roboto
   (Apache-2.0), Inconsolata, Pacifico, and Dancing Script (all OFL-1.1),
   at `src/ui/text/fonts/`. (The kickoff note named Inter and Source Code
   Pro and a `src/fonts/` path that never shipped.)

## ADR-018 — Proprietary license, private repo (supersedes ADR-008)

**Status:** Accepted | **Date:** 2026-05-27

### Context
ADR-008 committed the project to MIT and a public repo from the first
commit. That made sense when the project was "open-source CAM tool for
GRBL lasers." After Phase B verified on real hardware (Creality Falcon
A1 Pro: connect, autofocus, frame, full burn cycle all working), the
owner's posture shifted: this may become a commercial product, and the
monetization model isn't decided yet.

The asymmetry is the deciding factor:
- **Public-then-private is not reversible.** Forks of an MIT version
  persist forever; you can re-license future versions but cannot
  retract the prior one.
- **Private-then-public is one toggle.** Costs nothing to defer.

Per the safety principle in CLAUDE.md ("when you don't know — say
so"), choosing irreversibly in either direction without a clear
monetization plan would be premature.

### Decision
- **License: All Rights Reserved.** `LICENSE` is a proprietary notice;
  no permission granted to use, copy, modify, or redistribute.
- **Repo visibility: private.** GitHub Free supports unlimited
  private repos, so this costs nothing.
- **Dependency policy preserved from ADR-008.** Permitted licenses:
  MIT, BSD-2/3, Apache-2.0, MPL-2.0, ISC, Unlicense, 0BSD. Rejected:
  GPL family, source-available (BSL, Elastic), proprietary.
  Rationale: deps are about what we consume, not how we publish; an
  MIT-compatible dep tree keeps every future license option open
  (commercial, dual, OSS, hybrid).
- **`LICENSE` carries a note** that third-party deps remain governed
  by their own upstream licenses — covers redistribution mechanics
  cleanly without re-licensing the deps under our notice.

### Alternatives considered
- **Keep MIT, go private.** Confusing: MIT permits everyone to use the
  software but private repo hides the source, defeating the OSS
  contract. Mixed signal.
- **MIT + public + dual-license commercial later.** Works for some
  projects (Qt) but locks the upstream-OSS version forever; anyone
  building a competing product just forks the MIT version. Wrong
  default for "might monetize, no plan yet."
- **AGPL public.** Preserves commercial leverage (SaaS competitors
  must open their stack) but burns the goodwill of "free hobby tool"
  framing and is hostile to the diode-laser hobbyist audience.
- **BUSL / source-available.** Closest to "I'll decide later." Heavier
  legal footprint than a simple proprietary notice and we don't need
  source-available framing for a private repo.

### Verification
- `LICENSE` in repo root reads "All Rights Reserved" (verified at
  initial commit).
- New GitHub repo created with visibility set to Private.
- `README.md` License section names the proprietary status.
- `pnpm license-check` still enforces the dependency-license allow-list
  (the ADR-008 dependency policy survives unchanged).

### Reversal triggers
Promote to a permissive license (MIT, Apache-2.0) or source-available
(BSL, Elastic) when *any* of the following becomes true:
1. Monetization model is decided and an OSS release supports it
   (e.g., open-core, hosted-paid, support-paid).
2. External contributors materially help and need a contributor
   license that proprietary doesn't allow.
3. A community fork would help adoption more than control does.

Reversal requires a new ADR superseding this one.

---

## ADR-019 — Phase F kickoff: Fill is a geometry decision in `compileJob`

### Status | Date
Accepted | 2026-05-28

### Context

PROJECT.md flagged Phase F (raster engrave) as needing a new revision +
DECISIONS.md entry before code. Phase F has two sub-modes — Fill (hatch
lines inside a closed contour) and Image (per-pixel S-modulation raster)
— that share dispatch infrastructure but produce very different G-code
shapes.

The dormant `LayerMode = 'line' | 'fill' | 'image'` enum (added in ADR-005
for forward compatibility) is the natural activation point. `compileJob`
currently switches only on `SceneObject.kind` (`imported-svg`, `text`,
`traced-image`) and ignores `layer.mode`. `grbl-strategy` hardcodes M3
and emits one S-value per CutGroup.

Phase F has been split into F.1 (Fill) and F.2 (Image). F.1 ships first
per the surgical-changes principle: it adds no new G-code shape, only
more polylines. F.2 will introduce the harder pieces (RasterImage scene
object, M4 mode, dithering, overscan, streaming) in a follow-up kickoff.

### Decision

For **Fill (F.1)**: hatch-line generation happens at **compile time** in
`compile-job.ts`, NOT at G-code emit time in `grbl-strategy.ts`. When a
layer's mode is `'fill'`, `appendPathSegments` replaces the per-color
polylines with the output of `fillHatching()` (scanline polygon fill,
even-odd rule) BEFORE applying the object's transform. The resulting
hatch lines flow through the existing CutSegment → grbl-strategy emit
path unchanged.

For **Image (F.2)**: separate emit path in `core/output/emit-raster.ts`
(not yet written). The CutGroup's source object kind will discriminate
between vector emit (line/fill, M3) and raster emit (image, M4).
Decisions deferred to F.2 kickoff.

Two new fields on `Layer`: `hatchAngleDeg: number` (0..180, default 0)
and `hatchSpacingMm: number` (default 0.2 mm ≈ 5 lines/mm). Pre-F.1
`.lf2` files back-fill defaults in `deserializeProject`'s
`normalizeLayer` — additive-with-default, no `schemaVersion` bump
(matches the D.1.a `letterSpacing` precedent).

### Alternatives considered

1. **Push Fill dispatch into `grbl-strategy`** — would require passing
   `layer.mode` into the strategy + duplicating the scanline math in any
   future OutputStrategy (Marlin etc.). Rejected: violates single
   responsibility (G-code emit shouldn't do geometry decisions).
2. **New SceneObject variant `FilledRegion`** — would require the user
   to explicitly create fill objects rather than flipping a layer mode.
   Rejected: every other CAM tool (LightBurn, LaserGRBL) keeps Fill as
   a layer attribute on existing geometry. Mode-on-layer matches user
   expectation and reuses the existing color-layer plumbing.
3. **Adopt `polygon-fill` / `flatten-svg` for the scanline math** —
   evaluated per ADR-017. `flatten-svg` doesn't do hatching. No
   maintained MIT-licensed JS library covers exactly our use case
   (closed polyline + hatch angle + spacing → hatch lines). Self-implement
   in ~150 LOC; documented in RESEARCH_LOG.md Phase F entry.

### Consequences

- `compile-job.ts` grows by ~30 LOC (the mode branch + the fillHatching
  invocation). Still well under file-size caps.
- `fill-hatching.ts` is a new pure-core module (no new dependencies).
- Existing G-code invariants (`findLaserOnTravelIssues`,
  `findOutOfBoundsCoords`) keep working unchanged — hatch lines are
  ordinary CutSegments.
- `Layer` gains two fields, surfaced in the UI only when `mode === 'fill'`.
  Older `.lf2` files load with defaults via the existing back-fill pattern.
- F.2 sketches a separate emit path; this ADR explicitly does NOT commit
  the image-engrave architecture. A future ADR-020 will cover it.

### Verification

- 10 unit + property tests for `fillHatching` cover: angle 0/90 symmetry,
  donut holes (even-odd rule), open polylines (skipped), degenerate input,
  spacing clamp, angle normalization, determinism.
- `compile-job.test.ts` proves that `layer.mode='fill'` on a 10mm square
  emits multiple 2-point segments (hatches) instead of the original 5-point
  outline, and that open polylines emit nothing.
- `project.test.ts` proves pre-F.1 `.lf2` files back-fill `hatchAngleDeg=0`
  and `hatchSpacingMm=0.2`.
- Hardware: F.1.f checklist on the Falcon (20mm square + 30mm letter "O").

---

## ADR-020 — Phase F.2 raster image engrave (kickoff)

### Status | Date
Accepted (kickoff — no code yet) | 2026-05-28

### Context

ADR-019 sketched F.2 as deferred. PROJECT.md Phase F.2 description
captures the surface — `RasterImage` SceneObject variant, M4 dynamic
mode, per-pixel S-modulation, dithering, overscan, streaming. The
research plan parked five open questions for this kickoff:

1. M3 vs M4 wiring — Layer field, DeviceProfile field, or hardcoded
   per layer.mode?
2. Dithering library vs roll-our-own — re-evaluate `floyd-steinberg`
   npm package vs ~30 LOC self-implementation?
3. Streaming vs materialize — at what byte-threshold do we switch
   from string concatenation to a generator-emit?
4. Preview rendering — Canvas2D drawing a million tiny lines is slow.
   Need a downsampled / image-blit preview.
5. Hardware test — real engrave of a 50×50 mm photo on the Falcon.

This ADR commits answers to 1-4 so F.2 implementation has a clear
target. Question 5 is hardware verification, not an architecture
decision; it lives in the F.2.f acceptance checklist.

### Decision

**Q1 — M-mode wiring: hardcoded per `layer.mode`.** Image groups emit
M4 (dynamic — power scales with feed); line/fill groups emit M3
(constant). No Layer field, no DeviceProfile flag. Rationale: the
M3/M4 choice is dictated by what the laser is doing (cut/engrave vs
raster), not the operator's preference. Exposing it as a knob invites
misconfiguration. If a controller variant later needs M3 for raster,
add a `forceMMode` field on DeviceProfile then.

**Q2 — Dithering: roll our own.** Three reasons:
- The `floyd-steinberg` npm package was last published 2017; would
  fail ADR-017 maintenance check.
- The algorithm is ~30 LOC of well-known math (error-diffusion table
  + serpentine scan) — every CAM tool implements it inline.
- Three modes ship: `threshold` (single-cutoff), `floyd-steinberg`
  (greyscale error-diffusion), `grayscale` (direct luma → S, no
  dithering — for lasers that support 256-level S). Pure functions in
  `src/core/raster/dither.ts`.

**Q3 — Streaming: write the full string up to 100 KB; generator past
that.** A 50×50 mm photo at 5 lines/mm is ~250 lines × ~30 chars =
7.5 KB — fits in memory. A 200×200 mm photo at 10 lines/mm balloons
to ~6 MB — must stream. The 100 KB threshold matches the heuristic
the AUDIT.md A6 mitigation already uses for bundle splits (the order
where allocation becomes user-visible). Implementation: emit-raster
returns either a `string` or an `AsyncIterable<string>`; the file/
serial writer adapts.

**Q4 — Preview: Canvas2D `drawImage` of the source raster, scaled to
the object's mm-bounds.** No per-pixel paths in the draw loop. The
RasterImage carries an `<img>`-loadable data URL — drawing it through
Canvas2D's `drawImage` with a matrix transform is hardware-accelerated
and avoids the million-line problem. Engraving G-code visualisation
(the "what will burn") is a separate render layer we'll add later if
needed; for the MVP, "here is the image at the right place and size"
is the preview.

**New SceneObject variant `RasterImage`:**
```ts
{ readonly kind: 'raster-image';
  readonly id: string;
  readonly source: string;        // filename
  readonly dataUrl: string;       // PNG data URL, embedded in .lf2
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly bounds: Bounds;        // mm bounds (mm-per-pixel from DPI)
  readonly transform: Transform;
  readonly dither: 'threshold' | 'floyd-steinberg' | 'grayscale';
  readonly linesPerMm: number;    // 5..25 typical; user-settable
}
```

**New Layer mode arm** — when `layer.mode === 'image'` and the layer's
group source is a RasterImage, `compileJob` emits a `RasterGroup`
discriminant that `emit-gcode.ts` dispatches to `emitRaster` instead
of the existing `emitGroup`. Non-RasterImage objects on an image-mode
layer warn and skip (similar to the Fill+open-polyline pattern).

### Alternatives considered

1. **Inline-base64 elsewhere or external file references.** Keeping
   the image data IN the `.lf2` was confirmed by the user this session
   for self-containment — losing the source raster would lose
   re-trace / re-dither ability.
2. **One generator-only emit path.** Always-stream is simpler but
   pessimises the common case (small image). The 100 KB threshold
   adds ~10 LOC and avoids the heap pressure on big jobs.
3. **`canvg` for image-on-canvas preview.** Heavier than necessary —
   we already have a decoded `HTMLImageElement` from `image-loader.ts`,
   so `drawImage` is the surgical-changes answer.

### Consequences

- New module `src/core/raster/` (dither, emit-raster, preview-data).
  Stays pure-core; no I/O.
- `scene-object.ts` gains the `RasterImage` variant; `compileJob`,
  `draw-scene`, and `serializeProject` get one new switch arm each.
  ESLint's exhaustiveness rule (ADR-019) makes the missing arms
  surface as TypeScript errors — the same enforced TODO list.
- `Layer` mode UI: enable the third dropdown option ('Image'), gate
  the dither + lines-per-mm inputs on it.
- `.lf2` schema gains the `raster-image` SceneObject. Back-fill is
  one-way (old files have no RasterImage). Bump schemaVersion only
  if old code needs to refuse new files; for now, additive-only.
- Bundle impact: zero. We don't adopt a new lib. The base64 image
  bytes live in user data, not in the build.
- Hardware verification (F.2.f) goes on the Falcon checklist before
  ship: 50×50 mm photo at 5 lines/mm, threshold + floyd-steinberg
  modes both burn without overheating.

### Verification

To be written WITH the implementation, not before:

- Unit tests for `dither.ts`: each algorithm round-trips a known
  luma-to-S mapping; property-test bounds + power-scale invariants.
- Unit tests for `emit-raster.ts`: a 4×4 fixture → known byte stream;
  overscan adds N mm of S0 travel at each row end.
- Snapshot test: a 16×16 fixture image at 5 lines/mm produces
  byte-identical G-code to a recorded snapshot.
- Determinism property: same RasterImage + same options → identical
  G-code over 100 fuzz seeds (the dither itself is deterministic
  given seed; we use 0 as the default seed).
- Hardware: 50×50 mm photo on the Falcon at 5 lines/mm and 10 lines/mm
  with each of the three dither modes.

### Out of scope for F.2

- Multi-pass raster (deep engrave). Single pass only.
- Per-row feed/power schedules (uniform across the image).
- Photo presets ("portrait", "landscape", "logo"). User picks
  dither + lines-per-mm; everything else uses Layer defaults.
- Multi-image compositing on the same layer. One RasterImage per
  layer for v1.
- Rotary-axis raster. PROJECT.md "Out of scope" still applies.

### Post-kickoff additions (decided during F.2 implementation)

These tweaks landed AFTER the kickoff Decision section was written,
in response to observed UX and hardware behaviour. Recording them
here so the ADR reflects what actually shipped.

1. **Skip blank rows during emit.** When a raster row contains no
   non-zero S-values, `emitRasterGroup` emits zero G-code for it
   (no G0, no G1). The controller plans an oblique rapid from the
   end of one active row to the start of the next. Saves time on
   banner-shaped images with empty bands above / below content.
   Rationale: matches what LightBurn / LaserGRBL do in practice
   for image-mode emit; ADR-020 originally specified "every row
   sweeps" which over-emits for sparse content.

2. **Clip rows to their active span.** For non-blank rows, the
   sweep starts at the first non-zero pixel (minus overscan) and
   ends at the last non-zero pixel (plus overscan). Was: full
   `bounds.minX - overscan` → `bounds.maxX + overscan` regardless
   of where pixels actually fell. Combined with #1, removes all
   wasted travel-at-feed across white space.

3. **draw-raster.ts transform composition.** `drawRasterImage`
   originally composed its Canvas2D `translate / rotate / scale`
   around the bounding-box centre and drew at `(-w/2, -h/2)`. That
   diverged from `applyTransform`'s scale-then-translate-around-
   origin math by `w * (1 - scaleX) / 2` for any `scaleX != 1`,
   so the rendered image drifted away from the selection box when
   `fitObjectToBed` auto-scaled a large import. Replaced with
   `translate(t.x, t.y) → rotate → scale → drawImage(bounds.minX,
   bounds.minY, w, h)` which mirrors `applyTransform` exactly.
   Regression test in `src/ui/workspace/draw-raster.test.ts` pins
   the convention against future refactors.

### Verification (now landed, not deferred)

Tests covering the items above:

- `src/core/raster/dither.test.ts` — 12 unit tests for the three
  algorithms (threshold / FS / grayscale).
- `src/core/raster/emit-raster.test.ts` — 20 unit tests: preamble
  / postamble, row layout, S-modulation, invariants, validation,
  skip-blank-rows, clip-active-span.
- `src/core/raster/emit-raster.property.test.ts` — 5 fast-check
  property tests, 100 fuzz seeds each: laser-off-on-travel
  (#3 non-negotiable), determinism (#5), X and Y coords inside
  bounds ± overscan, G0-per-row count never exceeds non-zero-rows
  count.
- `src/ui/workspace/draw-raster.test.ts` — 9 regression tests
  covering the transform-composition fix: identity, translated,
  scaled-down, scaled+translated, rotated 30°/90°, mirrored X/Y,
  full combo. Each asserts the draw-raster math matches
  `applyTransform` for all four image corners.

Hardware (F.2.f) is still user-driven per the WORKFLOW.md F-F2
checklist; not gated by these tests.

---

## ADR-021 — Phase F.3 set-work-origin via G92 (kickoff)

**Date:** 2026-05-28
**Status:** Accepted, code shipped, hardware verification pending.

**Context.** PROJECT.md's "Future feature notes" listed an operator
flow where the user jogs the laser head to a corner of the workpiece
and presses a button to declare "this is (0, 0) for the next job."
Standard CAM convention; LightBurn ships it as "Set Job Origin to
Current Position." Closes a gap experienced operators expect.

GRBL supports two mechanisms for this:

- `G92 X0 Y0` — transient; modifies the active WCS's machine-to-work
  offset. Cleared by GRBL on alarm, soft reset (`\x18`), power-cycle,
  or `$RST=#`. Matches LightBurn / LaserGRBL UX (each session starts
  with a clean origin).
- `G10 L20 P1 X0 Y0` — persistent; sets the G54 origin itself.
  Survives reset / reconnect. Reset is more involved (`G10 L2 P1
  X0 Y0` with head at machine zero, or `$RST=#`).

**Decision.**

1. **Ship G92 only.** Defer G10 L20 P1 (persistent mode) until a user
   requests it. Karpathy smallest-first; two modes is two UX surfaces
   to design and document, and we lack signal that anyone wants the
   persistent variant.
2. **Don't change the compile pipeline.** GRBL applies the WCS offset
   to absolute-G90 G-code at run time, so emitted coordinates already
   honour the offset. No new SceneObject fields, no `.lf2` schema
   change.
3. **Cache WCO in laser-store across status frames.** GRBL reports
   the WCO field intermittently (every Nth status per the WCO bit of
   `$10`), so the most recent frame's WCO is null ~29 times out of 30.
   UI consumers read `wcoCache` (last-seen value), never the raw
   `statusReport.wco`. The two-sources-of-truth boundary is documented
   in the parser's JSDoc; a future lint rule could enforce it.
4. **Defer preflight + Frame updates.** Bed-bounds preflight currently
   assumes origin = machine zero. A job that "fits the bed" in
   scene-mm may still run off-machine if the operator set origin near
   the workpiece edge. Mitigation: existing Frame button traces the
   actual machine path (post-WCS-offset), so framing AFTER set-origin
   reveals off-bed risk before the laser fires. Documented gap;
   surface origin-aware preflight in a follow-up if users hit it.
5. **Don't auto-write `$10`.** Adding a runtime check on connect is
   cheap, but toasting "your config is unusual" for a non-default
   `$10` is operator-hostile. WCO is reported on a separate bit from
   MPos/WPos so origin math works regardless.

**Cache invalidation.** `wcoCache` is cleared in three places, matching
the three ways GRBL clears G92 itself:

- `disconnect()` and the `onClose` callback (port drop / reconnect).
- `stopJob` (sends `\x18` soft reset).
- `'alarm'` branch in laser-line-handler (GRBL clears G92 on alarm 1).

Together these match GRBL's actual behaviour — operators never see a
"stale cache shows custom origin while GRBL says machine zero" state.

**MIT references consulted** (per ADR-017; algorithms / protocol
docs only, no code copied):

- CNCjs (`cncjs/cncjs`, MIT) — `src/server/controllers/Grbl/GrblController.js`
  caches WCO across status frames and surfaces "WCS offset active"
  in its UI. We re-implement the pattern, not the code.
- gnea/grbl wiki (public-domain) — `Interface.md` documents the WCO
  emission cadence and `$10` mask bits;
  `Grbl-v1.1-Configuration.md` documents G92 / G92.1 semantics under
  alarm and reset.
- grblHAL `core/grbl.md` (public-domain) — confirms vanilla GRBL 1.1
  behaviour.
- NOT consulted: LaserGRBL, gSender (both GPLv3). UX choices
  observable but no code reading per ADR-017.

**Consequences.**

- Operators get LightBurn-parity workpiece-relative jobs.
- Two new buttons (`Set origin here` / `Reset origin`) in
  `JobControls.tsx`, status-bar readout in `StatusDisplay.tsx`.
- `laser-store.ts` gains `wcoCache` field + two thin action wrappers.
- `StatusReport.wco` is parsed but UI must not read it directly
  (flicker). Comment in `status-parser.ts` flags this; convention
  enforced socially.
- Bed-bounds preflight gap remains; operators framing first remains
  the recommended safety check.
- 1 toast per Set/Reset action provides immediate feedback during
  the WCO-frame latency window (~0.25-7.5s).

---

## ADR-025 — Perceptual fidelity harness for the trace pipeline

**Date:** 2026-05-29
**Status:** Accepted, harness shipped, scope limits documented below.

**Context.** Every trace test we had asserted *structure* — path
counts, polyline lengths, SVG prefixes, contour topology. None rendered
the output and asked the only question an operator actually cares about:
"does the trace cover the source image's ink?" A test suite can be fully
green while the trace is visibly wrong, because nothing measured the
rendered result against the input. This is exactly the gap behind the
recurring "you keep telling me it works, but vs LightBurn it's faulty"
complaint: green `pnpm test` was never evidence of perceptual quality.
The standing rule (see CLAUDE.md "When you don't know — say so", and the
session feedback constraint) is to never call trace / fill / engrave
"working" on the basis of a green structural suite alone.

We needed a measuring instrument: render trace output back to pixels and
diff it against a known-correct mask.

**Decision.**

1. **Build a render-and-diff harness under `src/__fixtures__/perceptual/`,
   zero new dependencies, pure TypeScript.** It lives in `__fixtures__`
   (boundary- and coverage-exempt per `eslint.config.mjs`), so it may use
   `node:fs` / `node:zlib` / `process` for the opt-in artifact dump
   without violating the pure-core globals rule. No runtime dependency is
   added, so no RESEARCH_LOG / ADR-017 evaluation is required.

2. **Ground truth is analytic, not a stored golden file.** Each synthetic
   fixture (`shapes.ts`) is a black-on-white bitmap whose inked region is
   a closed-form predicate sampled at pixel centres. The *same* predicate
   fills both the source image the tracer sees and the truth mask. So the
   truth is, by construction, exactly the set of black pixels in the
   source — it cannot drift out of sync with the fixture, and there are no
   golden PNGs to re-bless on every discretization tweak.

3. **Rasterize trace output with an even-odd scanline fill**
   (`rasterize.ts`), modelled on the existing `fill-hatching.ts` parity
   rule (half-open `[yLo, yHi)`, pixel inked iff its centre is inside an
   odd number of closed contours). Even-odd is load-bearing: it keeps hole
   topology correct, so a letter "O" / ring / square-glyph stays hollow
   instead of flooding.

4. **Compare via IoU + precision / recall / f1 / agreement**
   (`compare.ts`). IoU (Jaccard) is the headline number; precision and
   recall separate over-inking from missed ink when it regresses.

5. **Test the measuring instruments themselves first.** `rasterize.test.ts`
   and `compare.test.ts` pin the rasterizer and comparator against
   hand-computed pixel counts and overlaps *before* either is trusted to
   judge the tracer. If the instrument is wrong, the harness lies — so the
   instrument gets the first, strictest tests.

6. **Opt-in visual proof, off by default.** `png.ts` writes a
   `[ground truth | predicted | diff]` PNG per fixture to
   `perceptual-artifacts/` only when `PERCEPTUAL_ARTIFACTS=1` (self-
   contained 8-bit-RGB encoder via `node:zlib`; diff legend green=TP,
   red=FP, blue=FN). Normal `pnpm test` writes nothing; the directory is
   gitignored. A green "IoU=0.97" is still invisible — this makes the
   result eyeballable on demand.

**Measured baselines** (2026-05-29, Line Art preset — the import dialog's
default — imagetracerjs current pin):

| Fixture | IoU | Residual cause |
|---|---|---|
| solid-square | 1.000 | — |
| plus-stroke | 1.000 | — |
| square-glyph | 1.000 | hole preserved |
| filled-disc | 0.986 | circle → polygon discretization |
| ring-annulus | 0.978 | curved boundary, both edges |

Per-fixture floors in `trace-perceptual.test.ts` sit just under these
(square/plus/glyph 0.97, disc/ring 0.95): a real fidelity regression
trips the test while normal discretization noise does not.

**Finding — `DEFAULT_TRACE_OPTIONS` degenerates on binary input.** While
baselining, the harness *measured* (did not assume) that the bare
`DEFAULT_TRACE_OPTIONS` collapses to IoU ≈ 0.25 on a solid square: the
imagetracerjs adaptive 2-colour quantizer degenerates to a single palette
colour on an already-binary image and traces the whole image frame
instead of the shape. The `Line Art` preset pins a fixed `[white, black]`
palette (`colorsampling:0` + `pal`) and sidesteps it. This is captured as
a characterization test (`lineArtIoU - defaultIoU > 0.5`). Real-world
impact is limited because `ImportImageDialog` already defaults to
`Line Art`; but `DEFAULT_TRACE_OPTIONS` remains a latent footgun for
`traceImageToSvgString` and the zero-paths relax-retry fallback. Left
as-is here — changing trace defaults is its own decision, not a rider on
a test-harness ADR.

**Scope — what IoU here does and does NOT measure.** IoU measures
*geometric area coverage of the outline trace*. A high score means "the
filled contours cover the right pixels," NOT "as good as LightBurn." It
deliberately does **not** measure:

- The **outline-vs-centerline gap** — imagetracerjs is outline-only, so a
  single pen stroke still becomes two parallel contours. This is the core
  "faulty vs LightBurn" issue and a coverage metric cannot see it (the
  doubled outline still covers the right pixels). Measuring it needs a
  different instrument (skeleton / centerline distance).
- **Curve smoothness** or node economy.
- **Raster-engrave quality** (dithering, power mapping).
- **Photographic / noisy input** — fixtures are synthetic clean line art.

So a green perceptual suite is necessary, not sufficient: it rules out
gross coverage regressions, not perceptual parity with LightBurn. When
reporting trace work, that distinction must be stated plainly rather than
implied away.

**Consequences.**

- New `src/__fixtures__/perceptual/` module: `shapes.ts`, `rasterize.ts`,
  `compare.ts`, `png.ts` (+ co-located tests), and the payload test
  `src/core/trace/trace-perceptual.test.ts`.
- `perceptual-artifacts/` added to `.gitignore`.
- No runtime dependency, no API change, no compile-pipeline change.
- Future work, if signal warrants: a centerline-distance metric to put a
  number on the outline-vs-centerline gap; the `DEFAULT_TRACE_OPTIONS`
  degeneracy fix; non-synthetic fixtures.

---

## ADR-026 — Trace keeps its source image (LightBurn-style overlay)

Date 2026-05-29. Status Accepted.

> **Amendment (2026-05-29, same day).** The *mechanism* below was revised by
> the image-flow unification (ADR-027, LightBurn model): an image is no longer
> traced-and-deposited in one step. It is imported first as a standalone
> `RasterImage` (Toolbar "Import Image"), and **Trace** runs as a tool on the
> *already-selected* bitmap, overlaying the vector on it. The mutation is
> `applyTraceToExisting` and the store action `traceExistingImage` (replacing
> the `applyTracedWithSource` / `importTracedWithSource` named below); the trace
> adopts the bitmap's transform with the bitmap's mm-per-pixel folded into its
> scale so the pixel-space vectors register on the mm-space bitmap. ADR-026's
> *goal* is unchanged — retain the source, overlay pixel-for-pixel, delete the
> source to keep the trace. The original mechanism is preserved below as the
> decision record.

**Context.** Committing a trace (`ImportImageDialog`) used to create only a
`TracedImage` (vector) and discard the source bitmap. Users coming from
LightBurn expect the source image to remain as a first-class object together
with the trace, so they can eyeball the vector against the original and then
delete the source to keep the trace. With no source retained — and the
transparent-PNG decode bug (ADR-fix in `image-loader.ts`) producing an
all-black trace — the reported experience was "I traced an image and got a
blank canvas with nothing to compare against."

The scene model already supports the two-object world: `RasterImage` (pixels)
and `TracedImage` (vector) both carry `bounds` + `transform` and can coexist;
`drawRasterImage` stretches the bitmap into its `bounds` rect. So no new
`SceneObject` variant is needed.

The audit surfaced the real blocker: the two import paths use **different
coordinate spaces**. Trace bounds come from `boundsFromColoredPaths` — pixel
space. The raster path (Engrave Image) builds **mm** bounds via a 96-DPI
assumption. `fitObjectToBed` fits each object independently from its own
bounds, so naively inserting both yields two different sizes that do not
overlap.

**Decision.**

1. After a trace, insert **both** objects from one decode — the vector
   `TracedImage` and the source as a real `RasterImage` (burnable, on the
   `DEFAULT_RASTER_LAYER_COLOR` image layer, exactly like Engrave Image).
2. **Alignment by shared transform.** Compute one fit transform from the full
   decoded image frame `(0,0,W,H)` and apply that *same* transform to both
   objects. The raster's bounds are the full frame; the trace's bounds are its
   content bbox within that frame. Sharing the transform makes them overlay
   pixel-for-pixel. New mutation `applyTracedWithSource` does this; it
   deliberately bypasses `applyFreshImport`'s per-object `fitObjectToBed`.
3. **Z-order + selection.** Insert the raster first (bottom), the trace second
   (top), so the vector renders over the source; select the trace.
   "Delete source to keep the trace" is just deleting the raster
   (`removeSceneObject` + `pruneOrphanLayers`, already exist).
4. **One undo entry** covers the pair (single `pushUndo`).
5. The retained source is **output-eligible** (appears in G-code) until the
   user deletes it or toggles its image layer's output off — matching
   LightBurn, where the retained image is a real object on its own layer.

**Consequences.**

- **Trace sizing changes:** a trace is now fit to the *source frame*, not to
  its own content bbox. If artwork doesn't fill the frame, the trace lands
  smaller on the bed than it did before — but correctly sized and positioned
  relative to the source (the faithful LightBurn behavior).
- **Double-burn risk:** because the source is burnable and coincident with the
  trace, compiling without deleting the source engraves the raster *and* cuts
  the vector. Mitigated by the source living on its own image-mode layer
  (output toggle) and the trace being the default selection. Chosen over a new
  non-output "reference object" concept to avoid expanding the union; revisit
  if users double-burn in practice.
- **New store surface:** `importTracedWithSource`. To stay under the 400-line
  file cap (CI `wc -l` gate), the raster/traced image import actions move from
  `store.ts` into `src/ui/state/import-actions.ts`.
- **Not addressed here:** re-trace-from-source, dimming/opacity of the retained
  source, and grouping the pair so they move as one (each is independently
  selectable for now).

---

## ADR-027 — LightBurn is the source of truth; divergences are defects to redesign

**Status:** Accepted | **Date:** 2026-05-29

### Context

ADR-001 adopted "LightBurn's user-facing workflow and naming" as the product model, and `CLAUDE.md` collaboration rule #3 states "LightBurn is the reference for every behavior." In practice these have been read as *aspirational guidance*, and LaserForge has accumulated divergences from LightBurn — several flagged in the code itself:

- 3 layer modes (Line / Fill / Image) vs LightBurn's 4 — no Offset Fill (`src/core/scene/layer.ts`).
- A single `power` per layer vs LightBurn's Min Power + Max Power (`src/core/scene/layer.ts`, `src/core/output/grbl-strategy.ts`).
- An inline per-layer card editor vs LightBurn's separate Cut Settings Editor with Common / Advanced tabs (`src/ui/layers/LayerRow.tsx`).
- 3 dither algorithms vs LightBurn's ten (`src/core/scene/layer.ts`; LIGHTBURN-STUDY §1.4, §4.8).
- Two import buttons ("Trace Image" + "Engrave Image") producing two SceneObject variants vs LightBurn's single image object (`src/ui/common/Toolbar.tsx`, `src/core/scene/scene-object.ts`).
- A grey default raster-layer color whose own code comment reads "LightBurn uses black, but black collides with line-art SVG imports" (`src/core/scene/scene-object.ts:167`).

The maintainer's directive (2026-05-29) makes the posture binding: **LightBurn is the *source of truth*, not merely a reference.** Where LaserForge's workflow, tab/window architecture, or pipeline diverges from LightBurn, the divergence is a **defect to be redesigned toward LightBurn**, unless a specific ADR records it as a deliberate, justified exception.

This work proceeds under the maintainer's operating discipline — Andrej Karpathy's guidance on LLM-assisted coding (paraphrased, not a verbatim quote): keep the AI on a *tight leash* with small, individually-verified increments; keep a human in the loop reviewing every diff; dial autonomy to the risk of the change (an architectural redesign is the lowest-autonomy, highest-scrutiny case); and *verify, don't trust* — a green test suite is not evidence a feature is correct. See `CLAUDE.md` collaboration rules #1–#3.

### Decision

1. **LightBurn is canonical** for workflow, tab/window architecture, layer & cut semantics, the four layer modes (Line / Fill / Offset Fill / Image), defaults, optimization behavior, and G-code semantics. The authoritative behavior reference is `LIGHTBURN-STUDY.md` §§1–7.

2. **A divergence is a defect by default.** Where LaserForge's behavior differs from LightBurn's, we treat it as a bug and redesign LaserForge to match — we do not defend it as a design choice. The running ledger is `LIGHTBURN-STUDY.md` §8 (gap / divergence + the redesign action per area).

3. **Scope ≠ behavior.** This ADR governs *how a feature behaves once we build it* (match LightBurn), **not** *whether* we build it. Which features exist at all, and in what order, remains governed by `PROJECT.md` phases and the scope ADRs (e.g. ADR-006 GRBL-only, ADR-007 Windows-only desktop). "We haven't built LightBurn feature X yet" is a scope **gap**; "we built X but it behaves differently from LightBurn" is a **divergence**.

4. **Deliberate divergences require an ADR exception.** A divergence may stand only if an ADR records it with an explicit **"Divergence from LightBurn"** note and rationale (e.g. the narrower GRBL-only scope is justified by ADR-006). Any divergence not so recorded is a defect on the §8 backlog. (The grey raster-layer color is the current example: it must now be either ADR-justified or fixed to match LightBurn.)

5. **Documentation first, then tight-leash redesign.** This decision and the §8 ledger are recorded *before* any code redesign. Each redesign item lands as its own small, individually-verified PR per rule #1 — never a batched rewrite. Perceptual verification (rule #2) gates anything touching trace / fill / engrave / raster output.

### Consequences

- Existing divergences become an explicit, prioritizable backlog in `LIGHTBURN-STUDY.md` §8 rather than implicit drift.
- Some shipped code is now formally flagged divergent (grey image-layer color, 3 dither modes, single power, inline layer editor, dual import buttons). Each needs either an ADR exception or a fix — but **not in this diff**; this pass is documentation only.
- New work inherits a clear tie-breaker: when a design question arises, the answer is "what does LightBurn do?" unless an ADR says otherwise.
- This ADR **strengthens ADR-001** (which adopted the workflow) and operationalizes `CLAUDE.md` rule #3 (which named LightBurn the reference) into a binding source-of-truth-with-exceptions rule.
- It does **not** authorize implementing the whole LightBurn feature surface — that would violate scope discipline (point 3). The backlog is worked in `PROJECT.md` phase order.

---

## ADR-028 — Raster engrave preview renders in scene space via the compile path's dither

**Status:** Accepted | **Date:** 2026-05-29

### Context

Preview mode (F-A8) rendered nothing for raster (image-mode) layers: an image-only scene previewed as a blank bed. Three causes, all in the preview path:

1. `draw-scene.ts` ran `drawObjectsFaint` + `drawPreview` in the preview branch and skipped `drawObjects` — the only path that draws rasters.
2. `drawObjectsFaint` (`draw-preview.ts`) draws only `imported-svg` ghosts.
3. `buildToolpath` (`toolpath.ts`) skips non-`cut` groups, so a raster-only job has `totalLength === 0` and `drawPreview` returns early.

LightBurn's Preview "shades according to power" — darker pixel = more laser power = deeper burn (LIGHTBURN-STUDY.md §1.4). Under ADR-027 a blank raster preview is a **divergence/defect**, not a missing feature: the engrave object exists and compiles to G-code, but the operator can't see what it will burn.

`RasterGroup.sValues` (dithered **and** power-scaled) is exactly that signal, but `RasterGroup.bounds` is a machine-coord AABB with the front-left origin's Y-flip already applied and **no rotation** (`compile-job.ts` `rasterBoundsInMachineCoords`). Rendering the preview from those bounds would mis-register and drop object rotation/mirror.

### Decision

1. **Reuse the compile path for WYSIWYG.** Preview calls core `dither()` then a new pure `rasterPreviewRgba()` (the reserved `core/raster` F.2.c "preview-data" slot) — the same `dither()` call `compileRasterGroup` makes, with the same `sMax = round(clamp(power,0,100)/100 × maxPowerS)` and the same `layer.ditherAlgorithm` (layer wins over per-image settings). The preview is therefore byte-for-byte the schedule that gets emitted. This mirrors `drawFillHatches`, which already calls core `fillHatching` directly for the fill preview.

2. **Render in scene space, not machine space.** `drawRasterPreview` (`src/ui/workspace/draw-raster-preview.ts`) blits the grayscale-sim bitmap through `drawBitmapAtTransform` (extracted from `drawRasterImage`), so it registers pixel-for-pixel with the on-canvas bitmap and honours rotation/mirror. The machine-coord Y-flip stays confined to the G-code path. `imageSmoothingEnabled = false` keeps threshold/Floyd dots crisp under upscale.

3. **Same gate as compile.** Only output-enabled, image-mode layers render, matched to rasters by `obj.color === layer.color` — exactly `compileJob`'s filter. `layer.visible` is intentionally ignored: preview shows *what burns*, not what's shown on the design canvas.

4. **Pure/DOM split.** `rasterPreviewRgba` is pure (`S → grayscale RGBA`, property-tested in core); the DOM concerns (luma `atob` decode, offscreen canvas, `putImageData`) live in the UI file and are cached per `dataUrl|algorithm|sMax` since the sim is static until one of those changes.

5. **Design view is unchanged.** Design mode still shows the bitmap itself (no dither overlay — WORKFLOW F-F2 step 6). Preview shows **only** the sim, not a faint original underneath (unlike the SVG ghost), matching LightBurn — its preview shows the simulated burn, not the source photo.

6. **Increment 1 scope.** The scrubber animates vectors only; the raster sim renders complete regardless of `scrubberT`. Feeding raster rows into the scrubber (a `'raster'` `ToolpathStep` variant) is **deferred to a separate PR** (Increment 2) — it requires a core toolpath-union change, which this diff deliberately avoids.

### Consequences

- Raster-only and mixed scenes now preview a faithful burn simulation; the blank-canvas defect is fixed without touching the `SceneObject` union, the toolpath union, or the `.lf2` schema.
- All three dither modes render from one `S → grayscale` mapping: threshold/Floyd-Steinberg produce crisp black/white dots, grayscale a smooth ramp.
- **Verification (per CLAUDE.md #2):** core math is property-tested (`preview-data.test.ts`) and the dither↔preview agreement is content-checked against the compile call. On-canvas registration (the sim overlaying the bitmap pixel-for-pixel, including rotation) is **maintainer-eyeball only** — not asserted by the suite, and not driven from the live file `<input>` per CLAUDE.md #4.
- Gated by ADR-027 (divergence fix) and ADR-025 (perceptual harness is the fidelity gate for raster output).

---

## ADR-029 — Convert to Bitmap (vector → raster engrave source)

**Status:** Accepted (A1 Fill-All rasterizer + A2 UI/PNG/`RasterImage` + A3 Outlines + A4 Use Cut Settings + A5 Default Brightness shipped; see 2026-07-07 amendment) | **Date:** 2026-05-29

### Context

LightBurn has a **Convert to Bitmap** tool (Edit menu, `Ctrl/Cmd+Shift+B`, or right-click) that rasterizes selected vector graphics into a bitmap on an Image-mode layer — the inverse of Trace. LaserForge has **no vector→raster tool at all** (LIGHTBURN-STUDY §7.4; §8.5 GAP). Under ADR-027 this is a scope **gap** (a feature we haven't built), not a divergence — so *whether* we build it is governed by `PROJECT.md`, and *how it behaves once built* must match LightBurn.

Official behavior, re-confirmed against the docs on 2026-05-29 (`docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/`) and the maintainer's screenshots:

- **Render Type** — three options: **Outlines** (contours only), **Fill All** (solid fill of areas between outlines), **Use Cut Settings** (outline vs solid fill *per object*, depending on whether its layer is Line mode).
- **DPI** — numeric field + slider (screenshots show a 10–2000 range; 254 for Outlines/Fill All, 84 for Use Cut Settings). The docs state **no default**; the per-render-type values seen are live UI state, not documented defaults.
- Every rendered pixel's brightness is **automatically set to 50% gray**.
- **The source vector is deleted.** Docs warn: duplicate first to keep it.
- Result lands on **the last selected layer** (Image mode).
- Solid fill requires a **closed shape**.

We already have an even-odd scanline polygon rasterizer — but it is **test-only** (`src/__fixtures__/perceptual/rasterize.ts`, boundary/coverage-exempt), pixel-space, scale = 1, **binary** (ink/bg), with no DPI/mm mapping. It is a proven geometric reference, not a reusable production module. The output target `RasterImage` (PNG `dataUrl` + base64 luma + `bounds` + `transform`) already exists (`scene-object.ts`).

### Decision (proposed)

1. **New pure-core module** `src/core/raster/rasterize-vector.ts` — `rasterizeVectorToLuma(...) → { luma: Uint8Array; width; height }`, deterministic and pure (no DOM/canvas), generalizing the test fixture's even-odd fill + DDA stroke to **grayscale** output on a **mm-bounds × DPI** pixel grid. Property-tested (even-odd holes, determinism). `width = round(widthMm / MM_PER_INCH × dpi)` with `MM_PER_INCH = 25.4` a named constant.

2. **Luma convention:** ink pixel = **50% gray (`128`)** to match LightBurn; background = white (`255` = unburned). This is the same luma `dither()` consumes downstream (high luma = light = less burn), so a converted bitmap flows through the existing F.2 engrave path unchanged.

3. **Render Type → our model.** `Outlines` → stroke each contour. `Fill All` → even-odd fill of closed shapes (open paths cannot fill — match LightBurn's closed-shape rule; the open-path behavior, skip vs outline-fallback, is pinned in the UI increment). `Use Cut Settings` → per source object: outline if its layer mode is `line`, else fill (we have no Offset Fill; `fill` mode → fill), which requires reading each object's layer mode.

4. **PNG encode + `RasterImage` build is UI/io, not core** (ADR-010). Core returns the luma grid; the UI wraps it in an offscreen canvas → `toDataURL('image/png')` for `dataUrl` and base64-encodes the luma for `lumaBase64`, then constructs the `RasterImage` exactly as the existing image-import path does.

5. **The source vector is DELETED** (maintainer decision 2026-05-29 — match LightBurn). The selected vector object(s) are removed and replaced by the new `RasterImage` in **one undo entry**. Undo replaces LightBurn's manual "duplicate first" guidance — same net behavior, better ergonomics.
   - **Asymmetry is intentional, not a contradiction with ADR-026:** Trace *keeps* its source (ADR-026); Convert to Bitmap *deletes* its source (this ADR). Both are faithful — LightBurn keeps the image on Trace by default but deletes the vector on Convert.

6. **Placement** on an Image-mode layer. LightBurn uses "the last selected layer"; our layers are color-keyed, so the UI increment maps this to the `DEFAULT_RASTER_LAYER_COLOR` image layer (or the object's own layer if already image-mode), consistent with how image import picks its layer.

7. **DPI default is ours, not LightBurn's** (docs state none). The UI increment picks a sane named-constant default and labels it as a LaserForge choice — no invention of a LightBurn default.

8. **Scope:** outside explicit Phase F → gated by the accompanying `PROJECT.md` entry. Staged tight-leash: **A1** core Fill-All → **A2** UI + PNG + `RasterImage` → **A3** Outlines → **A4** Use Cut Settings → **A5** placement/brightness polish. Each is its own individually-verified diff.

### Consequences

- New production surface in `core/raster` (the real, non-test rasterizer), reusing geometry proven in the test fixture but with its own co-located tests.
- Source deletion is undo-recoverable; no duplicate-first dance required.
- **Perceptual gate (CLAUDE.md #2 / ADR-025):** the rasterized bitmap must be eyeballed (or IoU-diffed) against the source vector at the chosen DPI — green property tests are *not* fidelity proof.
- Does **not** touch the `SceneObject` union (`RasterImage` already exists), the toolpath union, or the `.lf2` schema.
- Composes cleanly with the `TracedImage`-elimination backlog (#1): "Use Cut Settings" reads layer mode, so it is agnostic to which vector kinds exist.

### Amendment 2026-07-07 — audit fixes, brightness (A5), and pinned divergences

An audit of the shipped feature (findings fixed the same day) pins the following, superseding the original text where they differ:

1. **Ink luma is 127, not §2's 128.** Both boundary behaviors were individually correct — 50% gray ink, and `ditherThreshold` burning strictly below its 128 cutoff — but they composed to zero output: a converted bitmap on a Threshold layer dithered to all-zero S (M7, AUDIT-2026-06-10). 127 keeps the 50% intent within rounding and always burns. Regression-pinned in `rasterize-vector.test.ts`.
2. **Default Brightness shipped (the A5 brightness half).** The dialog exposes LightBurn's Default Brightness (percent, default 50). Mapping is `floor(255 × pct/100)` — floor, not round, so 50% stays at 127 per (1). LightBurn's own default is 50% (§7.4).
3. **Conversion DPI range is 127–635, derived, a deliberate divergence.** LightBurn's dialog offers 10–2000 DPI, but LightBurn keeps image resolution and the Image layer's interval independent; our model stamps the conversion DPI onto the created image layer's `linesPerMm` (§6 placement). The legal range therefore derives from the app-wide raster density limits (`MIN/MAX_RASTER_LINES_PER_MM` = 5–25 lines/mm) — outside it, Convert would mint layers the Cuts panel clamps to a different density on the next edit. Revisit if image resolution and layer interval are ever decoupled.
4. **Size estimates are full-transform.** The dialog's pixel estimate uses the rotated AABB (`transformedBounds`), matching what the builder rasterizes — the original scale-only estimate approved rotated conversions the builder then refused. The bake itself (per the 2026-06-09 transform-bake plan) emits baked bounds + IDENTITY transform, which also sidesteps the raster output path's no-rotation limitation.
5. **Single-selection gate.** The command (and `Ctrl/Cmd+Shift+B`, now bound — LightBurn's shortcut, §7.4) is enabled only for a selection of exactly one convertible vector. LightBurn converts a whole multi-selection into **one** bitmap; that merge is a scoped follow-up feature, not a gate relaxation — the pre-fix behavior (silently converting only the primary object of a multi-selection) was a defect. _(Superseded by amendment ii below: the merge shipped.)_
6. **Menu placement divergence.** LightBurn houses Convert to Bitmap under **Edit**; ours lives under **Tools**, grouped with Convert to Path and the other conversions. Deliberate (one conversions home), per ADR-027 §4.

### Amendment 2026-07-07 (ii) — multi-selection merges into one bitmap

The follow-up from amendment (i) §5 shipped the same day:

1. **The whole selection converts as ONE `RasterImage`** spanning the union of the members' rotation-aware AABBs, LightBurn-faithful. Every source vector is deleted; the swap is a **single undo entry**, and the merged bitmap becomes the sole selection (stale additional-selection ids are cleared).
2. **Cross-object even-odd.** Fill All rasterizes the concatenated baked contours of the whole selection with one even-odd pass — a shape nested inside _another object's_ shape reads as a hole. This matches LightBurn's "solid fill of areas between outlines" **and** our own Fill mode, which hatches a layer's contours together (`collectFillContoursForLayer`). Use Cut Settings groups per path color across all members, as before.
3. **Gate: every selected object must be a convertible vector** (`selectedConvertibleVectors`, scene order). A mixed selection (e.g. a raster among vectors) stays disabled rather than converting an ambiguous subset. Same gate for the menu command, toolbar, context bar, and `Ctrl/Cmd+Shift+B`.
4. **Naming:** a multi-object result is labeled `N objects (bitmap)`; the dialog shows `N objects` and estimates from the combined bounds, so the size preview still matches exactly what the builder produces.
5. The worker protocol carries the full selection (`vectors`); budget refusal (4 M px) applies to the combined grid, refusing up front in the dialog.

---

## ADR-030 — Trace control model realigned to LightBurn (Cutoff/Threshold band)

**Status:** Proposed (documentation gate; pending maintainer scope/order ratification) | **Date:** 2026-05-29

### Context

LaserForge's Trace dialog (`src/ui/trace/ImportImageDialog.tsx`) already runs as a tool on a *selected* bitmap (ADR-027 ✓) and keeps its source (ADR-026 ✓ — which matches LightBurn's default). But its **control model diverges** from LightBurn (ADR-027 → a defect to redesign), distinct from the already-tracked output-kind divergence (`TracedImage`, §8.6 #1):

- **Ours:** `PresetPicker` (imagetracerjs `numberOfColors` + Otsu/median/despeckle presets) + `AdjustmentControls` (brightness / contrast / gamma / invert) folded into the Trace dialog.
- **LightBurn** (re-confirmed 2026-05-29, `docs.lightburnsoftware.com/latest/Reference/TraceImage/`, plus the maintainer's screenshot defaults):

| LightBurn control | Default | LaserForge today |
|---|---|---|
| **Cutoff** + **Threshold** (brightness *band*: trace iff `Cutoff ≤ brightness ≤ Threshold`) | 0 / 128 | no explicit band (a threshold is baked into presets) — **missing** |
| **Ignore Less Than** (min traced area) | 2 | ≈ despeckle (rough) |
| **Smoothness** (0 lines → 1.33 curves) | 1.000 | ≈ curve fitting (rough) |
| **Optimize** (node reduction) | 0.2 | ≈ node reduction (rough) |
| **Trace Transparency** (trace alpha) | off | **missing** |
| **Sketch Trace** (local-contrast adaptive threshold) | off | **missing** |
| Fade Image / Show Points / Boundary–Clear Boundary | — | preview exists; these actions **mostly missing** |
| **Delete Image After Trace** (opt-in) | off | we always keep (ADR-026); the *opt-in* toggle is **missing** |

LaserForge additionally has **extra** controls LightBurn's Trace dialog lacks: `numberOfColors`/multi-color presets (LightBurn's trace is a single brightness band) and brightness/contrast/gamma/invert (LightBurn does image adjustment in a *separate* Adjust Image dialog, §2.2 / §7.6 — not the Trace dialog).

Separately and *not solved here*: imagetracerjs is outline-only (a pen stroke → two parallel contours — the centerline gap, PROJECT.md Phase E "known open gap"), and `DEFAULT_TRACE_OPTIONS` degenerates on already-binary input.

### Decision (proposed)

1. **Adopt LightBurn's control vocabulary** as the Trace dialog's primary model — Cutoff + Threshold, Ignore Less Than, Smoothness, Optimize, Trace Transparency, Sketch Trace — replacing `numberOfColors` + presets. Defaults match LightBurn (0 / 128 / 2 / 1.000 / 0.2 / off / off).

2. **The brightness band is the core semantic:** a pixel is "ink" iff `Cutoff ≤ brightness ≤ Threshold` — a pure-core predicate producing a binary mask the tracer then vectorizes. (imagetracerjs is multi-color by design; realigning to a single band means either configuring it to a 2-color/threshold mode or pre-binarizing to a mask and tracing that — pinned in the implementation increment.)

3. **Image adjustment is separate from Trace** (LightBurn-faithful): move brightness/contrast/gamma/invert out of the Trace dialog toward a dedicated Adjust-Image surface (its own small diff), rather than leaving them mixed into Trace.

4. **Add the missing actions** incrementally — Show Points, Fade Image (extend the existing preview), Boundary/Clear Boundary, and an **opt-in** Delete Image After Trace (default keep, per ADR-026). Sketch Trace and Trace Transparency are the two genuinely new algorithms.

5. **Separable from backlog #1.** This ADR governs the *input controls*; §8.6 #1 governs the *output kind* (`TracedImage` → plain vectors). Both are needed for fully faithful Trace, but neither forces the other's order — the maintainer sequences them.

6. **Scope:** this is a **redesign of a shipped feature** (Phase E) → higher risk than ADR-029's additive work, so lower autonomy / higher scrutiny (ADR-027). Staged: **B1** brightness-band core + Cutoff/Threshold dialog → **B2** Ignore Less Than / Smoothness / Optimize mapped to real tracer params → **B3** Sketch Trace + Trace Transparency → **B4** Show Points / Boundary / Fade / Delete-after. Each its own verified diff with a perceptual before/after.

### Consequences

- A working feature's UX changes → must not regress trace quality without the maintainer seeing before/after renders (CLAUDE.md #2).
- Dropping `numberOfColors`/multi-color presets narrows us toward LightBurn's single-band trace; if multi-color trace is valued it needs its own ADR exception (ADR-027 §4).
- The centerline/outline gap (Phase E known issue) is **not** addressed here — control vocabulary ≠ centerline algorithm; kept separate.
- Touches `ImportImageDialog.tsx` + trace option types + tracer config; the control swap itself needs no scene-union or schema change (that is backlog #1).

---

## ADR-031 - Fill hatch overscan lead-in/out

**Status:** Accepted | **Date:** 2026-06-01

### Context

The first real logo burn after the trace/fill fixes produced correct
geometry and smooth motion, but showed visible darker marks at the sides
of filled regions. The burn photo (a local hardware test capture)
matches the standard Fill/Image endpoint-overburn failure: hatch lines
start and stop at the object boundary while the gantry is accelerating or
decelerating.

Research on 2026-06-01 re-confirmed the LightBurn model:

- Fill mode is scan-line engraving inside closed shapes.
- GCode Fill/Image overscanning adds extra laser-off moves at the start
  and end of scan lines.
- Missing or insufficient overscanning causes darker burned edges.
- LightBurn defaults GRBL devices to Variable Power (`M4`), while
  Constant Power (`M3`) is a compatibility option.

LaserForge Image mode already has the right primitive in
`src/core/raster/emit-raster.ts`: rapid to the overscan zone, feed to the
active span with `S0`, burn the active span, then exit overscan with
`S0`. Fill mode does not. ADR-019 intentionally let Fill hatches flow
through `CutGroup` unchanged, which was the right smallest-first ship
decision, but it now prevents output from distinguishing a Fill scan line
from a Line/outline cut.

### Decision

1. **Add a distinct `FillGroup` to `Job`.** Keep Fill hatch generation in
   `compile-job.ts`, but compile Fill layers to `kind: 'fill'` instead
   of `kind: 'cut'`. Line output remains `CutGroup`.

2. **Add `fillOverscanMm` to `Layer`.** Default to `5` mm, matching the
   current Image overscan baseline. Back-fill missing values from
   `LAYER_DEFAULTS`; no schema bump.

3. **Emit Fill with S0 lead-in/out.** Each two-point hatch expands to:
   lead start, burn start, burn end, lead end. G-code shape:

   ```gcode
   G0 XleadStart YleadStart S0
   G1 XburnStart YburnStart Ffeed S0
   G1 XburnEnd YburnEnd Spositive
   G1 XleadEnd YleadEnd S0
   ```

   Positive power stays on a moving `G1`, never on a stationary modal
   command.

4. **Keep `M3` in the first increment.** LightBurn's GRBL default is
   `M4`, and GRBL documents speed-scaled dynamic power. However, changing
   Fill from `M3` to `M4` also changes cut-depth behavior on short
   hatches and increases the diff's blast radius. The next surgical step
   is overscan under the existing M-mode; `M4` Fill becomes a separate
   hardware experiment if edge marks remain.

5. **Keep Frame/job bounds on burn geometry.** Overscan is runway, not
   engraved artwork. Frame should still trace the active burn area, while
   preflight checks emitted G-code so out-of-bed overscan is caught before
   writing or streaming.

### Consequences

- `Group` becomes `CutGroup | FillGroup | RasterGroup`. Exhaustive switch
  failures are expected and useful in output, bounds, toolpath, and
  planner modules.
- Fill preview/toolpath must keep showing burn hatches and may represent
  overscan as traversal moves. Raster remains skipped by the preview
  scrubber until its own row model is added.
- Jobs near a bed edge can fail preflight after overscan is enabled.
  This is correct; the operator can move the artwork inward or lower Fill
  Overscan.
- More overscan increases runtime. This is the same speed/quality tradeoff
  LightBurn documents.

### Verification

- Unit tests for the shared fill-overscan geometry helper.
- Compile tests for `line -> CutGroup`, `fill -> FillGroup`.
- G-code tests that pin S0 lead-in/out and active positive-S hatch spans.
- Property/invariant tests for no positive-S travel and no stationary
  positive-S modal commands.
- Bounds/preflight tests proving emitted overscan outside the bed is
  reported.
- Toolpath/planner tests so preview and duration do not silently drop Fill
  after the new discriminant lands.
- Hardware test: same logo or a 20 mm cropped sample at 0, 2, and 5 mm
  Fill Overscan, same material/power/speed/focus.

---

## ADR-032 - Bidirectional raster rows after overscan runtime regression

**Status:** Accepted | **Date:** 2026-06-01

### Context

After ADR-031-style overscan fixed the visible side burn marks, the next
hardware observation was that a print took roughly three times longer.
The runtime cost is expected if overscanned engraving remains
unidirectional: every row burns left-to-right, exits the right overscan
zone, then wastes a return move to the left overscan zone before the
next row.

Research on 2026-06-01 checked the LightBurn model and one open-source
reference:

- LightBurn documents Bi-directional Fill as side-to-side engraving with
  the laser on in both directions; disabling it engraves one way and
  returns without engraving.
- LightBurn documents overscanning as laser-off runway before/after each
  row so the marked span happens at steadier speed.
- Rayforge documents the same tradeoff for raster: bidirectional is
  faster, while unidirectional can be more consistent if the machine has
  backlash.
- LightBurn's Scanning Offset Adjustment page documents the calibration
  caveat: at high speeds, bidirectional rows can show ghosted or shifted
  edges if machine response delay or belt stretch is not compensated.

Local code evidence matched the slow path: `fill-hatching.ts` already
snakes Fill hatches, but `emit-raster.ts` explicitly deferred
serpentine alternation and emitted every active raster row left-to-right.

### Decision

1. Keep overscan enabled. It fixed the endpoint-overburn failure and is
   still required for even engraving.
2. Change only raster/Image row emission to serpentine movement:
   emitted active row 0 sweeps left-to-right, emitted active row 1
   sweeps right-to-left, and so on.
3. Alternate by emitted active-row count, not raw pixel row index, so
   skipped blank rows do not force a long return sweep.
4. Preserve active-span clipping. A row still runs only from first
   nonzero pixel to last nonzero pixel, plus overscan on the entry and
   exit sides.
5. Preserve M4 dynamic-power raster mode and S0 runway at both ends.
6. Do not add a UI toggle in this patch. If hardware shows
   bidirectional ghosting, add a later Image-layer option for
   unidirectional mode and/or scanning offset calibration.

### Consequences

- Raster jobs should recover most of the avoidable row-return time added
  by overscan, especially tall images with many active rows.
- G-code remains deterministic and modal: feed is emitted on the first
  raster G1, S changes are still run-length compressed, and G0 travels
  remain S0.
- Hardware may reveal backlash/offset artifacts at high speed. That is a
  calibration follow-up, not a reason to keep the default slow path.

### Verification

- `emit-raster.test.ts` pins that active rows alternate direction even
  when blank rows are skipped.
- `emit-raster.test.ts` pins right-to-left S-run order on reverse rows.
- Existing raster invariants still cover S0 G0 travel, deterministic
  output, bounds plus overscan, validation, and RLE behavior.

---

## ADR-022 - Origin-aware job placement and physical Frame/Start preflight

**Date:** 2026-06-01
**Status:** Accepted, code shipped, hardware verification pending. Blocking Start-preflight portions demoted to Job Review warnings by ADR-228 (frame-first); placement math unchanged.

**Context.** ADR-021 shipped the controller half of Set origin here:
`G92 X0 Y0` makes the current head position work-coordinate (0,0).
The missing half was job placement. Fresh imports are auto-centered on
the bed, so absolute `G90` output still asked GRBL to move to the
artwork's canvas coordinates after G92. The user-visible failure was a
centered imported/traced image framing and burning offset from the
physical point the operator had just set as origin.

LightBurn separates these concerns: Start From chooses the placement
reference, while Job Origin chooses which point of the job bounds is
anchored there. LaserForge does not yet have that full UI surface, but
the existing Set origin here workflow must still do the safe expected
thing.

**Decision.**

1. Keep `G92 X0 Y0` as the controller command. The bug was not the GRBL
   command.
2. Add a pure job-placement helper that can translate compiled job
   geometry by a chosen bounds anchor.
3. For active custom-origin sessions, use a front-left job anchor and
   translate the compiled job so that anchor is work-coordinate (0,0).
   Absolute mode remains the default when no custom origin is active.
4. Share the adjusted geometry between Start and Frame. Start emits
   adjusted G-code; Frame traces adjusted bounds.
5. Track `workOriginActive` immediately after a successful Set origin
   write so Frame/Start do not wait for GRBL's next intermittent WCO
   status frame. If the current machine position is known, seed
   `wcoCache` immediately from it.
6. When WCO is known, run physical Frame/Start bounds checks on
   `adjustedJobBounds + WCO`. This catches the near-edge custom-origin
   case that ADR-021 deferred.
7. Do not add a `.lf2` schema field in this patch. The full LightBurn
   Start From dropdown plus 9-dot Job Origin selector remains a future
   UI expansion.

**Consequences.**

- A centered imported/traced image now starts relative to the Set origin
  point instead of its canvas-center placement.
- `emitGcode(project)` still preserves absolute coordinates for export
  and no-origin flows. `emitGcode(project, { jobOrigin })` is the
  origin-aware path used by Start.
- Physical off-bed detection is only as fresh as `wcoCache`. The common
  path is covered because Set origin infers WCO from the latest MPos; if
  the controller has not provided any position yet, LaserForge can still
  origin-adjust output but cannot prove physical machine extents.

**Verification.**

- `src/core/job/job-origin.test.ts` pins lower-left anchor translation
  and WCO bounds offset.
- `src/ui/laser/start-job-readiness.test.ts` pins the regression: a
  centered traced image under custom origin no longer emits centered
  X/Y coordinates, and a near-edge custom origin blocks Start.
- Focused pass: job-origin, start-job-readiness, laser-store,
  laser-line-handler, and frame-preflight tests.
- `pnpm run typecheck`.

---

## ADR-033 - Skip fill overscan on short hatch runs; emit runway as rapid

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

A traced-image Fill burn took ~2 h on hardware versus ~5 min for the same
artwork, size, and settings in LightBurn (~24x). A multi-agent audit
(`audit/FILL-SPEED-DIAGNOSIS-2026-06-03.md`) traced the dominant cost to the
ADR-031 overscan runway, not streaming (the streamer is character-counting):

- The lead-in/lead-out (default 5 mm/side = 10 mm runway) were emitted as
  `G1 ... S0` at the *cutting* feed (default 1500 mm/min), so ~0.4-0.5 s of
  laser-off travel was spent per hatch run, independent of burn length.
- A traced image fragments each 0.2 mm scanline into thousands of short runs.
  On a short run the fixed 10 mm runway dwarfs the actual burn, and the per-run
  runway is paid N times with no merging (Fill is also excluded from
  `optimize-paths`). LightBurn burns the same art as a continuous raster:
  overscan once per row, not per run.

### Decision

This is the first of two fixes (the second — merging collinear runs into
continuous laser-on sweeps — is tracked separately).

1. **Emit the overscan runway as a `G0` rapid, not a `G1` at cutting feed.** The
   runway is laser-off (`S0`); GRBL still decelerates to the burn feed by
   `burnStart` across the collinear junction, so the burn span stays at constant
   velocity and ADR-031's edge-evening purpose is preserved. The burn `G1` now
   carries `F` explicitly because the lead-in is no longer a `G1` that sets the
   modal feed. The planner prices the runway at travel velocity to keep the ETA
   honest.
2. **Skip the runway entirely on short runs.** When the burn is shorter than
   `OVERSCAN_MIN_BURN_RATIO` (= 2) x the per-side overscan — i.e. the runway
   would be longer than the burn — `effectiveOverscanMm` returns 0 and the run
   emits just a seek `G0` to `burnStart` and the burn `G1`. The threshold lives
   in one helper so the emitter, the planner ETA, and the preview scrubber agree.

This refines ADR-031: overscan still protects long fill spans, but short runs
trade edge-evening for the large speed win. M3/M4 is unchanged (ADR-020); Fill
stays on M3.

### Consequences

- Long fill runs are unchanged in coverage; their runway is faster (rapid).
- Short fill runs lose accel/decel edge-evening. On those the burn is brief and
  the head is in its accel ramp regardless, so the quality cost is expected to be
  small — but it is a real tradeoff and needs hardware confirmation.
- Burn geometry (the positive-S `G1` spans) is byte-identical to before; only
  laser-off travel changed.
- `OVERSCAN_MIN_BURN_RATIO` is a tunable constant if hardware shows short-run
  edge marks.

### Verification

- `fill-overscan.test.ts`: `effectiveOverscanMm` applies at >= 2x, skips below,
  and returns 0 for disabled/degenerate input.
- `grbl-strategy.test.ts`: long run keeps the rapid runway; short run emits only
  seek + burn; no `G1` laser-off move; the burn carries `F`.
- Empirical (Karpathy's law): the real emitted G-code for a mixed long/short
  fill was inspected — long run has the rapid runway, short run skips it, and the
  burn endpoints match the input hatch exactly.
- Full suite + `tsc --noEmit` + lint on touched files green.
- **Hardware verification needed:** re-burn the original traced logo on the
  Falcon A1 Pro and confirm (a) the wall-clock drop and (b) no new edge marks on
  small filled features.

---

## ADR-034 - Continuous-sweep fill: one G1 per scanline, S0-blanked gaps

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

ADR-033 made the per-run overscan cheap, but the dominant structural cost of the
~2h-vs-LightBurn-~5min traced-image Fill remained: every interior hatch run was
emitted as its own G0-seek + burn, and the planner forced a full
decel-to-zero / accel-from-zero at every cut<->travel boundary. A traced image
fragments each 0.2 mm scanline into many short runs, so the head stopped
thousands of times. LightBurn (and our own raster path, emit-raster.ts) instead
burn a row as one continuous sweep, crossing interior gaps with the laser blanked.

### Decision

Emit each scanline as ONE continuous laser-on sweep.

1. **New pure module `fill-sweeps.ts`.** `groupFillSweeps()` regroups
   fillHatching's flat per-run output into one FillSweep per scanline: runs on
   the same infinite line (collinear within 1e-6 mm) are one sweep; a change of
   line (the next, parallel scanline) starts a new one. The sweep direction is
   taken from the group's first run, preserving fillHatching's snake.
   fillHatching, compile-job, the caches, and the FillGroup type are unchanged —
   the regrouping happens at consumption.
2. **Emitter (grbl-strategy.ts).** Per sweep: G0 into the optional overscan
   runway (laser off; 1a rapid + 1b short-run skip preserved), then a single G1
   chain — each ink span at S{s}, each interior gap at S0 (diode dark, head
   still at feed so it never stops over a hole), then the G0 lead-out. S is
   modal, so every ink span re-asserts S{s} and every gap asserts S0.
3. **Planner (planner.ts).** A sweep is one cut block from the first span's
   start to the last span's end at cut velocity — no per-run full stop. Gaps run
   at feed too, so one block is accurate for total time.
4. **Preview (toolpath.ts).** Each ink span is a cut step; each interior gap is
   a laser-off travel step, matching the emitted path.

Single-run scanlines (convex fills) emit byte-identically to before, so 1a/1b
behavior is preserved; only multi-span scanlines (holes) change.

### Consequences

- A traced-image fill collapses from thousands of short stop-start runs to a few
  hundred continuous sweeps — the structural fix for the 24x gap.
- SAFETY: a missed S-reset would fire the beam across an interior hole at full
  power. The per-segment S sequence is asserted exhaustively, including a
  multi-hole (>=3 spans) fixture. Every G0 still carries S0; positive S only
  rides a moving G1 (PROJECT.md #3, unchanged).
- The ETA breakdown counts gap time as cut time (gaps move at feed, laser off);
  total time is accurate, the cut/travel split is slightly biased toward cut.
- Grouping is collinearity-based, so it is correct for angled hatches and never
  merges two parallel scanlines (they are >= MIN_HATCH_SPACING_MM apart).

### Verification

- `fill-sweeps.test.ts`: forward, reverse-snake, multi-hole, scanline-boundary,
  angled-collinear, parallel-offset (no merge), and degenerate inputs.
- `grbl-strategy.test.ts`: a multi-hole scanline emits one continuous G1 chain
  with the exact S sequence S{s},S0,...,S{s}; single-run output unchanged relative
  to the post-ADR-033 emitter (the ADR-033 runway G1->G0 swap shipped in the same
  commit). Zero-length / coincident-span guard covered (touching spans; degenerate
  interior span) — added after the 2026-06-03 change audit.
- `grbl-strategy.property.test.ts`: the 100-seed determinism and
  laser-off-on-travel fuzz now include fill groups (PROJECT.md Phase-A gate that
  previously only fed cut groups).
- `estimate-duration.test.ts`: a multi-span sweep is priced as one continuous cut
  block over the envelope (the planner appendFillGroupBlocks path), plus per-pass
  repetition.
- `toolpath.test.ts`: a multi-hole sweep renders cut / gap-travel / cut steps so
  the preview scrubber matches the emitted path.
- Empirical (Karpathy's law): the real emitted G-code for a 3-span / 2-hole
  scanline was inspected — one G1 chain, holes blanked at feed, no G0 between ink
  spans.
- Full suite + tsc --noEmit + lint on touched files green.
- **Hardware verification needed:** re-burn the original traced logo on the
  Falcon A1 Pro and confirm (a) the wall-clock drops toward the LightBurn
  reference and (b) holes are clean (no beam bleed across gaps, no scorch).

---

## ADR-035 - Split a fill scanline at large gaps so the emitter rapids across them

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

ADR-034 made each scanline ONE continuous laser-on sweep, crossing every interior
gap with the laser blanked at feed (G1 ... S0). That is the right move for a true
interior hole — a few tenths of a mm wide — where lifting to a rapid and stopping
would cost more than it saves. But the very first hardware burn after ADR-034 (the
user's traced "arch house" logo) printed cleanly EXCEPT for one stray line where
"the laser should've been switched off to move to a second part."

Karpathy's-law audit of the actual burned G-code (`Gcode arch house.gcode`,
reproduced byte-for-byte from `untitled archii.lf2` by the live pipeline) found the
cause: a single scanline can have ink in two regions of the image that are far
apart — here up to **20.94 mm** of empty space between regions, with **164** such
inter-region gaps wider than 5 mm. ADR-034 grouped ALL of one scanline's collinear
runs into one sweep, so those wide gaps were crossed as slow `G1 ... S0`
cutting-feed moves. A diode laser has a small turn-off lag; held at S0 but moving
slowly across 20 mm, the residual/again-on transient marks a faint line — exactly
the stray "move to a second part" line. LightBurn crosses such inter-region gaps
with a G0 rapid (laser forced off in GRBL laser mode), not a feed move.
`findLaserOnTravelIssues` stayed 0 throughout — the G-code was never *invalid*
(every S0 gap is a legal blanked move); it was a feed-vs-rapid quality choice.

### Decision

Amend ADR-034's grouping: a scanline still groups collinear runs, but
`buildSweeps()` (was `buildSweep()`) now SPLITS the ordered spans into multiple
sweeps wherever the gap between consecutive spans exceeds
`GAP_RAPID_THRESHOLD_MM` (5 mm). Small gaps (true interior holes) stay in one
continuous sweep exactly as ADR-034 intended; wide inter-region gaps become a
sweep boundary, and the emitter's existing per-sweep G0 seek crosses them as a
rapid (hard laser-off, faster than feed). No change was needed in the emitter,
planner, or preview — they already iterate sweeps and treat the space between
sweeps as a G0 rapid. 5 mm sits above the rapid-vs-feed time break-even (~3.3 mm
at the default feed) and cleanly separates an inter-region gap from a hole.

### Consequences

- The stray-line failure mode is structurally removed: no fill gap wider than
  5 mm is ever crossed at cutting feed. The laser is hard-off (G0, forced off in
  laser mode) across every inter-region move.
- Marginally faster: wide gaps now move at rapid rate, not cut feed.
- SAFETY: still PROJECT.md #3-clean — every G0 carries S0, positive S only on a
  moving G1. Splitting a sweep only ever turns a blanked feed move into a blanked
  rapid; it never extends a laser-on span.
- A 5 mm-to-feed-break-even mismatch means gaps between 3.3 and 5 mm still feed
  (a deliberate hysteresis so small detail does not stop-start); this is the
  smoothness/speed trade ADR-034 chose, now bounded so it cannot mark.

### Verification

- `fill-sweeps.test.ts`: large-gap split (15 mm gap -> 2 sweeps), small-gap
  continuity preserved (2-3 mm gaps stay one sweep), reverse-snake small-gap
  ordering, plus all ADR-034 cases unchanged.
- `grbl-strategy.test.ts`: a 15 mm inter-region gap emits `G0 ... S0` across it
  and asserts NO `G1 ... S0` crosses it; the multi-hole (3 mm gaps) continuous
  chain from ADR-034 is unchanged.
- Empirical (Karpathy's law) on the user's real file: re-emitting
  `untitled archii.lf2` through the live pipeline dropped the longest laser-off
  FEED move from **20.94 mm -> 4.87 mm** and inter-region G1-S0 gaps > 5 mm from
  **164 -> 0**; `findLaserOnTravelIssues` 0 before and after. The 16.6 mm gap that
  produced the stray line is now crossed by G0 rapids.
- Full suite + tsc --noEmit + lint on touched files green.
- **Hardware verification needed:** re-burn the "arch house" logo on the Falcon
  A1 Pro and confirm the stray cross-region line is gone.

---

## ADR-036 - Fill engraving emits M4 dynamic power (was M3 constant); supersedes ADR-020 #4

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

After ADR-034/035 fixed fill *speed* and the stray line, the user reported small
traced text ("langebaan", a few mm tall) burning with **uneven density** -
blobby, "not smooth" - while large shapes were clean. The
`burn-perfection-research` workflow (docs/research/burn-perfection-small-text.md)
root-caused the density half to **Cause A: M3 constant power**.

With `M3`, GRBL holds the programmed laser power regardless of head speed
(`laser_mode.md`: *"keeps the laser power as programmed, regardless if the
machine is moving, accelerating, or stopped"*). A short engrave stroke spends a
large fraction of its length below the commanded feed: at 1500 mm/min (25 mm/s)
and the default accel 500 mm/s^2, the ramp-to-speed distance is
`v^2/(2a) = 0.625 mm` at *each* end - ~30% of a 4 mm glyph stem. Constant power
over those slow zones deposits more energy/mm -> the dark, irregular density. The
canonical GRBL remedy is **M4 dynamic power**, which scales S by
`actual_feed / programmed_feed` so energy/mm stays constant through accel/decel,
with **no** offset calibration. LightBurn's GRBL default is M4 for fill/scan.

The raster path already emitted M4 (`emit-raster.ts:76-77`); fill did not. The
M3-for-fill choice was an explicit deferral in **ADR-020 decision #4**, which
warned the change "also changes cut-depth behavior on short hatches" and parked
it as "a separate hardware experiment if edge marks remain." Those edge marks
are exactly this symptom. This ADR supersedes ADR-020 #4.

### Decision

Fill groups emit **M4 dynamic power**; cut groups keep **M3 constant power** (a
slow corner must still cut fully through). Laser power mode is modal across
groups, so `emitJob` now tracks the current mode (`'M3' | 'M4' | 'off'`,
initialised to M3 by the preamble) and emits a flip ONLY when the required mode
changes:

- **cut** when not already M3 -> `M3 S0`.
- **fill** when not already M4 -> from M3, `M5` then `M4 S0` (the M5 clears
  constant mode, mirroring emit-raster's documented reason); from `off` (after a
  raster group, which already issued its trailing M5), `M4 S0` alone.
- **raster** manages its own M4 internally and ends in M5; we mark mode `off`.

This generalises the old single rule (`raster -> cut/fill emits M3`) into a
proper state machine. The fill *body* (sweeps, S-sequence, overscan, the
PROJECT.md #3 guards) is unchanged - only the mode word that precedes it.

### Consequences

- Small/short engrave strokes hold constant energy/mm; the density unevenness
  flattens with no per-machine calibration.
- **Safer on travel/pause:** under M4 the diode is dark whenever the head is
  stopped (dynamic power -> 0 at 0 feed). M3 keeps firing a stopped head. So fill
  is now strictly safer for the "laser firing during pause" failure mode, on top
  of the unchanged PROJECT.md #3 invariant (every G0 carries S0; positive S only
  on a moving G1).
- **Cut-only jobs are byte-identical** (the flip never fires); vector cutting
  behaviour is untouched. Raster is untouched.
- A fill-only job starts `M3 S0` / `M5` / `M4 S0` - a one-time, laser-off
  redundancy from keeping the documented M3-priming preamble intact rather than
  rippling a preamble change through every determinism baseline.
- This is a g-code-emission (safety-path) change: the M3->M4 contract was
  reviewed against all callers; only `emitJob`'s mode management changed.

### Verification

- `grbl-strategy.fill-power-mode.test.ts`: fill-only job arms M4 after the M3
  preamble and burns under it; fill->cut restores M3; consecutive fills emit a
  single M4 flip; cut-only never emits M4.
- `grbl-strategy.test.ts`: the raster->fill transition now asserts `M5\nM4 S0`
  (was M3); raster->cut still asserts `M5\nM3 S0`.
- `grbl-strategy.property.test.ts`: determinism + laser-off-travel fuzz (incl.
  fill groups) still green - the M4 S0 line sets sticky S=0, never false-flags.
- `pipeline.snapshot.test.ts`: byte-identical (the SVG fixtures compile to vector
  cuts, not fills) - confirms the change is fill-scoped.
- Empirical (Karpathy's law) on the user's real `untitled archii.lf2`: the fill
  group's emitted mode went **M3 -> M4** (M4 count 0 -> 1), the burn G1s follow
  the M4 flip, `findLaserOnTravelIssues` 0 before and after.
- Full suite + tsc --noEmit + lint on touched files green.
- **Hardware verification needed:** re-burn the "langebaan" small text on the
  Falcon A1 Pro and confirm the density is even (no blobby slow-zone over-burn).
  Note: M4 fixes the *density* half; the *wavy-edge* half is trace faceting
  (Cause B / Fix 2), a separate change.

---

## ADR-037 - Raise the image-trace decode cap 1024 -> 2048 px for small-feature fidelity

**Status:** Accepted, code shipped, visual verification pending. | **Date:** 2026-06-03

### Context

The *wavy-edge* half of the small-text burn defect (docs/research/burn-perfection-
small-text.md, **Cause B**): the user image-traced a raster that contained small
text ("langebaan"); the glyphs came out wavy/faceted. A trace can be no smoother
than the bitmap it is handed - potrace/imagetracer fit curves to a pixel-boundary
staircase, and a few-px-tall glyph has almost no boundary to work with.

`image-loader.ts` downscaled every imported image to a **1024 px** longest edge
before tracing (`MAX_EDGE_PX`, `scaleToCap`). A detailed source (logo/photo with
small lettering) was therefore crushed to 1024 px *before potrace ever saw it*,
discarding exactly the resolution the small text needed. LightBurn's own guidance
is the inverse: feed the tracer MORE pixels (upscale before tracing) for fine
detail / small text.

### Decision

Raise `MAX_EDGE_PX` from **1024 to 2048** (4x the pixels, ~4x trace time). This
doubles the linear resolution the tracer sees, recovering small-feature fidelity
while staying interactive on modest hardware in the trace Worker (with the 300 ms
preview debounce).

Deliberately **NOT** done: upscaling images that are already *below* the cap.
Bilinear-upscaling a deliberately low-res input (pixel art / blueprints - the
"Sharp" preset, "every notch matters") would blur the notches the user wants
kept. Raising the *downscale* cap only ever *keeps more* real detail, so it never
degrades any input; upscaling-below-source can. `scaleToCap` therefore still
passes sub-cap images through untouched.

### Consequences

- **Registration- and size-safe.** The overlaid trace's mm size is
  `traceCoord / source.pixelWidth x widthMm` (`overlayTransformForRaster`,
  scene-mutations.ts), where `widthMm` derives from the NATURAL size at 96 DPI
  (`rasterImportGeometry`, image-import.ts) and `pixelWidth` is the sampled size.
  Raising the cap scales `pixelWidth` and the trace coordinates together, so the
  final mm geometry is invariant - only detail density rises. Source bitmap and
  trace both sample through the same `loadImageAsRawData`, so they stay aligned.
- ~4x trace/preview CPU + transient memory on the largest inputs (a 2048x2048
  RGBA frame is 16 MB; preprocessForTrace clones it a few times). Bounded by the
  Worker + debounce; 2048 is the chosen quality/perf knee (4096 would be ~16x and
  risk multi-hundred-MB transients). The constant is the single tuning point.
- No persistent `.lf2` bloat for the trace workflow: the source bitmap (which
  stores luma at the sampled size) is deleted once the trace is committed
  (LightBurn model), leaving only vector paths.

### Verification

- `image-loader.test.ts`: `scaleToCap` keeps a 1500 px source (crushed to 1024
  before) full-size, downscales 4096 -> 2048, and never upscales a 300 px source;
  `PREVIEW_MAX_EDGE_PX` is 2048 so preview and commit still see identical pixels.
- Empirical (Karpathy's law): tracing a crisp disc through the real potrace
  backend at increasing resolution monotonically reduces the trace's max radial
  deviation from the true circle - **1024 px 0.27% -> 2048 px 0.11%** (halved);
  the small-feature regime (256 -> 512 px) improves 2.2x. Higher decode
  resolution provably yields truer, smoother curves.
- Full trace suite (potrace, imagetracer, integration, import geometry) + full
  suite + tsc --noEmit + lint green.
- **Visual verification needed:** re-import and re-trace the original "langebaan"
  artwork and confirm the small text traces smooth (not faceted). If the source
  itself is low-res, the remedy is a higher-res source or native vector text
  (the report's alternative Cause-B fix), which this change does not replace.

---

## ADR-038 - Per-layer unidirectional fill option (was: snake hardcoded)

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

The "amplifier" third of the small-text burn defect (docs/research/burn-perfection-
small-text.md, **Cause C**). Fill hatching alternated each scanline's direction
unconditionally (snake fill, `fill-hatching.ts` `pushScanlineHatches`), and the
emitter applies no scan-offset compensation. A diode's laser-on lag is a fixed
*time*; at feed it becomes a fixed *distance* offset that flips sign on each
alternating row, so a vertical edge lands at two alternating X positions - a
"zipper" / serration. On a glyph only a handful of scanlines tall there is no
spatial averaging to hide it. LightBurn exposes both a Scanning Offset Adjustment
table and a bi-/uni-directional fill toggle; LaserForge had neither, and snake was
not even user-togglable (no per-layer flag in `src/core`).

### Decision

Add a per-layer **`fillBidirectional`** boolean (default `true` = the existing
snake). When `false`, `fillHatching` emits every row in the SAME direction
(unidirectional): the per-sweep G0 in the emitter rapids the head back between
rows with the laser off, so the alternating firing-lag offset cannot form. The
flag threads layer -> `compile-job` -> `memoizedFillHatching` -> `fillHatching`'s
`HatchInput.bidirectional`, is part of BOTH fill cache keys (`layerFillCacheKey`
and the inner hatch cache - else flipping it would silently reuse the old path),
is back-filled to `true` for pre-ADR-038 `.lf2` files (`deserialize-project.ts`),
and is exposed as a "Bidirectional" checkbox in the layer panel (`LayerRow.tsx`).

A full scan-offset *compensation* table (correcting bidirectional rows rather
than serialising them) is deliberately deferred - unidirectional is the simpler,
calibration-free lever and the right first step.

### Consequences

- Unidirectional removes the zipper entirely at the cost of one laser-off
  return-rapid per row (slower fill). It is opt-in; the default (snake) preserves
  the current speed and is byte-identical, so no existing output changes.
- This is the SMALLEST of the three small-text levers: at the user's 1500 mm/min
  the lag zipper is ~0.025-0.075 mm. M4 dynamic power (ADR-036) and the trace
  decode cap (ADR-037) are the larger levers; this finishes the set.
- Old projects reopen unchanged (back-filled to snake). New layers default to
  snake. Determinism preserved (the flag is pure input to a pure function).

### Verification

- `fill-hatching.test.ts`: with `bidirectional: false`, EVERY row runs
  left-to-right (no alternation) - the zipper cannot form; the snake default test
  is unchanged.
- `compile-job-fill-cache.test.ts`: the compile path threads the layer flag into
  `fillHatching` (`bidirectional: false` observed) AND flipping it re-hatches
  rather than serving a stale cache entry (both cache keys include it).
- `project.test.ts`: a pre-ADR-038 layer back-fills `fillBidirectional` to `true`.
- `layer.test.ts`: `createLayer` default includes `fillBidirectional: true`.
- Full suite + tsc --noEmit + lint green.
- **Hardware verification needed:** burn the "langebaan" small text with the layer
  set unidirectional and confirm the edge serration is reduced. Expect a subtle
  effect at 1500 mm/min (the zipper is small at this feed); the bigger small-text
  wins are ADR-036 (density) and ADR-037 (trace fidelity).

---

## ADR-039 - Split a raster row at wide white gaps so the emitter rapids across them

**Status:** Accepted, code shipped, hardware verification pending. | **Date:** 2026-06-03

### Context

ADR-035 split a FILL scanline at gaps > 5 mm so the emitter crosses inter-region
gaps with a G0 rapid instead of a slow G1 S0 feed move (the stray-line class). The
raster (image-mode) emitter had the same latent defect: emit-raster swept one
active span per row from the first ink pixel to the last, and any interior white
run inside that span became a `G1 ... S0` feed move. For a row with two separated
ink islands (a logo with a gap, text with a space), the head crawled across the
white gap at cutting feed with the beam nominally off - the diode turn-off-lag
marking risk, and a long blank feed that the P0-A `findLongBlankFeedMoves`
preflight (added the same day) would flag in raster output.

### Decision

Replace the single per-row `activeSpan` with `activeSpans(row, pixelWidthMm)`:
walk the row's ink and split into separate ink islands wherever the white gap
between consecutive ink exceeds `RASTER_GAP_RAPID_THRESHOLD_MM` (5 mm, matching
ADR-035 and the P0-A threshold). The row loop emits each island as its own sweep
(`emitSpanSweep`, the former `emitRow`), so the G0 lead-in to the NEXT island
crosses the wide gap as a rapid. A small interior gap (<= 5 mm) stays within one
sweep, blanked at feed exactly as before. Snake direction still alternates per
emitted ROW (within a reverse row the islands sweep right-to-left); F still rides
only the very first G1 of the group.

### Consequences

- A wide interior white gap is a G0 rapid (laser hard-off, faster), not a G1 S0
  crawl - so raster output now passes the P0-A long-blank-feed invariant.
- Single-island rows (and rows whose gaps are all <= 5 mm) emit byte-identically
  to before; only multi-island rows change. The 28 pre-existing raster emit +
  property tests pass unchanged.
- Each split island keeps its own overscan runway; the extra G0 between islands
  is the intended trade (a few rapids vs. marking the gap).

### Verification

- `emit-raster.test.ts`: a two-island row (12 mm gap) crosses to the second
  island with `G0 X16.000 Y1.000 S0` and emits NO `G1 X16...`; a 4 mm gap stays
  one sweep (one G0, the gap blanked as `G1 X8.000 S0`).
- Empirical (Karpathy's law) cross-check: `findLongBlankFeedMoves` on the
  two-island emit returns [] (before this change the 12 mm gap was a `G1 S0`
  that the invariant flags). The two safety modules corroborate each other.
- `emit-raster.property.test.ts` (determinism + laser-off) unchanged; full suite
  + tsc --noEmit + lint green.
- **Hardware verification needed:** engrave an image with two separated dark
  regions on one row and confirm the gap is travelled dark (no faint line) and
  faster.

---

## ADR-040 - Shared prepared-output pipeline (preview = save = start = estimate)

**Status:** Accepted, code shipped. | **Date:** 2026-06-03

### Context

The canvas Preview built its toolpath from RAW `compileJob` - no `optimizePaths`,
no job-origin - while Save/Start emitted from the OPTIMIZED job (`emitGcode` ran
compile -> applyJobOrigin -> optimizePaths). The live Estimate had yet a third
copy of the compile+optimize sequence. So the operator could approve one path
order in the preview and burn a different (re-ordered) one, and the three
copies could drift independently (P1-C; the audit's "approve one, burn another"
risk). The pre-emit raster budget guard (P1-A) was also wired into emit and
estimate separately.

### Decision

Introduce `prepareOutput(project, options): PreparedOutput` (src/io/gcode) as the
ONE place that turns a Project into the machine Job:
`runPreEmitPreflight -> compileJob -> optional applyJobOrigin -> optimizePaths`.
It returns `{ ok: true, job }` or `{ ok: false, preflight }` (over-budget raster).
Every output-facing consumer now derives from it:

- `emitGcode` emits `prepared.job`, then runs the full gcode preflight on the
  body (unchanged external behaviour).
- `buildPreviewToolpath` builds from `prepared.job`, so the preview shows the
  exact optimized order the machine runs (an over-budget raster -> empty preview
  via EMPTY_JOB, never a freeze).
- `estimateLiveJob` times `prepared.job` (its cheap vector pre-counts still gate
  the compile first; the standalone preEmit call from P1-A.2 folded into
  prepareOutput).

Frame is intentionally NOT routed through prepareOutput: it computes a bounding
box for the framing pass (not a toolpath order) and keeps its own physical-bounds
/ WCO checks.

### Consequences

- Preview, Save, Start, and Estimate cannot diverge in path order or budget
  verdict - they are the same function. The optimize step moved INTO the shared
  path, so the preview's travel lines now match the burn (cut geometry was always
  identical; only ordering changed).
- emitGcode is behaviour-identical (the inline compile/place/optimize moved into
  prepareOutput verbatim). The pre-emit budget guard is now applied once, in
  prepareOutput, for all consumers.

### Verification

- `prepare-output.test.ts`: ok + non-empty job for a vector project; ok:false +
  raster-too-large for an over-budget raster; deterministic (same project ->
  deep-equal job).
- `draw-preview.parity.test.ts`: `buildPreviewToolpath(project)` deep-equals
  `buildToolpath(prepareOutput(project).job)` on a project the optimizer reorders
  - a regression lock that fails the moment the preview reverts to raw compileJob.
- emit-gcode + live-job-estimate tests unchanged and green (behaviour preserved).
- Full suite + tsc --noEmit + lint green.

---

## ADR-041 - A GRBL error:N ack is terminal for the stream (stop sending + safety notice)

**Status:** Accepted, code shipped. Hardware verification needed. | **Date:** 2026-06-04

### Context

When GRBL replied `error:N` to an in-flight line mid-job, the streamer treated it
exactly like `ok`: `onAck` popped the head line, freed its bytes, and left
`status: 'streaming'`, so the next `step()` pushed the next queued line. The only
error-specific action was setting `lastError`, which no path read to stop the job.
Captured empirically before the fix (tiny rx buffer so lines stay queued):

    initial step:  status=streaming inFlight=2 queued=3 toSend="G21\nG90\n"
    onAck(error):  status=streaming acked="G21\n" completed=1 inFlight=1 queued=3
    next step:     toSend="M3 S255\n" (length=8)

i.e. after GRBL rejected `G21`, the very next bytes the sender emitted were
`M3 S255` (laser on) - at a position the head may never have reached, because the
move that should have positioned it was the rejected line. A passing test
(`streamer.test.ts` "treats error like ok") locked this in. This is P0-1 in
docs/REMAINING-WORK-ROADMAP-2026-06-04.md; flagged by LF-CV-001 and the
2026-06-04 LightBurn parity audit. LightBurn treats any controller error as job
failure.

### Decision

Make a controller error terminal for the stream, parallel to the existing alarm
path:

- streamer.ts: add a terminal `'errored'` status to `StreamerStatus`; `onAck`
  maps `kind === 'error'` to `'errored'` (alarm stays `'cancelled'`; the
  user-initiated stop stays distinct); `step()` early-returns `toSend: ''` for
  `'errored'` like the other terminal states. The rejected line is still consumed
  for buffer accounting (GRBL freed its bytes when it replied), but no further
  bytes are sent.
- laser-line-handler.ts: the `error` branch now also raises a `controller-error`
  safetyNotice. `advanceStream` is otherwise unchanged - because the acked state
  is `'errored'`, `step()` returns empty and no follow-up `safeWrite` fires.
- laser-safety-notice.ts: new `controller-error` notice variant + builder (blunt
  copy naming the physical control, like the P0-B notices).
- SafetyNoticeBanner.tsx: a distinct title ("Controller rejected a command").

After the fix, the same repro prints `status=errored` and `next toSend=""`.

### Consequences

- The sender no longer turns a rejected line into a laser-on line at the wrong
  place, and the operator gets a persistent safety alert.
- KNOWN RESIDUAL (follow-up ticket, hardware-gated): GRBL does NOT halt on
  `error:N` by default - it discards the bad line and keeps executing the lines
  already in its ~120-byte RX buffer. Stopping our sender prevents NEW burn lines,
  but a complete halt (and turning a currently-firing laser off) requires issuing
  a real-time feed-hold (`!`) and/or soft-reset (0x18) on error - a change to the
  safety-critical send path that earns its own ticket plus hardware verification.
  This ADR is scoped to sender termination + notification, matching the P0-1
  done-criteria.
- `'errored'` is terminal, so the existing `status === 'streaming' || 'paused'`
  active-job checks (autosave, LaserWindow, buildPortClosePatch) correctly read it
  as not-active. No exhaustive switch on `StreamerStatus` exists, so the new member
  needed no other call-site changes.

### Verification

- streamer.test.ts: the old "treats error like ok" test is inverted to assert
  `status === 'errored'` and `step().toSend === ''`; a second test feeds an error
  with lines still queued (tiny rx buffer) and asserts the next line is NOT sent
  (the no-laser-on-after-reject regression).
- laser-line-handler.test.ts: feeding `error:7` mid-stream asserts streamer
  `'errored'`, no follow-up `safeWrite`, `lastError === 7`, and a
  `controller-error` safetyNotice carrying the code.
- Full suite 981/981; tsc --noEmit 0; eslint 0 on touched files.
- Hardware verification needed: on the Falcon A1 Pro, inject a rejected line and
  confirm the stream halts and the beam does not fire after the rejection (this HV
  also reveals whether the GRBL-buffer residual above needs the soft-reset
  follow-up).

### Correction (2026-06-10, H5 fix-verification)

As shipped, `'errored'` was NOT fully terminal: `onAck` computed the ok-path
status without checking the current one, so when the error landed while later
lines were still in flight (the final RX window), the trailing `ok` acks
drained the queue and promoted the status back to `'done'` — the UI reported a
clean finish over a real rejection. `step()` did refuse to send after the
error, so the no-new-bytes safety property above always held; only the
reported outcome was wrong. Fixed by making all terminal statuses absorbing in
`onAck` (`isTerminal` guard, shared with `step()`), pinned by the
"keeps errored terminal when trailing oks drain the in-flight tail" tests in
`streamer.test.ts`. The same guard stops a straggler ack from flipping
`'cancelled'` (alarm) to `'errored'` or vice versa.

---

## ADR-042 - Ack-driven follow-up write failure raises the disconnect safety notice (P0-3)

**Status:** Accepted, code shipped. | **Date:** 2026-06-04

### Context

`advanceStream` (laser-line-handler.ts) pushes the next buffer chunk after each
ack. When that follow-up `safeWrite` rejected (port lost mid-job), the `.catch`
marked the streamer `disconnected` but raised NO `safetyNotice`. GRBL keeps
executing the lines already in its ~120-byte buffer, so the head can keep moving
while the UI silently leaves the streaming state with no alert to hit the physical
E-stop. Every other write-failure path in laser-store.ts (pause/resume/stop,
around lines 290/388/398/423) raises a notice; this one did not. The existing
test asserted `status === 'disconnected'` but never checked the notice, which is
why the gap survived. Captured red before the fix:

    expected null to deeply equal { kind: 'disconnect-during-job', ... }
    Received: null

P0-3 in docs/REMAINING-WORK-ROADMAP-2026-06-04.md; whole-repo-lightburn-parity-
audit-2026-06-04, karpathy-whole-repo-audit-2026-06-02 (KF-012).

### Decision

In the `advanceStream` `.catch`, set BOTH the disconnected streamer and a
disconnect-during-job safetyNotice. The disconnect-during-job message is the
correct one (not write-failed): it names the real danger - buffered motion
continuing after the link is gone - matching the message the onClose path already
raises. A new builder `disconnectDuringJobNotice()` in laser-safety-notice.ts is
the single source of that notice; buildPortClosePatch (laser-store-helpers.ts) now
uses it too, removing the duplicated inline literal. No soft-reset is sent on this
path: the write itself failed, so there is no live link to send one over (recovery
state is already preserved by disconnect()).

### Consequences

- A mid-stream follow-up write failure now shows the operator the physical E-stop
  banner, closing the silent-teardown gap.
- The disconnect-during-job notice has exactly one constructor, used by both the
  onClose patch and the stream-write-failure catch; they cannot drift.

### Verification

- laser-line-handler.test.ts: the existing follow-up-write-failure test now also
  asserts the disconnect-during-job safetyNotice is set (the assertion that was
  red before the fix).
- laser-store.test.ts: the onClose disconnect-during-job test stays green through
  the builder refactor (same kind + message).
- Full suite green; tsc --noEmit 0; eslint 0 on touched files.
- No hardware verification needed (write-failure path + UI banner; the underlying
  disconnect behavior is already hardware-exercised).

---

## ADR-043 - Trace is vector-only; remove the Photo and Detailed trace presets

**Status:** Accepted, code shipped. | **Date:** 2026-06-05

### Context

The Trace dialog surfaced six presets. Four (Line Art, Centerline, Smooth, Sharp)
binarize the image to pure black/white (fixedPalette ['#ffffff','#000000'] + a
threshold) and emit clean black vector ink. Two (Detailed: numberOfColors 4; Photo:
numberOfColors 8) set NO fixedPalette and NO threshold, so applyThreshold returns
the image unchanged (trace-image.ts) and imagetracerjs adaptive-quantizes a
continuous-tone image into filled light-grey tone regions. The operator reported
that Photo and Detailed "do not trace - the whole white page remains, it looks like
a bitmap photo." Confirmed empirically: tracing a gray-disk-on-light-gradient image
produced, for Line Art/Smooth, paths with fill rgb(0,0,0) (real ink); for Detailed,
only rgb(200,200,200)/rgb(220,220,220) (near-white, no ink); for Photo,
rgb(195,195,195)/rgb(90,90,90)/rgb(225,225,225) (posterized greys). The output is
vectorized posterization, not line-art tracing, and is useless as laser engrave
geometry.

This is also off-model versus LightBurn, the reference. Per the in-repo
LIGHTBURN-STUDY.md (citing docs.lightburnsoftware.com): LightBurn's Trace Image is a
VECTOR-ONLY tool; photo/grayscale engraving is a separate path - the Image layer
mode, which engraves the raster directly with dithering. LightBurn has no
multi-colour "Photo"/"Detailed" trace. Making the vector tracer posterize a photo is
neither real tracing nor the correct way to engrave a photo.

### Decision

Trace is vector-only. Remove the Photo and Detailed presets from TRACE_PRESETS
(trace-image.ts). The surfaced presets are now Line Art, Centerline, Smooth, Sharp -
all binarized vector traces. Photos and continuous-tone images engrave via the
Image/raster path (Image layer mode + dithering, per the operator-workflow plan), not
Trace. The PresetHint copy now points the operator there.

The multi-colour CAPABILITY (numberOfColors > 2, no fixedPalette -> adaptive
quantization) stays in the engine for any direct/programmatic caller; it is simply no
longer surfaced as a preset. Its engine path remains covered by tests via inline
TraceOptions instead of the removed presets.

### Consequences

- The Trace dialog no longer offers options that produce a blank/posterized result.
- Photo engraving has one correct home (the Image/raster path), matching LightBurn.
- Tests that referenced TRACE_PRESETS['Photo']/['Detailed'] now use inline
  multi-colour TraceOptions, preserving >2-colour engine coverage without the
  surfaced presets.
- Photo-quality work (dither breadth, min power) belongs in Convert-to-Bitmap /
  Image-mode (operator-workflow plan), not Trace.

### Verification

- trace-image.test.ts, trace-options.test.ts, trace-pipeline.integration.test.ts
  green; the multi-colour engine path is exercised via inline TraceOptions.
- Empirical pre-removal repro: Photo/Detailed emit near-white posterized fills with
  no black ink; Line Art/Smooth emit rgb(0,0,0) ink (see the trace research notes).
- Full suite + tsc --noEmit + eslint on touched files: green.
- No hardware verification needed (UI preset removal; no g-code emission change).

---

## ADR-044 - Minimal Material/Interval Test calibration workflow

**Status:** Accepted; scope approved, implementation staged. | **Date:** 2026-06-09

### Context

The operator has now hardware-burned real material and observed quality changes
from power, scan strategy, line interval, and material response. Code cannot pick
universal burn settings. LightBurn treats this as a first-class calibration
workflow: Material Test generates a configurable grid, usually 10x10 by default,
varying parameters such as Power, Speed, Interval, and Passes; Interval Test
generates sample squares to find raster line spacing for a speed/power/material
combination. The official LightBurn Material Test documentation also says the
grid location follows Start From / Job Origin behavior, and the Interval Test
documentation directs users to run a speed/power material test first when they do
not already know those settings.

Before this ADR, `PROJECT.md` listed "Material library, cut tests,
power/speed wizards" as out of scope. The maintainer has now explicitly approved
continuing the LightBurn-parity roadmap step by step, so the scope line needs to
move from "forbidden" to "staged and bounded."

### Decision

Promote a minimal calibration workflow to Phase F.5:

1. Build a pure Material Test generator first. It produces ordinary
   `Project`/`Scene` data, not ad hoc G-code, so Preview, Save G-code, Frame, and
   Start all use the same existing pipeline.
2. Start with speed/power grids. Speed can be represented by row layers; power
   can be represented by the object-level `powerScale` field introduced for
   Shape Properties. This avoids inventing per-object speed before the model
   needs it.
3. Add Interval Test after the Material Test foundation. Interval Test should
   generate image/fill swatches using the existing line interval / DPI controls
   and should not bypass raster/fill preflight.
4. Add UI after the pure generator has tests. The UI may live under a
   LightBurn-style Laser Tools menu entry, but the generated scene is the source
   of truth.
5. Keep full Material Library storage deferred. LightBurn's library supports
   saved material/thickness presets, Assign vs Link behavior, shared library
   files, and multi-device library switching. LaserForge should add that only
   after generated calibration grids are useful on hardware.

### Consequences

- `PROJECT.md` now scopes minimal Material Test and Interval Test generators,
  while full Material Library storage and linked presets remain out of scope.
- The next implementation slice must be pure-core and test-first. No hardware
  control should be added until generated project output is deterministic and
  preview/save/start-compatible.
- Hardware verification is required before claiming the feature produces useful
  settings: run a small grid on scrap and record whether labels, ordering, and
  chosen settings are readable.

### Sources

- LightBurn Material Test reference:
  https://docs.lightburnsoftware.com/Tools/MaterialTest.html
- LightBurn Interval Test reference:
  https://docs.lightburnsoftware.com/Tools/IntervalTest.html
- LightBurn Material Library reference:
  https://docs.lightburnsoftware.com/UI/MaterialLibrary.html

### Verification

- Documentation-only scope change. No production code changed in this ADR.
- `PROJECT.md` and `DECISIONS.md` must pass formatting and whitespace checks.

---

## ADR-045 - Native Material Library IO foundation

**Status:** Accepted; implementation staged. | **Date:** 2026-06-09

### Context

LightBurn's Material Library stores reusable Cut Settings presets and exposes
Load Library, Save Library, Save Library As, Create New Library, and Merge
Library With. The official docs identify `.clb` as LightBurn's saved library
extension and distinguish Assign from Link: Assign copies settings to the active
layer, while Link keeps the layer synced and disables normal Cut Settings
editing.

LaserForge now has Material Test / Interval Test generators and a pure
MaterialRecipe model. It still lacks the storage and file-document foundation
needed to preserve calibrated settings across projects. Public LightBurn docs do
not describe a stable `.clb` interchange schema, so treating `.clb` as our
canonical format would be reverse-engineering first and product work second.

### Decision

Add a native deterministic Material Library document format:

- Extension: `.lfml.json`.
- Format marker: `laserforge-material-library`.
- Schema version: `librarySchemaVersion: 1`.
- Content: library ID, display name, optional device hint, and entries.
- Entry metadata: ID, material name, either thickness or no-thickness title,
  description, recipe, and revision.
- IO behavior: two-space JSON, LF endings, trailing newline, structured
  deserialization errors, duplicate-ID rejection, and deterministic merge that
  preserves the base library while reporting skipped duplicate IDs.

Keep `.clb` import/export deferred until fixture-based research proves a stable
and safe compatibility path. Keep Link deferred until `.lf2` schema, missing
library UX, read-only layer controls, and preset revision handling exist.

### Consequences

- LaserForge can save, load, validate, and merge native material libraries
  without UI or hidden persistence.
- The IO foundation does not bypass preview, save, start, or preflight. Applying
  a recipe still happens through the layer model in later UI/store work.
- Device hints are advisory safety metadata. Later UI can warn when the active
  machine differs, but this ADR does not block cross-machine reuse.
- Full Material Library UI, LightBurn `.clb` compatibility, manufacturer
  profiles, and linked presets remain out of scope.

### Sources

- LightBurn Material Library reference:
  https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/
- Repo research:
  `audit/reports/lightburn-material-library-research-2026-06-05.md`

### Verification

- `src/io/material-library/material-library-io.test.ts` covers deterministic
  serialization, round-trip deserialization, malformed documents, duplicate IDs,
  invalid recipes, device hints, and merge behavior.
- Full typecheck, lint, format, file-size, test, build, and browser smoke gates
  are required before this ADR is considered implemented.

---

## ADR-046 - SVG import unit resolution (viewBox scaling + 96 DPI px)

**Status:** Accepted. | **Date:** 2026-06-10

### Context

Audit finding H9 (AUDIT-2026-06-10): the import boundary assumed 1 SVG user
unit = 1 mm in every case. `<svg width="50mm" viewBox="0 0 500 500">` — the
standard Inkscape/Illustrator export shape — imported 10× too large because
the declared physical size was ignored whenever a viewBox existed, and
px-authored files (no viewBox) imported 1 px = 1 mm where LightBurn's default
import DPI (96) sizes 96 px at 25.4 mm. PROJECT.md non-negotiable #6 requires
explicit conversion at the import boundary. `fitObjectToBed`'s shrink-to-90%
masked oversize imports with plausible-looking but physically wrong sizes.

### Decision

Resolve units once at the root of the import (`resolveUnitScale`,
`src/io/svg/parse-svg.ts`), seeding the transform stack so geometry and
bounds scale together:

- viewBox + physical width/height: user units scale by physical/viewBox per
  axis; a single declared axis drives both (preserve aspect); `%` and other
  unparseable lengths count as undeclared.
- viewBox only: 1 user unit = 1 mm (the long-standing Phase A assumption,
  kept — matches mm-authored plotter/laser exports).
- No viewBox: user units are CSS px at 96 DPI (`CSS_PX_PER_INCH = 96`,
  matching LightBurn's default import DPI), applied to geometry and to
  width/height bounds alike.

### Consequences

- Inkscape/Illustrator mm-sized exports import at true physical size; an
  import DPI *setting* (LightBurn offers one per format) stays future work.
- px-authored viewBox-less files now import 3.78× smaller than before —
  the previous size was the defect, not a compatibility surface.

### Verification

- `parse-svg.test.ts` "physical size + viewBox scaling (H9)": per-axis
  scaling, single-axis aspect preservation, 96 DPI px geometry + bounds,
  and the unchanged viewBox-only mm assumption.

---

## ADR-047 - Design tokens + shared chrome classes (dark chrome, light bed)

**Status:** Superseded by ADR-049 (chrome is now light; the token/class
architecture, kit primitives, and styling policy below remain in force — only
the dark color values and the `[data-theme='light']` future-theme mechanism are
replaced). | **Date:** 2026-06-10

### Context

The UI was ~260 ad-hoc inline `React.CSSProperties` objects across 77 files
with zero CSS: no hover/focus/active/disabled styling anywhere (inline styles
cannot express pseudo-states), an inconsistent chrome (dark menubar/toolbar/
statusbar over light panels), eight dialogs each duplicating the same
backdrop+panel shell, and ~15 duplicated button styles. The maintainer chose
a unified dark chrome with the canvas bed kept light (WYSIWYG against white
material), zero new dependencies, hand-rolled SVG icons.

### Decision

- **`src/ui/theme/tokens.css`** — the single global stylesheet, imported once
  in `src/ui/app/main.tsx`. Defines `--lf-*` custom properties (surfaces,
  text levels, semantic fills + text-on-dark variants, focus, type/space/
  radius scales, z-order map) and shared chrome classes (`.lf-btn` +
  variants, `.lf-input`/`.lf-select`, `.lf-dialog*`, `.lf-rail`, `.lf-card`,
  `.lf-banner--*`, `.lf-menu*`, `.lf-chip`, scrollbars, global
  `:focus-visible`). `color-scheme: dark` is scoped to dark-surface classes,
  not `:root`, so native controls flip per-surface during the migration.
- **`src/ui/theme/canvas-theme.ts`** — the Canvas2D palette as TS constants
  (custom properties cannot reach raw ctx calls). Values byte-identical to
  the literals they replace; the workspace viewport deliberately keeps its
  light look. The two genuinely shared values (selection ↔ `--lf-accent`,
  out-of-bounds ↔ `--lf-danger`) are pinned by `theme-sync.test.ts`.
- **Policy:** static presentational styling migrates to classes/tokens;
  DYNAMIC styling stays inline (drag-readout position, layer color swatches,
  progress width %, preview opacity). After the migration completes, a scoped
  `no-restricted-syntax` lint bans raw hex/`rgb(` literals in `src/ui/**`
  (theme files and tests excluded; scene-data colors like
  `DEFAULT_NEW_LAYER_COLOR` carry a justified disable).
- **Primitives** live in a new `src/ui/kit/` module (Dialog composing the
  existing `use-dialog-a11y`, Button, Field, NumberInput, IconButton,
  PanelHeading, icons) — `common/index.ts` stays within its export budget.
- A future light theme is a `[data-theme='light']` block re-declaring the
  custom properties; no component changes.

### Consequences

- Hover/focus/disabled affordances exist for the first time; dialogs share
  one a11y shell (the calibration dialogs gain the Escape/focus-trap they
  lacked); duplicated style objects collapse into classes.
- Visual output is invisible to jsdom — every migration batch requires a
  maintainer eyeball pass on the dev server, stated plainly in reports.
- Perf-sensitive surfaces (250 ms status poll, per-mousemove overlays,
  canvas draw loop) get flat colors only: no blur, no shadows, transitions
  limited to background/border color on interactive elements.
- Bundle cost ≈ +10 KB raw CSS (budget: <1 MB gzip total, currently ~205 KB).

### Alternatives rejected

- `theme.ts`-only typed constants: cannot express pseudo-states — the
  core deficiency would remain.
- TS→CSS codegen: build machinery for exactly two shared values; the sync
  test is cheaper and honest.
- CSS-in-JS / CSS modules / Tailwind: new dependency (ADR-017 gauntlet) or
  77-file churn for no additional capability at this scale.

### Verification

- `src/ui/theme/theme-sync.test.ts` pins the shared values; existing suite
  stays green per batch; `pnpm build:web` confirms the stylesheet lands in
  the bundle; per-batch maintainer eyeball checklist on `pnpm dev:web`.

---

## ADR-048 — Metadata-less bitmap imports default to 254 DPI (LightBurn parity)

**Status:** Accepted. | **Date:** 2026-06-11

### Context

A raster import with no embedded density metadata (the common case —
screenshots, web images, WhatsApp-stripped JPEGs) was sized at a hardcoded
96 DPI (`DEFAULT_DPI`, `src/ui/common/image-import.ts`). LightBurn's reference
default for the same input is **254 DPI** (0.1 mm/pixel). That is a 2.65×
physical-size divergence on the most common bitmap input, on a tool whose
declared user is a LightBurn switcher (PROJECT.md) and whose ADR-027 treats an
undocumented divergence from LightBurn as a defect. The 96 value was never
weighed against the reference: ADR-046 chose 96 DPI deliberately, but only for
**SVG** user units (LightBurn's separate SVG-import convention), and the bitmap
path inherited the same number without a decision (the feature audit,
FEATURE-AUDIT-2026-06-10.md, flagged this). The oversize-masking fit-to-bed
rescale hid the wrong physical size further.

### Decision

The metadata-less **bitmap** import default becomes **254 DPI** (a single named
constant, `DEFAULT_DPI = 254`). A 1000 px image now lands at 100 mm, matching
LightBurn. Images that *do* carry density metadata (PNG `pHYs`, JPEG JFIF/EXIF)
continue to import at their embedded DPI; the poison-density guard (the 10–10000
DPI sane range) still applies before the default is reached.

This changes the **bitmap** default only. **SVG px stay at 96 DPI per ADR-046** —
that is a separate LightBurn convention for vector user units and is unaffected.

### Consequences

- No-metadata bitmaps import 2.65× smaller than before — correct, but a behavior
  change for existing muscle memory. Surfaced in WORKFLOW.md F-F2.
- The trace overlay (`overlayTransformForRaster`) is unaffected: it reads the
  bitmap's stored mm bounds and px grid, so it is density-agnostic by
  construction (the stale "fixed 25.4/96 ratio" comments were refreshed).
- No change to images with real density metadata, which is the fidelity-critical
  path (scans, exports).

### Alternatives rejected

- **Keep 96 + record it as a deliberate divergence** (screenshots are authored at
  96 DPI): rejected — the maintainer chose LightBurn parity; a switcher's files
  and expectations are calibrated to 254, and ADR-027 makes parity the default.
- **Adopt a user-configurable import-DPI setting** (LightBurn has one): deferred —
  a preferences surface is a separate piece of work; 254 is the right default
  until then.

### Verification

- `src/ui/common/image-import.test.ts` pins the 254 fallback for absent/poison
  DPI; the explicit-DPI test is unchanged (it passes its own dpi). The
  `importImageFile` decode path stays jsdom-untestable and rests on the live
  pass / a LightBurn side-by-side, which is **not yet done**.

---

## ADR-049 — Unified light chrome (supersedes ADR-047's dark-chrome decision)

**Status:** Accepted. | **Date:** 2026-06-13

### Context

ADR-047 built the design-token system with a **unified dark chrome** over a
deliberately **light canvas bed** (WYSIWYG against white material), and
anticipated a future light theme as a `[data-theme='light']` block re-declaring
the custom properties. ADR-047 itself named "inconsistent chrome (dark menubar/
toolbar over light panels)" as part of the original problem. The maintainer has
since decided the app should have a **single light chrome** — unifying the
chrome with the always-light bed into one consistent surface, rather than dark
chrome contrasting a light bed.

This decision records a switch the code already implements (the working-tree
change the 2026-06-13 audit flagged as contradicting ADR-047's then-current
"Accepted" dark-chrome text — finding CQ-004).

### Decision

- **`src/ui/theme/tokens.css`** — the `--lf-*` custom properties at `:root` are
  redefined to a **light palette**: surfaces `#f8fafc / #ffffff / #f1f5f9`,
  inputs `#ffffff`, borders `#d0d7de / #9aa4af`; text `#111827 / #4b5563 /
  #6b7280`; light semantic text-on-surface (`--lf-*-fg`), light tints
  (`--lf-tint-*`), light `--lf-focus`, `--lf-backdrop`, `--lf-shadow`. The base
  semantic **fills** (`--lf-accent` `#1976d2`, `--lf-danger`, `--lf-success`,
  `--lf-warning`, `--lf-trace`) are **unchanged**.
- The light values live directly at `:root`; the dark values are **removed**,
  not kept behind a toggle. This **replaces ADR-047's `[data-theme='light']`
  mechanism** — there is one chrome, not a dark+light pair, so a second theme
  block would be dead complexity. The six per-surface `color-scheme: dark`
  declarations (`.lf-input`, `.lf-checkbox`, `.lf-dialog*`, `.lf-menu`,
  `.lf-chip`) become `light`; the three hardcoded dark hexes in `.lf-btn:hover`,
  `.lf-btn--primary:active`, and `.lf-chip` background move to light equivalents.
- **`index.html`** — `color-scheme` narrows from `light dark` to `light`.
- **`public/404.html`** — the static error page flips to the light palette
  (`#f8fafc` bg, `#111827` text, `#1976d2` link) to match.
- **Unchanged from ADR-047:** the token architecture and shared `.lf-*` classes,
  the `src/ui/kit/` primitives, the static-vs-dynamic styling policy, the
  `no-restricted-syntax` color-literal ban, and `src/ui/theme/canvas-theme.ts`
  (the canvas bed was already light; the two shared values `--lf-accent` ↔
  selection and `--lf-danger` ↔ out-of-bounds are unchanged, so
  `theme-sync.test.ts` is unaffected).

### Consequences

- One consistent light surface across chrome and canvas bed; WYSIWYG against
  white material is preserved and the chrome no longer contrasts the bed.
- Native form controls render light (`color-scheme: light` per surface), and the
  `color-scheme: light` meta means an OS dark-mode preference no longer flips the
  chrome — deliberate, since there is no dark theme to flip to.
- No component code changes — only token/values plus the two static HTML files.
- ADR-047's dark-specific guidance (dark-scoped `color-scheme`, dark tints) is
  superseded; future theme work re-declares the `:root` tokens here, centrally.

### Alternatives rejected

- **Keep dark chrome (ADR-047 as-is):** rejected — the maintainer chose a light
  UI; leaving the ADR "Accepted" while the code shipped light is the CQ-004
  docs-as-spec contradiction this ADR resolves.
- **Implement light as a `[data-theme='light']` block alongside dark** (ADR-047's
  anticipated mechanism): rejected — a single chrome makes a second theme block
  dead complexity; the light values live at `:root`.

### Verification

- `src/ui/theme/theme-sync.test.ts` still pins the canvas-shared values
  (unchanged) and passes; the full suite stays green (197 files / 1411 tests);
  `prettier --check` clean; `pnpm build:web` lands the stylesheet.
- Visual output is jsdom-invisible (per ADR-047) — the rendered light chrome
  rests on a maintainer eyeball pass on `pnpm dev:web`. The token values here are
  the maintainer's authored change; this ADR records the decision, it does not
  re-design it.

---

## ADR-050 — Module-level memoization caches in core/job (narrow exception to "no module-level mutable")

**Status:** Accepted. | **Date:** 2026-06-13

> Numbered after ADR-049 (light chrome), which lands via a separate change.

### Context

CLAUDE.md bans module-level mutable variables, and `src/core/` must be pure. Two
module-level `WeakMap` caches exist in the compile path:
`src/core/job/compile-job.ts` (`layerFillCache`) and
`src/core/job/fill-hatching-cache.ts` (`hatchCache`). The 2026-06-13 code-quality
audit flagged these (finding CQ-005) as contradicting the policy. This ADR
records why they are a **narrow, allowed exception** rather than a violation — so
future maintainers and audits stop re-flagging them.

### Decision

Module-level caches are permitted in `src/core/job` **only** when they are
*observationally-pure transparent memoization*, i.e. all of:

- **Identity-keyed via `WeakMap`** on an input object — `ReadonlyArray<Polyline>`
  / `ReadonlyArray<SceneObject>`. Entries are GC-bounded (they vanish when the
  input is collected) and scoped to specific inputs; no unbounded growth, no
  leakage across documents/sessions.
- **Output-invariant.** The cache key includes *every* setting that affects the
  result (`hatchAngleDeg`, `hatchSpacingMm`, `fillBidirectional`,
  `fillCrossHatch`). A settings change can never return a stale geometry; the
  function's output is identical whether or not the cache hits.
- **Bounded inner map.** The per-input `Map` caps at 8 entries
  (`MAX_SETTINGS_PER_POLYLINE_SET` / `MAX_LAYER_FILL_CACHE_ENTRIES`) with
  oldest-entry eviction.
- **Test-protected.** `src/core/job/compile-job-fill-cache.test.ts` pins the
  hit / stale-bust / eviction behavior.
- **Justified by the hot path.** Fill hatching recompute is expensive and the
  compile path runs on every preview / estimate / save / start (ADR-040), so
  memoization keeps interactive recompiles responsive.

This is **not** a general license for module state. It does **not** permit caches
that change output, time- or seed-dependent state, unbounded maps, or state keyed
by anything other than input identity. Any other module-level mutable still
violates the rule and needs its own ADR. Each cache declaration carries a comment
pointing here.

### Consequences

- The two caches stay in place; no refactor to a caller-threaded cache.
- Auditors who see the `WeakMap` find this ADR (and the in-file comment) instead
  of re-opening CQ-005.
- A future cache here that changes output or grows unbounded falls **outside**
  this exception and is a real violation.

### Alternatives rejected

- **Thread an explicit `CompileJobCache` through `compileJob` /
  `memoizedFillHatching` callers:** rejected — pushes a cache parameter through
  the UI / preview / estimate call chain for zero behavioral change; the WeakMap
  identity-keying already gives correct invalidation and GC bounding.
- **Remove the caches:** rejected — measurable recompute cost on a path ADR-040
  runs on every preview and estimate.

### Verification

- `src/core/job/compile-job-fill-cache.test.ts` passes (a cache hit returns
  identical geometry; a settings change busts the key; eviction bounds the inner
  map). Full suite green.

---

## ADR-051 — Phase G: on-canvas drawing tools (shape SceneObject variant + tool-mode)

**Status:** Accepted. | **Date:** 2026-06-14

### Context

LaserForge is a "LightBurn-style CAM app" (PROJECT.md), but geometry can ONLY
enter via SVG / image / text import — there are zero drawing tools (no rectangle,
ellipse, polygon, or line). The 2026-06-13/14 LightBurn parity audits confirmed
this is the single largest divergence: journey J1 ("draw a sign from nothing") is
*impossible*, and J3 ("batch 20 keychains") is effectively impossible.

Parametric primitive creation is NOT on PROJECT.md's out-of-scope list, but adding
it is past-Phase-F work, so it needs this ADR + a PROJECT.md phase entry. This ADR
covers **parametric primitive creation only**. The geometry *kernel* — weld,
boolean ops, offset, node editing — stays out of scope (a future phase + its own
ADR + an ADR-017 polygon-clipping library evaluation).

### Decision

- **`src/core/shapes/`** — a new pure module: shape → polylines geometry.
  Rectangle (with corner radius), Ellipse (adaptive flattening, reusing
  `io/svg/flatten-curves` math), regular Polygon, and open/closed Polyline. Pure,
  deterministic, unit-tested; imports from `core/` only.
- **A `kind: 'shape'` `SceneObject` variant** carrying a discriminated parametric
  block — `{ kind: 'rect'; widthMm; heightMm; cornerRadiusMm } | { kind: 'ellipse';
  widthMm; heightMm } | { kind: 'polygon'; sides; radiusMm } | { kind: 'polyline';
  points; closed }` — PLUS materialized `paths: ColoredPath[]`. This is exactly the
  `TextObject` precedent (`scene-object.ts`): `compileJob` / preview / emit /
  serialize iterate `paths` **unchanged**, and `assertNever` forces exactly one new
  switch arm per consumer (the ADR-014 extensibility contract). The `.lf2` schema
  change is additive (new variant) — `schemaVersion` stays 1
  (additive-with-default, like every prior variant); `project-shape-validator`
  gains a `validateShapeObject` arm.
- **Tool-mode** in the UI store: a discriminated union
  `{ kind: 'select' } | { kind: 'draw'; shape: 'rect' | 'ellipse' | 'polygon' |
  'polyline' }`. A vertical tool strip sets it; **Esc always returns to Select**.
  `Workspace` mousedown dispatches on tool-mode BEFORE the existing select/drag
  logic; a drag creates the shape on the **currently-selected layer** with a live
  mm readout (reusing the existing DragReadout).
- **Staged, each its own reviewed diff:** B1 `core/shapes` rect→polylines → B2
  'shape' variant + Rectangle + all `assertNever` arms → B3 ellipse + polygon → B4
  tool-mode + tool strip + Esc → B5 `Workspace` draw-on-drag (rect) → B6 ellipse /
  polygon / pen → B7 migrate `Ctrl+E` (Save G-code → Alt+Shift+L) to Ellipse, the
  LightBurn binding, before muscle memory entrenches.

### Consequences

- J1 (draw a sign) flips impossible → possible after B5; the full primitive set
  lands at B6. J3 (batch) is unblocked by the follow-on layout increment (clipboard
  / group / align / grid array), a separate ADR/phase.
- `compile` / preview / emit / save are **untouched** — a shape materializes
  `paths` like `TextObject`, so new shapes flow through the existing pipeline
  (line / fill / image modes, path optimization, preflight, undo/redo, transform,
  selection) for free. The `SceneObject` union grows to five variants; `assertNever`
  keeps every consumer honest.
- Interactive parametric handles (drag corner-radius / sides) and Convert-to-Path
  are deferred (P2 — they need the variant first). Text-on-path, node editing, and
  the geometry kernel remain out of scope.

### B7 as-built (2026-06-14)

The staging line above proposed *Ellipse-only* on `Ctrl+E` with Save G-code moving
to `Alt+Shift+L`. As shipped (maintainer-approved), B7 instead binds LightBurn's
**full tool set** — `Ctrl+R` rectangle, `Ctrl+E` ellipse, `Ctrl+L` pen — and moves
export G-code to **`Ctrl+Shift+E`**, not `Alt+Shift+L`. Reason: a LightBurn-binding
check found `Alt+Shift+L` is *not* a LightBurn shortcut and collides conceptually
with LightBurn's `L` = Line tool; `Ctrl+Shift+E` keeps the export mnemonic without
colliding with the tool keys. `Ctrl+R` / `Ctrl+L` deliberately override the browser
reload / address-bar defaults in the web build (acceptable on a CAD surface).

### Alternatives rejected

- **A generic node-edited "path" object:** rejected — needs a node editor (out of
  scope) and gives no parametric W/H/radius. The parametric variant is the
  LightBurn model and the smaller build.
- **Draw by emitting SVG and re-importing:** rejected — loses parametric
  editability and round-trips through the importer for no benefit.
- **A separate non-`SceneObject` "shapes layer":** rejected — breaks the
  single-pipeline model; shapes must be ordinary `SceneObject`s so compile /
  preview / emit / select / transform all work unchanged.

### Verification

- `core/shapes` geometry is unit-tested (shape→polylines correctness, closure,
  adaptive ellipse tolerance). The 'shape' variant adds a G-code snapshot + a
  round-trip `.lf2` test. Per CLAUDE.md rule 2, drawn shapes are verified by
  **rendering** — draw a 50×80 mm box, confirm it appears and compiles to the
  expected G-code — not by green tests alone.

---

## ADR-052 — Scanning offset compensation: a per-speed table cancels the bidirectional zipper

**Status:** Accepted; core model, emitters, bounds, IO, tests, and opt-in UI landed. Calibration workflow pending. | **Date:** 2026-06-17

### Context

ADR-038 added a per-layer unidirectional fill toggle to remove the bidirectional
firing-lag "zipper" (Cause C, docs/research/burn-perfection-small-text.md) by
*serialising* the rows — every row in one direction, a laser-off return-rapid
between them. It explicitly deferred "a full scan-offset *compensation* table
(correcting bidirectional rows rather than serialising them)" as the heavier
lever.

Field report makes that lever worth building now: the same GRBL output that
burns clean text on a Creality Falcon A1 Pro doubles / serrates letters on a
heavier `neotronics-4040-max`-class gantry (the "PRT 4040"). Our output is
machine-independent except for power scale (`grbl-strategy.ts`), so the variable
is the machine: a heavier gantry has more firing/motion lag, so the per-direction
offset that the Falcon hides is large enough on the 4040 to split every vertical
edge. Unidirectional (ADR-038) fixes it but halves fill throughput. We want the
zipper gone *and* bidirectional speed kept.

Reference check (recorded in RESEARCH_LOG): `barebaric/raygeo` (Rayforge's Rust
raster core) structures bidirectional sweeps as `is_reversed = index % 2` plus an
endpoint swap and applies **no** lag compensation — same blind spot we have, and
it is unlicensed, so nothing is borrowed. The serpentine-by-parity idea is the
standard unprotectable technique; the implementation here is written fresh
against our own `Vec2` / sweep types.

### Decision

Add scan-offset compensation as a **pure geometry transform**, decoupled from the
GRBL emitter so Fill and Image (raster) share one implementation and a future
controller (ADR-006) inherits it for free. Two pure functions in
`src/core/job/scan-offset.ts`:

- **`offsetForSpeed(table, feed)`** — piecewise-linear lookup over a per-device
  calibration table (`ScanOffsetPoint[]`, sorted by speed). Off-end behaviour is
  *defined*, not implementation-specific: linear from rest below the first point
  (lag distance is ~proportional to speed), clamped above the last; empty table
  or non-positive speed returns 0.
- **`shiftAlongTravel(from, to, offsetMm)`** — translate a sweep along its own
  `from -> to` vector. Applied to reverse rows only, this slides the lagging row
  back into registration. Following the travel vector (not the X axis) makes the
  correction correct at **any hatch angle** — the differentiator over an
  X-only/horizontal-only correction.

Storage: a new `DeviceProfile.scanningOffsets: ReadonlyArray<ScanOffsetPoint>`,
default `[]` (= feature off, output byte-identical). We correct **reverse rows
only** (not half-to-each): forward rows and all vector cuts stay at exact design
coordinates, so mixed line+fill registration is preserved, and the calibration
value is exactly the measured forward-vs-reverse separation.

Delivered in reviewable slices (CLAUDE.md "tight leash"):

1. the pure module + co-located unit/property tests;
2. `DeviceProfile.scanningOffsets` + project/material IO normalization;
3. raster reverse-row X shifts and fill reverse-sweep `shiftAlongTravel` wiring;
4. scan-offset-aware job/frame bounds so Frame placement and safety checks see
   compensated output extents;
5. the device-settings table UI.

The calibration-pattern workflow and machine-specific default tables remain
future work. The Neotronics 4040 profile still ships with `[]` rather than a
guessed default.

### Consequences

- Keeps bidirectional speed while removing the zipper, once calibrated — the
  complement to ADR-038's calibration-free unidirectional lever. The two compose:
  bidirectional ON + a populated table = the fast, registered path.
- Default `[]` means zero behaviour change until a user calibrates; determinism
  (#5) holds — both functions are pure inputs to pure functions.
- One shared transform for fill + raster avoids the duplication raygeo carries
  (direction handling baked into each `rasterize_*`).
- Requires a per-machine calibration burn; an uncalibrated or mis-measured table
  can *worsen* registration, so the UI must ship with the test pattern and the
  feature stays opt-in. A wrong table is a user-visible regression, not a crash.

### Alternatives rejected

- **Unidirectional-only (ADR-038) as the final answer:** rejected — it halves
  fill throughput; this ADR is specifically the "keep the speed" path ADR-038
  deferred.
- **Borrow/port raygeo's raster sweep:** rejected — it has no compensation to
  borrow, is unlicensed (fails the ADR-008/018 dependency policy), and is coupled
  to its own `Ops` type.
- **Single global offset (not speed-indexed):** rejected — lag is ~constant time,
  so the distance error scales with feed; one number is wrong at every speed but
  one.
- **X-axis-only shift:** rejected — breaks for angled and cross-hatch fill;
  shifting along the sweep vector is barely more code and generalises.
- **Split the offset half-to-each-direction:** rejected for v1 — moves forward
  rows off design coordinates and complicates line+fill registration; reverse-only
  keeps the design position authoritative. Revisit only if a machine shows
  asymmetric lag.

### Verification

- `src/core/job/scan-offset.test.ts`: unit cases pin empty-table, non-positive
  speed, exact calibration points, linear interpolation, from-rest below the
  first point, clamp above the last, and a single-point table; property tests
  (100 seeds) assert the lookup stays within `[0, maxOffset]` and is monotonic in
  speed for an ascending table, and that `shiftAlongTravel` is a rigid translation
  that moves each endpoint by exactly `|offsetMm|`.
- Step-1 output is byte-identical (nothing imports the module) — existing
  snapshots unchanged by construction.
- `tsc --noEmit` + lint green.
- **Hardware verification (gates step 2):** burn the calibration pattern on the
  4040, populate the table, then re-burn the "langebaan" small text bidirectional
  and confirm the edge serration is gone at full fill speed — green tests prove
  the math, not the fidelity (CLAUDE.md rule 2).
---

## ADR-053 — Verified Origin: hand-set origin + mandatory verified frame for no-homing / hand-positioned machines

**Status:** Accepted; P1–P4 code shipped, hardware verification pending. Generalized by ADR-228 — the verified-origin frame requirement became the universal frame-first gate for every placement mode. | **Date:** 2026-06-17

> Numbered after ADR-052 (scan-offset compensation), which lands via a separate
> branch. 052/053 are concurrent feature branches off the same main.

### Context

On machines without usable homing, the operator positions the head by hand (or
jogs it) and uses **Set origin here** (`G92`, ADR-021), then Start/Frame reject
with "design overhangs the bed." Disabling Homing in the device profile does
**not** fix it. Root cause, traced through the code:

- Bed-bounds preflight needs **absolute machine position**, which only exists
  after `$H` homing. ADR-022 added a `relative-origin` mode that checks job
  **size** (does it fit the bed) instead of **position** (where on the bed) when
  no trusted offset exists.
- But that relative path is entered only when **both** (a) a job origin is set
  (`jobOrigin !== undefined`, i.e. User Origin / Current Position) **and**
  (b) `trustedMotionOffsetForPreflight` returns `undefined` (which it does only
  when `device.homing.enabled === false`). In the **default Absolute** start
  mode, `jobOrigin` is undefined, so `describeFrameMotionPreflightIssue`
  (`JobControls.tsx`) and `findPlacementBoundsIssue` (`start-job-readiness.ts`)
  fall through to the absolute `framePreflight` against the artwork's *canvas
  placement* — and the homing flag is never consulted on that path. So "Homing
  off" alone does not stop the false block.
- Worse: **hand-jogging desyncs GRBL's step counter.** After a hand-move the
  reported machine position is fiction, so on a homing-*capable* machine the
  `homing.enabled === true` path trusts a bogus `mPos`/WCO and maps the job to a
  confidently-wrong absolute location — also a false "overhangs."

There is no first-class, discoverable, *safe* workflow for "I put the head here
by hand; trust me; just check it fits, and let me frame it." User Origin +
homing-off approximates it but is a side-effect, still trusts position when
homing is enabled, and provides no frame gate or limit-switch safety.

### Decision

Introduce a first-class **Verified Origin** start mode. Four parts:

1. **New `JobStartMode = 'verified-origin'`.** Placement resolves like
   `user-origin` (anchor → `G92` work-zero) but is **always position-untrusted**:
   `trustedMotionOffsetForPreflight` returns `undefined` for this mode
   *regardless of* `device.homing.enabled`, forcing the relative / size-only
   preflight. The absolute "overhangs the bed" **position** block cannot fire in
   this mode.

2. **Mandatory frame-verified gate.** Start is disabled until a clean **Verified
   Frame** has run from the current origin. New laser-store state
   `frameVerification` records a signature over `{ WCO/origin, anchor,
   prepared-job identity }`; a successful frame sets it, Start checks it.

3. **Invalidation rules — the core correctness burden.** `frameVerification`
   clears on ANY of: origin moved (WCO change / Set origin / Reset origin), job
   or output scope changed (signature mismatch), controller `Alarm` or
   soft-reset (which itself clears `G92`), disconnect / streamer reset, or
   start-mode change. A stale verification must **never** authorize a burn.

4. **Limit-switch-aware Verified Frame.** Extend the GRBL status parser to read
   the `Pn:` field (currently unparsed — `status-parser.ts:16`) into
   `StatusReport.pins`. During the Verified Frame: if a limit pin reports active,
   or hard-limit `ALARM:1` fires (already modeled, `alarm-codes.ts`), abort and
   name the edge ("Verified frame hit the X+ limit — move the origin or shrink
   the job"). Reliability scales with hardware: best with switches wired and
   `$21` hard limits enabled (we already parse `hardLimitsEnabled`); with
   `$21=0` it is best-effort plus the operator's eyes.

**Keeps (safety preserved or strengthened):**
- The **size / envelope** check stays a HARD block — a job larger than the bed
  can never fit and would slam both travel ends; always-correct, cheap, kept.
- The frame becomes **required** (stronger than today's optional frame).
- Hard-limit `ALARM:1` abort is surfaced as a frame failure.

**Drops (only the unknowable check):**
- The absolute bed-**position** block — meaningless after a hand-set origin — no
  longer fires *in this mode*. Other modes are unchanged.

**Hand-jog support (sub-decision, phased).** A "Release motors" control
de-energizes the steppers so the gantry can be pushed by hand. Captured caveat:
`$SLP` sleep needs a soft-reset to resume, and a soft-reset **clears the `G92`
origin** — so the UI sequence MUST be release → hand-move → wake → **Set Verified
Origin last**, never the reverse. Where the GRBL build supports a gentler
stepper-disable (`$MD` / `M18`) without a reset, prefer it.

**Phasing (smallest reviewable diffs, CLAUDE.md "tight leash"):**
- **P1** — `'verified-origin'` mode + force-relative preflight (fixes the false
  block). Pure core (`job-origin` / `job-placement`) + the UI mode toggle.
- **P2** — `frameVerification` state + invalidation + the Start gate.
- **P3** — `Pn:` parsing + limit surfacing during the Verified Frame.
- **P4** — Release-motors control + the hand-jog sequence UI.

### Consequences

- The false "overhangs" disappears for hand-positioned machines **without**
  weakening protection — net safety is *higher* (mandatory + limit-aware frame).
- The new `frameVerification` state with strict invalidation is the main
  complexity and the main test surface; a verification bug authorizes a wrong
  burn, so it is treated as safety-critical.
- `Pn:` parsing is a small, well-scoped status-parser extension that also unlocks
  a live limit/probe-pin display later.
- Decoupling trust from `device.homing.enabled` also fixes homing-capable
  machines that were hand-jogged (previously mis-trusted).
- Mirrors LightBurn's User Origin + framing model (clears the ADR-027
  source-of-truth bar) and stays GRBL-generic (ADR-006) — no homing required.

### Alternatives rejected

- **Tell users to use User Origin + homing-off:** rejected — a non-obvious
  side-effect, still trusts position when homing is enabled, no frame gate, no
  limit safety; the field problem persists (reported still-blocking).
- **Relax bed-bounds globally:** rejected — destroys the only crash protection on
  `$20=0` machines (`frame-preflight.ts` rationale). We drop only POSITION, only
  in this mode, and keep SIZE.
- **Trust GRBL position without homing (assume boot-zero):** rejected —
  hand-jogging desyncs the step counter; the position is fiction and yields
  confidently-wrong bounds.
- **Make the frame optional in verified mode:** rejected — the frame *is* the
  safety substitute for the dropped position check; optional = no net safety.
- **Require homing instead:** rejected — these machines have no `$H`-usable
  switches (or the operator is deliberately hand-positioning); ADR-006 keeps us
  GRBL-generic, not homing-required.

### Verification

- **Core unit tests:** `'verified-origin'` resolves to a relative placement with
  an undefined trusted offset **even when `homing.enabled === true`**; a
  size-too-big job still blocks; a position-off-bed job does NOT block.
- **State-machine tests:** a clean frame sets verification; each invalidation
  trigger (origin move, job edit, alarm, soft-reset, disconnect, mode change)
  clears it; Start is blocked until verified and allowed after.
- **status-parser tests:** `Pn:XYZ` / `Pn:X` / field-absent parse into
  `pins` correctly; a Verified Frame aborts on an active limit pin and on
  `ALARM:1` with the right edge message.
- Full suite + `tsc --noEmit` + lint green. This mode changes placement / preflight
  gating, not emitted toolpath geometry for a given origin — confirm no existing
  G-code snapshot moves.
- **Hardware (gates "done"):** on a no-homing machine, hand-position, Set Verified
  Origin, run a Verified Frame that trips a limit and confirm it names the edge;
  then a clean frame enables Burn; confirm Start is blocked until framed and after
  any origin nudge.
---

## ADR-057 — Registration Box: camera-free placement jig

**Status:** Accepted; core + IO shipped, UI in progress, hardware verification pending. | **Date:** 2026-06-24

### Context

On a no-homing, no-camera machine (the tester's PTR 4040), centering a burn on a
physical object (a keychain blank, a coaster) is trial-and-error: the operator
pencils a square on a board to mark where the object sits, jogs the head to it,
test-burns, finds it off-center, jogs again. It wastes time and scrap. LightBurn
users solve this with a physical jig + Set Origin; we already had Set Origin
(ADR-021) and Frame, but no first-class jig workflow.

### Decision

A **registration box** is a real, locked rectangle `ShapeObject` on a **reserved
registration layer**, burned once as a physical placement reference. The operator
then places the workpiece inside the burned outline and positions artwork relative
to the box on the canvas; both burn from the same origin so the art lands where it
sits relative to the box. Three parts:

1. **Box + reserved layer (no schema change).** `createRegistrationBox`
   (`core/shapes/registration-box.ts`) builds a locked rectangle via
   `createRectangle` with the reserved color `REGISTRATION_LAYER_COLOR`.
   `createRegistrationLayer` (`core/scene/registration-layer.ts`) is a line-mode
   layer with the reserved id `'registration'` — identified by id, NOT color, the
   same pattern as the calibration-label layers (`material-test-labels`,
   `scan-offset-calibration-labels`). The object->layer join stays by color
   (`compile-job.ts`). Box + layer persist in `.lf2` for free (`locked` already
   round-trips; confirmed by `project-registration-jig.test.ts`), so there is no
   `SceneObject` / schema / `schemaVersion` change.

2. **Two runs via the per-layer `output` toggle.** Run 1 outputs only the
   registration layer (burns the box); the operator places the object; run 2
   outputs only the artwork. This reuses the existing `if (!layer.output) continue;`
   mechanism (`compile-job.ts`) — no new run/sequencing concept.

3. **Box-anchored placement — the correctness crux.** `jobOriginOffset` normally
   anchors to the *output-enabled* bounds, so run 1 (box) and run 2 (art) would
   re-anchor to *different* bboxes and the art would land at the bed corner. When a
   jig is present, `prepareOutput` (`resolveJobOriginOffset`) instead anchors EVERY
   run to the box via `computeRegistrationBoxBounds`
   (`core/job/registration-placement.ts`) plus the existing
   `jobOriginOffsetFromBounds` / `applyJobOriginOffset`. Both runs receive an
   identical box-anchored offset, so the art keeps its position relative to the
   box. This lives in the single shared prepared-output pipeline (ADR-040), so
   preview = save = start = estimate all agree.

Pairs with Set Origin (ADR-021) / Verified Origin (ADR-053) for the physical
anchor on no-homing machines.

### Amendment (registration jig UI + movable box)

Two follow-ups refined the above after the maintainer tested it:

- **UI consolidated into one panel.** The four flat Tools-menu commands
  (Registration Box / Center in box / Burn Box Only / Burn Artwork Only) read as a
  confusing button soup, not one stateful two-run workflow. They are replaced by a
  single `tools.registration-jig` toolbar toggle that opens a persistent,
  **non-modal** `RegistrationJigPanel` pinned top-right of the canvas: a live
  "next burn" banner (`registrationRunState`), inline box create/replace/remove,
  center-in-box, the Box/Artwork output toggle, and built-in how-to. It stays open
  while the operator works on the canvas (it never calls `useRegisterModal`).

- **The box is movable, not locked.** Identifying the jig box now keys on the
  reserved color alone (`findRegistrationBoxes` / `isRegistrationBox`), NOT on the
  `locked` flag, so `createRegistrationBox` no longer locks it. The operator can
  drag it onto the material — essential on a homing machine, where the box's
  on-canvas position *is* its absolute bed position — and delete it via the panel's
  **Remove box** button (`removeRegistrationBox`, which drops the box and the
  reserved layer). Note the box-anchored offset (#3 above) only applies in an Origin
  start mode; in **Absolute** mode both runs emit at their true on-canvas positions,
  so a homed machine aligns the two runs with no Set-Origin step.

### Consequences

- The jig is a composition of existing machinery — reserved-id layer (ADR-005
  color-keyed, calibration-layer precedent), `createRectangle` (ADR-051), per-layer
  output, and the ADR-040 placement pipeline — so the new surface is small (two
  pure-core files plus a one-branch change in `resolveJobOriginOffset`).
- Box-anchored placement is **safety/correctness-critical** (origin honesty,
  non-negotiable #2): a wrong offset burns the art in the wrong place. It is
  property-tested for alignment invariance across both runs
  (`registration-placement.property.test.ts`).
- No-op for every non-jig project: `computeRegistrationBoxBounds` returns null when
  no registration layer is present, falling through to existing placement.
- The reserved color is a documented sentinel; identification keys on the reserved
  id, so a color collision is cosmetic, not a mis-placement.

### Alternatives rejected

- **A non-object canvas overlay region (Measure-tool style):** rejected — the box
  would not flow through compile/preview/emit, the art would not sit in real scene
  space relative to it, and the two-run burn would need bespoke sequencing instead
  of the existing output toggle.
- **A new `SceneObject` kind or a persisted `registrationJig` field:** rejected for
  v1 — both add union/schema surface (and a `schemaVersion` bump) for no gain over
  a reserved-id layer that already persists.
- **Re-anchor each run to its own output bbox (do nothing):** rejected — this is
  exactly the bug; the art would burn at the corner, not in the box.
- **Burn box + art in one pass:** rejected — removes the physical placement step
  that is the entire point of the jig.

### Verification

- **Core/IO tests:** generator + reserved-layer predicates
  (`registration-box.test.ts`, `registration-layer.test.ts`);
  `computeRegistrationBoxBounds` measures only the box and is stable across the
  output toggle (`registration-placement.test.ts`); `.lf2` round-trip
  (`project-registration-jig.test.ts`).
- **Property test (alignment invariance):** box-run and art-run receive an
  identical box-anchored offset; the box anchors to work-zero; the art lands at its
  offset relative to the box, not at the corner
  (`registration-placement.property.test.ts`).
- Full suite + `tsc --noEmit` + lint green; no existing G-code snapshot moves
  (non-jig placement unchanged).
- **Hardware (gates "done"):** on the 4040, Set Origin, burn the box, place the
  object, center the art, burn the art, and confirm it lands centered in the box.

---

## ADR-058 — Centerline trace rework: a measured pixel-centering bar + junction chaining

**Date:** 2026-06-25
**Status:** Accepted. Measurement harness, junction chaining, allocation-free
thinning, and preset-aware mask thresholding have landed; EDT-driven thinning
quality and iterative spur pruning are pending slices.

**Context.** Centerline trace (`traceMode: 'centerline'`) produced fragmented,
broken glyphs and was reported to lag/time out on big images. Causes — confirmed
by a code audit + algorithm research and reproduced on the maintainer's real
Arch House logo (1024px → **229** disconnected polylines from 745 points):

- `extractCenterlinePolylines` walked the skeleton pixel-by-pixel and **stopped
  at every junction**, emitting one fragment per edge; a collinear-only
  `mergeCollinearOpenPolylines` (O(n³)) glued straight pieces back but left every
  curve/bend split — the broken letters.
- Zhang-Suen `thinMask` is O(iterations × W×H) and allocates a neighbour array
  per ink pixel per pass (the big-image cost); it also leaves **multi-pixel
  junction clusters** (a crossing's edges end at different adjacent pixels) plus
  gaps and spurs.
- The ink threshold was a hard global `128`, independent of the preset.

Green structural tests (path counts) never measured centering, so the defect was
invisible to CI — the standing "looks faulty vs the source" gap (see ADR-025).

**Decision.**

1. **Measure the bar.** A test-only harness under `src/__fixtures__/perceptual/`
   (ADR-025 family): ground-truth stroke fixtures with analytically-known
   centerlines + a deviation metric (max/mean centering deviation, coverage gaps,
   fragment & spur counts), a self-contained `node:zlib` PNG decoder, and a
   real-logo baseline that renders `[source | centerline | diff]`. Bar: synthetic
   strokes centered ≤1px, connected through junctions, spur-free; the real logo's
   text clean + connected (re-rendered each iteration); big images fast.
2. **Replace the algorithm** (graph-based, full-resolution to preserve
   pixel-perfect centering — downscale only as an extreme-tail safety valve):
   - **a. Junction chaining** (`centerline-chain.ts`) — treat the skeleton as a
     graph; cluster branch ends within a small radius into one node (absorbs the
     Zhang-Suen clusters); pair the straightest-through edges by least turning
     angle so a stroke stays one polyline through junctions. Replaces the
     collinear-only O(n³) merge. **[LANDED]**
   - **b. Allocation-free thinning.** Zhang-Suen rewritten with inline neighbour
     reads (no per-pixel array) + a compacting active-ink list — O(ink) per pass,
     not O(W·H). Skeleton byte-identical, ~2.4× faster at 16MP. **[LANDED]** A
     frontier queue and/or an EDT-driven thinner (cleaner skeleton: fewer
     gaps/spurs, better corners) is the pending quality+perf follow-up.
   - **c. Iterative spur pruning** by branch length AND EDT radius (drop the
     all-branches re-admit fallback). **[PENDING]**
   - **d. Preset-driven ink threshold.** `centerlineMaskFromImage` now accepts
     caller threshold/cutoff settings instead of baking every mask at 128.
     `traceImageToCenterlinePaths` still lets `preprocessForTrace` own manual
     threshold bands, Otsu, alpha masks, and despeckle before mask extraction so
     cutoff bands are not applied twice. **[LANDED]**
3. Salvage the exact O(N) distance transform, RDP simplify, and curve fit — fed
   graph-extracted strokes.

**Consequences.** Chaining alone dropped the real logo from 229 → **155**
polylines (longer, connected strokes), removed the O(n³) merge, and reconnects
crossings (synthetic cross 4 → 2). Remaining gaps — arc fragmentation across a
skeleton break, corner centering ~1.5px, and thin-text breaks are
thinning-quality and are the pending slices (2b/2c). The harness
gates every step. References ADR-025 (perceptual harness), ADR-026/027 (trace
overlay / divergence).

### Amendment — divide-and-conquer extraction replaces the graph-walk (2026-06-25)

Slice 2's "fix the graph-walk node classification" was abandoned: classifying
skeleton pixels by 8-neighbour degree over-reports junctions on curves, and
every patch (crossing number; `degree>=2 && crossingNumber<=2`) traded one
regression for another (spurs vs. shifted junction fits). After studying the
open-source tracers, we switched paradigms to the **divide-and-conquer** method
(the LingDong/skeleton-tracing technique): recursively split the skeleton at the
lowest-crossing line of its longer dimension, and per small chunk read only
where strokes CROSS the chunk border (0→none, 1→stub to the tip, 2→a chord or a
through-the-bend route for corners, ≥3→crossroad to the centroid). Reading
border crossings is immune to the 8-connectivity imperfections that shattered
the graph walk. **Clean-room: our own implementation of the (non-copyrightable)
algorithm — no port, no third-party code/license.** Modules: `centerline-chunk.ts`
(base case) + `centerline-divide.ts` (recursion); `extractCenterlinePolylines`
is now a thin pipeline (segments → `chainBranches` → fit). Result on the harness:
the arc fixture (4 fragments + 3.3px gap, never passed) is now 1 connected stroke
within the bar; the real logo drops 229→137 polylines with the small text
("LANGEBAAN") readable. The remaining l-corner ~1.5px is Zhang-Suen rounding the
corner (a thinning limit, slice 2c — not the extraction).

---

## ADR-059 — Edge Detection trace mode: clean-room Canny → single-stroke vectors

**Date:** 2026-06-25
**Status:** Accepted. Landed end-to-end on `feat/edge-detection`: clean-room
Canny engine, the `traceMode: 'edge'` pipeline, and the "Edge Detection" preset
(auto-listed in the Import dialog). An edge-sensitivity UI control mapping to the
Canny thresholds is a follow-up.

**Context.** Our trace presets (Line Art / Smooth / Sharp, `traceMode:
'filled-contours'`) all reduce the image to a brightness **silhouette** (Otsu
threshold → outline) — the equivalent of the reference tool's "Brightness
Cutoff". On a full-colour logo (the maintainer's Arch House) that flattens the
internal detail away. The reference's "Edge Detection" mode instead finds every
brightness transition and traces those, producing a clean line drawing of the
whole image (house, arch, windows, sunset, waves, text). We had no equivalent.

The engine behind that mode is the **Canny edge detector** (J. Canny, 1986) — a
universal, textbook computer-vision algorithm, not the reference tool's
invention. The reference tool itself, and potrace, are **GPL**; copying either
would force LaserForge to GPL (viral copyleft) and break its salability. Canny,
the *algorithm*, is not copyrightable.

**Decision.**

1. **Add an "Edge Detection" trace mode** (`traceMode: 'edge'`) on a **clean-room**
   Canny detector built from the standard algorithm — grayscale → Gaussian blur →
   Sobel gradient → non-maximum suppression → double-threshold hysteresis — pure
   core, deterministic, no GPL/third-party code. Modules: `canny-gradient.ts`
   (gradient) + `canny-edges.ts` (NMS + hysteresis) → a 1px binary edge map.
   **[LANDED]**
2. **Trace the edge map as single strokes, not outlines.** Feed the 1px edge map
   to the **reworked centerline extraction** (ADR-058 divide-and-conquer) so each
   edge becomes ONE polyline, not a doubled potrace loop. Single-stroke output is
   the correct laser semantics (each line engraved once, no double-cut) and is
   why this mode depends on the ADR-058 extraction. **[LANDED]**
3. **Expose it as an "Edge Detection" preset** alongside the others. The Smooth
   preset and all `filled-contours` behaviour are untouched. **[LANDED]**

**Consequences.** Full-colour art traces into clean line-art usable for engraving,
closing the gap with the reference tool's edge mode — with no GPL exposure, so a
license scan stays clean and salability is preserved. The mode reuses both the
new Canny and the ADR-058 extraction (hence it branches off
`feat/centerline-rework`). Verified at the engine level on the real logo: the
rendered edge map matches the reference edge-detection preview. References
ADR-058 (centerline extraction), ADR-025 (perceptual harness), ADR-026/027
(trace overlay / divergence).

---

## ADR-092 — Connect-time Device Setup wizard (manual, draft-commit, guarded firmware sync)

**Status:** Accepted; shipped (`src/ui/laser/device-setup/DeviceSetupWizard.tsx` + tests; field-editor extraction `DeviceProfileFields.tsx`). | **Date:** 2026-06-24

> Numbering note: the body's previous highest is ADR-057. The active build plan
> (`.claude/plans/plan-a-full-build-sparkling-kazoo.md`) reserves ADR-054..091 for its
> tickets, so this independent, maintainer-requested feature takes the next free number
> above that range (ADR-092) to avoid colliding with a build-plan ticket. (The build
> plan's table also lists 057 = Offset fill, but 057 was already written here as the
> Registration Box — a pre-existing build-plan numbering drift, not introduced by this ADR.)

### Context

Getting a freshly connected GRBL machine ready to cut means setting bed size, origin corner,
power scale ($30), laser mode ($32), homing, and air-assist wiring correctly. Today those
fields are scattered across the inline Device Profile panel (`DeviceSettings.tsx`) and the
seven-tab Machine Setup dialog (`MachineSetupDialog.tsx`); a new operator has to know which
tab each field lives in. LightBurn solves first-run with its "Find My Laser" wizard.

The key realization: we already have most of the data such a wizard asks for. On connect the
handshake queries `$$` and `core/controllers/grbl/parse-settings.ts` parses bed ($130/$131),
power ($30/$31), laser mode ($32), feed ($110/$111), accel ($120/$121), junction ($11), and Z
($132) into a `Partial<DeviceProfile>`, plus a `ControllerSettingsSnapshot` of homing/limit
hints. The audit (`AUDIT-2026-06-10.md`, P1 item #11) frames the opportunity: "your laser
told us its settings" beats every competitor's brand-locked detection. The gap is
presentation and guidance, not detection.

### Decision

Add a **Device Setup wizard**: a multi-step `Dialog` launched from a manual "Set up device"
button in the Laser rail. It reads what `$$` already reported, asks the operator only for what
`$$` cannot report (origin corner, air-assist wiring, Z presence, autofocus, machine name),
optionally writes corrected values back to the controller, and ends with a "ready to cut"
checklist. Three maintainer-chosen decisions fix its shape:

1. **Manual trigger, not auto-open.** The wizard never opens on its own; the operator clicks a
   button. This sidesteps WORKFLOW.md F-A1 ("no welcome/onboarding modal on first run")
   entirely — F-A1 governs app launch over an empty workspace, and a manually-invoked,
   connect-time editor is neither a launch event nor automatic. It realizes the F-A1 promise
   that "the user can override [the default profile] in Settings → Device Profile (Phase C)".

2. **Multi-step wizard with Back/Next** (Connect & read → Identify machine → Confirm detected
   settings → Placement & safety → Sync to controller → Review & finish), modeled on
   LightBurn's Find My Laser.

3. **Draft-and-commit for the profile; guarded in-step writes for firmware.** The operator
   edits a draft `DeviceProfile` seeded from `project.device` + `detectedSettings`; the profile
   commits only on Finish (via `replaceDeviceProfile`), so Cancel is clean and the project undo
   stack isn't spammed per keystroke. Firmware writes are the exception — an EEPROM write can't
   be drafted — so the Sync step writes through the existing guarded `writeGrblSetting` action
   (which already requires connected + Idle + a prior `$$` read, validates the value, writes
   `$id=value`, then re-reads `$$` and verifies the echo). It inherits that action's
   `COMMON_WRITE_IDS` allowlist ($30/$31/$32); bed-size writes, if wanted, go through the
   existing batch `configureGrblLaserSetup` path.

The wizard is **composition, not new plumbing**: it reuses the `$$` detection pipeline
(`detectedSettings`/`controllerSettings`, `describePatch`/`describeReviewItems`), the profile
catalog (`core/devices/profile-catalog.ts`), the guarded write path, and the field editors
extracted to `DeviceProfileFields.tsx`. Pure logic (step reducer, readiness checklist, firmware
diff) lives in its own unit-tested modules under `src/ui/laser/device-setup/`.

### Consequences

- First-connect setup becomes near-zero-input on machines that answer `$$`: the operator
  confirms a prefilled draft rather than typing values. This is the audit's beats-LightBurn
  angle, made real with code we already had.
- Two profile-editing surfaces now coexist: the inline `DeviceSettings` panel (live-write) and
  the wizard (draft-commit). Acceptable for now; folding the panel into the wizard is a later
  roadmap question, not this work.
- The wizard can change the operator's machine (firmware writes). That power is fenced by the
  existing guard + an explicit per-setting confirm; the default path only updates the local
  profile.
- Delivered as a sequence of small PRs (tidy-first field extraction → this ADR + WORKFLOW →
  pure logic → profile-only wizard → firmware step → brand presets) so each diff is reviewable
  and the side-effecting firmware step ships isolated.

### Alternatives rejected

- **Auto-open on connect:** rejected by the maintainer — even gated on "unconfirmed," an
  automatic modal risks the nag that F-A1 exists to prevent. Manual keeps the operator in
  control.
- **Single consolidated scroll page (no steps):** rejected — the maintainer chose a guided
  wizard; steps hand-hold a first-run operator through safety-critical fields one decision at a
  time.
- **Local-profile-only (no firmware writes):** rejected — the maintainer wants the wizard to be
  able to correct the controller, not just tell the app about it; the existing guarded write
  path makes this safe to include.
- **A LightBurn-style fully-manual work-area wizard:** rejected — it ignores the `$$` data we
  already have; prefilling from the controller is the differentiator.
- **New store slice for wizard state:** rejected for v1 — open/close is a `useState` in
  LaserWindow (mirrors `machineSetupOpen`); step/draft is a local `useReducer` over a pure
  reducer, so no global state and the transition logic stays unit-testable.

### Verification

- **Pure unit tests** for the step reducer (next/back/edit-merge/apply-preset/can-advance/
  `assertNever` exhaustiveness), the readiness checklist, and the firmware diff (writable vs
  info-only).
- **Component tests** (following `MachineSetupDialog.test.tsx` / `DetectedSettingsBanner.test.ts`):
  steps render; seeding `useLaserStore.detectedSettings` shows confirm rows; a preset edits the
  draft, not the live store, until Finish; Finish commits via `replaceDeviceProfile`; the
  firmware step calls `writeGrblSetting` only when the guard passes.
- **NOT covered by tests (must be hardware-verified before "done"):** that the wizard reads
  `$$` correctly on a real GRBL connect (2 s handshake), that writing $30/$32 to a real
  controller verifies, and that the chosen origin corner flips Y correctly in emitted G-code.
  Per CLAUDE.md these stay explicitly unverified until a maintainer hardware pass.

---

## ADR-093 — In-app multi-library Material Library UI: create/edit wizard, Saved Libraries browser, auto-save

**Status:** Accepted; staged in small PRs. | **Date:** 2026-06-26

> Numbering note: ADR-092 is the previous highest. The active build plan reserves
> ADR-054..091 for its tickets, so this independent, maintainer-requested feature takes the
> next free number above that range (ADR-093).

### Context

ADR-044/045 landed the calibration generators, the pure `MaterialRecipe` model, and the native
`.lfml.json` IO, then deliberately stopped short of a full Material Library UI. A minimal UI was
since wired into the Cuts/Layers rail (`MaterialLibraryPanel.tsx`, WORKFLOW F-ML1), but the
maintainer reports it is confusing, and the code confirms three concrete problems:

1. **Creation is inverted.** The only authoring path is "Create from Layer"
   (`createMaterialPresetFromLayer`): the operator must import a design, pick a layer, edit that
   layer's cut settings elsewhere, then snapshot it into a preset. The natural mental model is the
   reverse — create a material, name it, then type its power/speed/passes directly.
2. **File-system wording.** `Load... / Save... / Unload` and `Assign` are jargon; the layer-target
   dropdown shows a raw hex color; preset labels are verbose.
3. **No library browser.** Exactly one library exists in memory at a time, persisted to a single
   `localStorage` slot (`laserforge.material-library.v1`) plus a manual `.lfml.json` picker. There
   is no way to keep or switch between several libraries.

The 2026-06-05 research (`audit/reports/lightburn-material-library-research-2026-06-05.md`)
established LightBurn semantics (group by Material → Thickness/No-Thickness → Description; Assign
copies a recipe onto the active layer) and recommended native deterministic storage. This ADR
keeps those semantics and the existing recipe/IO/apply pipeline; it redesigns only the UX shell,
the authoring flow, and the storage breadth.

### Decision

Build the Material Library UI as **composition over the existing core/IO**, in two maintainer-
chosen shapes:

1. **In-app, auto-saved multi-library storage.** Replace the single-library slot with a keyed
   collection in `localStorage` (`laserforge.material-libraries.v1`): `activeLibraryId` plus a map
   of `libraryId → { payload, updatedAt }`, where `payload` is the byte-identical
   `serializeMaterialLibrary` output (stored == exported == validated on read). The legacy slot is
   migrated in once and removed. Mutating the active library auto-saves; there is no manual Save
   button. File Save/Load survive only as **Export... / Import...** for sharing.

2. **Guided multi-step create/edit wizard.** Replace the snapshot form with a `Dialog`-based
   wizard (Identity → Cut settings → Mode details → Review & Save) whose draft commits only on the
   final Save, modeled on the ADR-092 Device Setup wizard's draft-commit pattern. Settings are
   typed directly into the preset. The wizard reuses the layer cut-settings field components
   (`CutSettingsFillFields`, `CutSettingsImageFields`, `readCutSettingsPatch`) over a synthetic
   `Layer`, plus a new `PresetCommonFields` that omits the layer-session fields `visible`/`output`
   (the research doc's rule: never store session fields in a reusable preset). "New from current
   layer" remains an optional prefill, not the primary path.

3. **Saved Libraries browser.** A `Dialog` page lists every library (name, device hint, preset
   count, last updated) with Open / New / Rename / Duplicate / Delete (job-aware confirm) /
   Export / Import.

4. **Reworded rail.** `Assign` → **Apply to layer**; the layer dropdown shows the layer name +
   color swatch, not hex; `Load.../Save.../Unload` give way to **Saved Libraries...** + auto-save.

The apply pipeline is unchanged: `assignMaterialPresetToLayer` still copies the recipe onto the
layer via the scene mutation path, so Preview / Save / Frame / Start stay identical. Wizard step
state is a discriminated union with an `assertNever` default arm (CLAUDE.md state rule); pure
helpers and the persistence collection are unit-tested independently of React.

Staged as small, independently-verified PRs (CLAUDE.md collaboration rule #1): this ADR +
PROJECT/WORKFLOW docs (no code) → persistence collection + management actions → create/edit
wizard → Saved Libraries page → rail rewording → dead-code cleanup. Each diff keeps the app
working.

### Consequences

- Operators author materials the obvious way (type the numbers) and can keep per-machine or
  per-material-family libraries that survive reloads without touching files.
- This advances past ADR-045's "Full Material Library UI ... out of scope" line and the matching
  PROJECT.md scope entry; both are updated. LightBurn `.clb` compatibility, manufacturer profiles,
  and linked presets ("Link", ADR-045's deferral) remain out of scope.
- The new wizard fields and the layer Cut Settings dialog now share field components; a change to a
  field control affects both surfaces. Acceptable and intended (single source of truth for recipe
  inputs).
- Storage breadth grows (N libraries vs 1). Quota failure keeps the existing single-warning,
  edit-continues posture; a corrupt collection slot is discarded silently.
- The legacy "Create from Layer" form, the "Update from layer" button, and the
  calibration-from-test-swatch create path are removed (maintainer decision, Phase 5): the
  wizard is the sole authoring path. The Material/Interval Test generators and the
  recipe/IO model are unchanged; turning a selected test swatch into a calibrated preset can
  be reintroduced later through the wizard if wanted.

### Alternatives rejected

- **File-based libraries (each a `.lfml.json` the operator manages):** rejected by the maintainer
  in favor of in-app auto-save; files remain available as Export/Import for sharing.
- **Single guided form instead of a wizard:** rejected — the maintainer chose step-by-step; the
  wizard hand-holds identity → settings → details → review.
- **Keep "Create from Layer" as the primary authoring path:** rejected — it is the reported
  confusion; demoted to an optional prefill.
- **Hidden auto-applied per-user library (no browser):** rejected — the operator explicitly wants
  to see and switch libraries.
- **New Zustand slice for wizard state:** not needed — open/close is local `useState`, step/draft
  is a local `useReducer` over a pure reducer (mirrors ADR-092), so transition logic stays
  unit-testable with no global state.

### Verification

- **Pure/unit tests:** the persistence collection (round-trip, migration from the legacy slot,
  corrupt-slot discard, quota failure returns false), the management actions (list/open/create/
  rename/duplicate/delete), the wizard step reducer (next/back/edit-merge/can-advance/
  `assertNever`), and `upsertMaterialPreset` (add vs replace; recipe normalization).
- **Component tests:** wizard validation gating and draft-commit-on-Save; Saved Libraries Open
  sets active; Apply-to-layer copies the recipe; Export/Import reuse the IO error paths.
- **Output parity (perceptual, CLAUDE.md #2):** applying a preset must change emitted feed/power
  (Line), hatch spacing (Fill), and lines-per-mm (Image) through the existing prepared-output
  pipeline — checked in Preview / Save G-code, not just by green structural tests.
- **NOT covered (must be hardware-verified before "done"):** that the chosen settings actually
  burn correctly on real material. Per CLAUDE.md this stays explicitly unverified until a
  maintainer hardware pass.

---

## ADR-060 — Offline-first PWA: installable service worker + safe update model

**Date:** 2026-06-26
**Status:** Accepted. Slices 1–3 landed on `feat/offline-pwa` (app-shell precache,
safe update prompt, connection badge + Install button). Hardware verification
(Web Serial driving the laser with the network down) is the standing gap.
Service-worker registration is **web-only**: on the desktop shell (the `app://`
scheme, where Chromium refuses SW) the update watcher is gated off at its mount
(`PwaUpdateWatcherGate` since ADR-227; formerly `PwaUpdatePromptGate`, ELE-06), so
the desktop auto-update path (ADR-024) is the
single updater and no cached precache can mask its on-disk swap.

**Context.** PROJECT.md already mandates this — the web app is "PWA-installable"
(line 35) and "The app must work fully offline. No analytics, no error reporting
service, no cloud sync" (line 211). It was simply unbuilt. The app was already
~90% offline: machine control is local USB via `navigator.serial`
(`platform/web/web-serial.ts`) — zero internet, a dropped Wi-Fi mid-burn is a
non-event; compute is pure client-side (`core/` is network-free by rule) on a
static deploy; and work persists via `autosave.ts` (localStorage). The only gap
was a service worker to cache the app shell so a fresh load works offline.

Researched distinctiveness: Kiri:Moto is an offline CAM PWA but has no machine
control; CNCjs / LaserWeb need a Node server; Easel is cloud-only; LightBurn is
desktop. A single installable, offline, no-server browser app doing full CAM +
direct Web Serial control is a genuine gap.

**Decision.**

1. **vite-plugin-pwa + Workbox `generateSW`** precaches the app shell (incl. the
   trace worker and all chunks; `maximumFileSizeToCacheInBytes` raised) so the app
   loads and runs offline after the first online load. Web-only — Electron is
   already offline natively and a SW is a no-op over `file://`.
2. **`registerType: 'prompt'` — never auto-update.** An auto-reload could abort a
   live burn. A new SW enters `waiting` (no `skipWaiting`); `PwaUpdatePrompt` shows
   a Reload banner that is **suppressed while the laser is streaming** (mirrors the
   autosave streaming guard). The update applies on the user's Reload, or
   automatically once all tabs close. (Corrected 2026-07-04: an already-`waiting`
   SW **is** re-surfaced on every load — workbox-window 7.4.1's `register()`
   re-fires `waiting` with `wasWaitingBeforeRegister` whenever a matching SW is
   already waiting. The original claim here was wrong, and a bare `setNeedRefresh(false)`
   "Later" therefore re-nagged on every reload. Fix: `PwaUpdatePrompt` persists a
   per-build "Later" dismissal keyed to `__APP_VERSION__` (`pwa-update-dismissal.ts`)
   and clears it on the next `updatefound`, so the same waiting update stays quiet
   while a strictly-newer SW still prompts; it still activates on full close.)
   (Corrected 2026-07-17: on a page that loads WITHOUT a controller — hard
   reload, first visit after clearing site data, DevTools network bypass — a
   freshly installed SW skips `waiting` and activates silently, and the
   plugin reloads only on a `controlling` event such pages never get, so the
   banner's Reload was a silent no-op there: SKIP_WAITING posted to an empty
   waiting slot, no reload, banner left standing. `pwa-prompted-reload.ts`
   now guarantees the clicked Reload always reloads — via `statechange` once
   the skip-waited worker activates, or a plain reload when nothing is
   actually waiting.) (Amended 2026-07-17 by ADR-227: the Reload/Later
   banner is gone - update readiness now surfaces as a passive status-bar
   Update button (`PwaUpdateWatcher` publishes to `pwa-update-store`,
   `PwaUpdateButton` renders it), the "Later" dismissal persistence and its
   `updatefound` re-arm are removed, and the click path through
   `pwa-prompted-reload.ts` is unchanged.)
3. **`injectRegister: false`; register via the `virtual:pwa-register/react`
   hook.** A bundled hook is same-origin, satisfying the strict CSP
   (`script-src 'self'`, `public/_headers`) where the inline registration form is
   blocked. `workbox-window` is a dev dep so the hook resolves in the Rollup build.
4. **Relative `base: './'` verified to register the SW at root scope** on the web
   deploy (no `base: '/'` fallback needed). Web Serial is available offline
   (top-level docs default to `serial=self`; `_headers` sets it explicitly) —
   verified live.
5. **Installable + legible:** a manifest (icon from `favicon.svg`), a
   `ConnectionBadge` (shows "Offline" only when disconnected), and an explicit
   `InstallButton` (captures `beforeinstallprompt`).

**Consequences.** Closes the PROJECT.md offline + PWA-installable mandate and
realizes the differentiator. License stays clean (Workbox / vite-plugin-pwa are
MIT — ADR-008). The headline claim — Web Serial driving the machine with no
internet — is software-confirmed (the API is local) but **not yet
hardware-verified** (the standing gap). References PROJECT.md offline mandate,
ADR-003 (web + desktop from one codebase), ADR-008 (MIT / license discipline),
ADR-009 (Vite stack), ADR-047 (design tokens).

---

## ADR-094 — Phase H multi-controller architecture: ControllerDriver seam + capability-gated UI

**Status:** Accepted; shipped (Phase H build, branch `claude/angry-mcnulty-bc6bfe`). | **Date:** 2026-07-02

**Context.** ADR-006 shipped GRBL v1.1 only and promised an extensible strategy for
future controllers. The maintainer directed Phase H: support grblHAL, FluidNC,
Marlin, Smoothieware, and Ruida. The store layer hardcoded GRBL bytes ($J=, $X,
!, ~, ?, Ctrl-X) across nine ui/state files; only the G-code emitter was abstract.

**Decision.**

1. **ControllerDriver seam** (`src/core/controllers/`): per-firmware pure object —
   command vocabulary, realtime bytes (nullable), line classifier into a shared
   `ControllerEvent` union (superset: adds `busy`/`resend`), console rules, jog/frame
   builders, default baud. `selectControllerDriver(kind)` resolves from the profile's
   `controllerKind`; the driver lives in the store's non-serializable refs.
2. **Capability gating, never kind-checking, in ui/**: a declarative
   `ControllerCapabilities` snapshot in LaserState (transport, jog, realtimePause,
   statusQuery, settings, unlock, sleep, wcs, homing, console, firmwareSetupPanel).
   `kind === 'grbl'` in ui/ is the same anti-pattern class as platform conditionals.
3. **Byte-identical proof for the refactor**: firmware simulators
   (`src/__fixtures__/controllers/`) + store-level lifecycle integration tests landed
   BEFORE the seam; the refactor kept G-code snapshots and sim transcripts identical.
4. **Detection is advisory**: welcome banners (and unknown lines) run through a
   detection registry; a mismatch with the selected profile logs a warning, never
   silently switches drivers.
5. `.lf2`/.lfmachine round-trip `controllerKind` + optional `baudRate`; unknown
   values are dropped to the GRBL default at the deserialize boundary
   (`isKnownControllerKind` is the single source of truth).
6. **Console commands declare their state effect at the driver seam.** Read-only
   queries preserve evidence; machine/modal commands require a fresh status;
   XY, Z/tool, full-coordinate, reference, and configuration mutations
   invalidate only the setup authority they can make stale. The invalidation
   happens after a successful serial write, never from the operator's text
   alone, and a write is not promoted to physical-completion evidence.

**Consequences.** grblHAL/FluidNC land as capability deltas on the GRBL driver
(FluidNC: settings read-only, no $-writes). One family per sub-phase (keeps
ADR-006's discipline). Supersedes ADR-006's GRBL-only scope; everything else in
ADR-006 stands. grblHAL is hardware-verifiable on the Falcon A1 Pro; FluidNC is
simulator-verified only.

---

## ADR-095 — Marlin controller support (queued status, stream-side pause, inline/fan dialects)

**Status:** Accepted; shipped, simulator-verified only. | **Date:** 2026-07-02

**Context.** Marlin has NO realtime bytes: no `?` report, no `!`/`~`, no soft-reset
char, no `$` vocabulary, text errors, `ok`-per-line acks, `echo:busy` keepalives.
Laser wiring is fragmented: LASER_FEATURE builds take M3/M4/M5 + per-move S
(0–255); fan-mosfet rigs only know M106 Sn/M107.

**Decision.** Status = queued `M114` (synthesized Idle report), polled ONLY while
no stream acks are outstanding and no controller command is pending — a queued
query consumes planner space and emits its own `ok`, so polling mid-stream would
desync the character accounting. Pause = stream-side (stop sending; buffered
motion drains; UI copy says so). Stop = stop sending + `M5`/`M107` beam-off lines.
Jog = `G91`/`G0`/`G90`; frame = absolute `G0` legs; home = `G28 X Y` (never bare
G28 — Z would crash a laser rig); settle marker = `M400`. Two output dialects:
`marlin-inline` (GRBL wire shape at S 0–255) and `marlin-fan` (per-move S →
`M106/M107` between moves; the laser-off-on-travel checker treats `M107` as
beam-off). Checksum `Resend:` is a terminal stream error (no line-number replay
in v1). Start readiness passes with an explicit power-scale-unverified warning
instead of demanding $30/$32 proof.

**Consequences.** Ping-pong streaming only (profile default). Raster in fan mode
is slow/coarse by physics — documented, not hidden. NOT hardware-verified; the
catalog profile carries `unverified` evidence saying exactly that.

---

## ADR-096 — Smoothieware controller support (fractional S power scale)

**Status:** Accepted; shipped, simulator-verified only. | **Date:** 2026-07-02

**Context.** Smoothie speaks GRBL-flavored realtime (`?` status, `!`/`~`, Ctrl-X)
but has no `$J`/`$$`/`$X`/`$SLP`; halt recovery is `M999`; homing is `G28.2`; and
the laser module's S scale defaults to **0–1.0** — the GRBL emitter's integer
rounding would collapse every power to 0 or 1.

**Decision.** Reuse the GRBL status-parser and realtime bytes; jog/frame like
Marlin (G91/G0/G90); `!!`/text errors classify as terminal stream errors (halt
state arrives via status reports; there are no numeric alarm codes).
`smoothiewareStrategy` emits against a virtual S-1000 scale and rescales every S
word to the profile maximum (S0.500 at max 1.0; integers at large scales) —
non-negotiables #3/#5/#7 property-tested at fractional scale. Realtime pause is
allowed WITHOUT the $32 proof on firmwares that cannot report $-settings
(Smoothie's laser module ties beam power to motion); grbl-dollar firmwares keep
the strict gate. `config-set`/`config-load` are blocked in console and payloads.

**Consequences.** NOT hardware-verified (catalog evidence says so). `maxPowerS`
may now be fractional; consumers were audited for integer assumptions.

---

## ADR-097 — Ruida: experimental .rd export, file-only transport

**Status:** Accepted; shipped as EXPERIMENTAL (file export only), NOT accepted by real hardware yet. | **Date:** 2026-07-02

**Context.** Ruida DSP controllers (RDC644x class, most Chinese CO2 lasers) speak
a proprietary swizzled binary protocol over USB/UDP — no serial G-code link
exists. Byte meanings come from public reverse-engineering (MeerK40t, EduTech
wiki); LaserForge reimplements clean-room (ADR-017 discipline, no code copied).

**Decision.**

1. `core/controllers/ruida/`: swizzle (round-trip property-tested), 35-bit
   coordinate / 14-bit power encodings, a minimal command vocabulary, and a
   deterministic `.rd` encoder that REFUSES raster groups rather than guessing.
2. **Verification is round-trip, honestly labeled**: a decoder test-instrument
   proves encode→decode fidelity (geometry, power, speed, passes, layers) —
   internal consistency, NOT real-device acceptance. Every save shows an
   EXPERIMENTAL toast; the catalog evidence repeats it.
3. **Transport `file-only`**: a new capability disables Connect and all live
   controls for Ruida profiles; Save G-code routes to `io/rd` → `.rd` (Blob).
4. A pure UDP session state machine (checksum datagram framing, ACK advance,
   ERR retry budget, port 50200) is implemented and sim-tested as groundwork.
   The Electron UDP socket + IPC bridge is deliberately NOT built: streaming
   never-hardware-validated bytes to a live CO2 laser fails the Phase H honesty
   rules. Profiles stay file-only until a real controller accepts the output.

**Consequences.** Ruida users get preview/estimate/export today with explicit
warnings. Next steps (in order): validate a generated `.rd` against a real
controller or reference files, then wire the UDP transport.

**Limitation — layer Min/Max power collapsed to one value (recorded 2026-07-10, CTL-04 part 2).**
LightBurn exposes two separate per-layer power values on a Ruida layer, Min Power
and Max Power. Our `Job` cut-groups carry a single `power`, and the encoder writes
that one value into BOTH the `layerMinPower` (0xC6 0x31) and `layerMaxPower`
(0xC6 0x32) commands (`core/controllers/ruida/rd-encoder.ts:68-69`) — we always
emit Min == Max. Decision (CTL-04): record this as a deliberate current limitation
(option a) and DEFER plumbing a separate min power (option b), because a true split
is a cross-cutting change to the core `Job` cut-group model (a second power field
threaded through to the encoder) and — with no reference `.rd` from real hardware or
LightBurn — there is no byte snapshot that would catch a regression in the emitted
bytes. We record the divergence from LightBurn's separate Min/Max now; we do NOT
assert what a Ruida controller does with Min == Max, as that is unverified.

---

## ADR-100 — Trace quality rebuild: medial-axis Centerline, chained Edge Detection, true Sharp params

**Date.** 2026-07-03. **Status.** Accepted (replaces the Centerline
implementation; amends ADR-059 Edge Detection).

**Context.** The perceptual IoU/structure suite was green while traced art
looked wrong (the Karpathy failure mode). A visual audit harness
(`src/__fixtures__/perceptual/_trace-audit-render.test.ts`, `TRACE_AUDIT=1`)
exposed: Centerline vanished whole strokes, retracted tips, tangled
junctions, and chamfered every drawn corner; Edge Detection outlined its 1-px
Canny mask with the filled-contour backend, doubling every line (the preset
was hidden from the UI for exactly that reason); Sharp reached the potrace
backend with Smooth's curve params (its imagetracerjs-era fields are inert
there), so small features traced as blobs.

**Decision.**

1. **Centerline** is rebuilt from scratch in `src/core/trace/centerline/`:
   exact squared EDT (Felzenszwalb–Huttenlocher) → distance-ordered homotopic
   thinning with an exact (8,4) simple-point LUT, phase 1 anchored on centres
   of maximal discs, phase 2 plateau reduction with a more-neighbours-first
   tie-break (even-width ribbons cannot unzip tip-first) → junction-cluster
   stroke graph → pinched-tip spur pruning (tip radius ≤ 1.6 px AND
   protrusion beyond the trunk under budget; a component's last chain is
   never pruned) → assembly: straightest-continuation junction pairing,
   tangent-anchored ridge-walk tip extension to the ink cap apex, T-junction
   seam repair (the medial axis genuinely dents toward every branch — seams
   are stitched straight and branch ends welded back on), windowed corner
   sharpening (chamfers and round-nib joins rebuild their vertex; fillets
   of roughly 2 stroke radii and up stay round), Douglas-Peucker.
2. **Edge Detection** keeps Canny but with interpolating non-max suppression
   (bilinear along the true gradient — 4-bucket NMS starved diagonal ridges)
   and feeds the edge map through the same chain machinery, emitting single
   sub-pixel polylines: open for lines, closed for loops. Sliver loops
   (area ≤ 4 px²) drop as debris. Tangent-ALIGNED continuations may
   bridge/close up to 3× the join gap (hysteresis dropouts exceed the knob;
   perpendicular welds stay capped). Preset minimum line is now chain length
   (12 px), not two-sided contour perimeter (24 px). The preset is back in
   the UI dropdown.
3. **Sharp** sets the potrace params that actually apply: smoothness 0.55,
   optimize 0.15 — corners stay vertices, genuine large arcs still curve.
   Chosen from three rendered candidates (today-smooth / corner-faithful /
   pure-polygon) over corner, pixel-art, curve, and fine-detail fixtures
   (`_sharp-candidates.test.ts`, gated on `TRACE_AUDIT=1`).
4. **Perceptual contracts updated to the single-line reality:** coverage
   metrics sample the drawn path (not simplified vertices), closed polylines
   have endpoint gap 0, centerline tips must reach the visible ink cap apex,
   a dashed stroke traces as one closed outline per dash (LightBurn-
   consistent; the old fused blob was a dilate/erode artifact), and open
   polylines are a feature of Edge Detection, not a defect.

**Consequences.** All five presets render correctly on the audit fixtures and
the arch-house real logo (benchmark loop 10/10 across six benchmarks). Known
limitation: at very shallow crossings, chain pairing can hand the connector
to the wrong continuation — geometry stays correct, only travel-path grouping
is affected. The audit harness stays in the tree, gated on `TRACE_AUDIT=1`,
as the standing perceptual eyeball tool.

**Amendment (2026-07-03) — sub-pixel smoothing + corner loop closure.** The
maintainer's perceptual pass on the arch-house logo found Edge Detection
still lumpy on turns (raw chain vertices sit on the integer pixel lattice)
and letter outlines left open with small gaps (every closure/bridge gate
assumed tangent continuation, which a loop whose ends meet at a drawn CORNER
never satisfies). Fixes, within the same chained-edge architecture:

1. Every raw chain vertex snaps to the parabolic peak of the blurred Sobel
   magnitude along the gradient normal before smoothing (Devernay-style
   sub-pixel refinement, shift clamped to 0.6 px — never invents edges;
   `edge-subpixel.ts`, plumbed via `ChainAssemblyOptions.snapPoint`).
2. Loop closure is one shared three-tier decision
   (`centerline/loop-closure.ts`): touching ends (≤ 1.5 px), tangent-ALIGNED
   ends (≤ 3× join knob, as before), and NEW corner-meeting ends (≤ 1× knob,
   gap ≤ 15% of loop, hairpin-guarded; tangent evidence is distrusted under
   3 px where weld kinks corrupt it). Applied at assembly, again after
   welds, and after ridge reconnection. Centerline strict mode still closes
   touching ends only.
3. An open end stopping just short of its OWN chain now self-welds
   (arc-exclusion window keeps neighbouring segments out of reach), and a
   sub-minimum-length chain whose both ends land on other geometry is kept
   as a weld connector instead of being dropped (dropping it reopened the
   very gap the weld closed).
4. Output Chaikin refinement pins the bend sharpener's rebuilt vertices
   (dense-chain corner evidence) plus ≥ 60° turns, instead of every ≥ 35°
   vertex — small letter bowls now smooth while drawn corners stay exact.

Regression gates on the real fixture: `nearlyClosedOpenCount = 0` and
`langebaanExcessTurnPer100Px ≤ 12` (excess turn — back-and-forth bending
that cancels over a 6 px window; genuine corners score zero), plus a
sub-pixel disc-roundness test (radial RMS ≤ 0.12 px). Standing eyeball
harness for this fixture: `_arch-house-edge-audit.test.ts` (TRACE_AUDIT=1).

**Amendment (2026-07-03, second) — adaptive potrace corner threshold +
Smooth auto-median.** A cross-tracer audit against the official potrace
1.16 binary (run out-of-process on identical preprocessed bitmaps as a
measurement reference only) showed our potrace backend already matches the
reference 1:1 on curve fidelity (disc radial RMS 0.135 px vs reference
0.139) and corner fidelity (star apex error 1.00/2.17 px vs 0.99/2.03) —
but both melt small text at the default alphamax 1.0, because ~16 px glyphs
yield 2–4 px polygon legs whose raw corner alpha falls below the global
threshold. Two changes:

1. **Per-vertex adaptive alpha limit** (`potrace-curve.ts`): the corner
   test uses `min(alphaMax, 0.55 + 0.45·t)` where `t` ramps over the
   shorter adjacent polygon leg from 3 px to 7 px. Small features keep
   drawn corners (glyph corner count 2 → 12 on the pinned fixture); long
   legs are unchanged, so large arcs stay smooth (disc RMS byte-identical),
   and any alphaMax ≤ 0.55 (the Sharp preset) is provably unaffected.
   Result: small-text tracing now EXCEEDS reference potrace, which
   ships `mkbitmap` upscaling precisely because it melts at this scale.
2. **Smooth preset median is now `'auto'`** (`TraceOptions.medianFilter:
   boolean | 'auto'`): the impulse-noise detector moved from edge-trace to
   `preprocess.ts` (`hasImpulseNoise`, shared, behavior identical) and the
   median only runs when measured noise justifies it — the unconditional
   median was destroying clean small glyphs. The median itself was
   rewritten allocation-free (Smith median-of-9 sorting network,
   byte-identical output, property-tested against a naive reference):
   Smooth on the 1024² logo fixture went ~959 ms → ~247 ms with IoU up
   0.974 → 0.978.
3. **Auto-upscale of small thin-featured sources** (`auto-upscale.ts`,
   wired in `traceImageToColoredPaths`, opt-in flag set on all five
   presets): when the source is ≤ 1.5 M px AND its ink area/perimeter
   ratio indicates strokes under ~3 px, the image is 2× bilinear-
   supersampled before tracing and the traced vectors divided back —
   the approach potrace's own `mkbitmap` exists for. Edge Detection on
   the half-scale letter fixture went from 9 closed + 4 fragmented-open
   outlines to 15 closed / 0 open; the potrace presets gain proportional
   detail. Bold/large sources (the arch-house fixture) never trigger it,
   so all landed benchmarks are unaffected.
4. **Apex snap** (`potrace-apex.ts`): acute traced corners (turn ≥ 50°,
   local maxima) are rebuilt by intersecting the two straight flank
   lines, ink-supported and capped at 2.5 px — the rasterized ink ends
   ~2 px short of a thin analytic apex, so extrapolating the flanks is
   the only route to the true corner. Star-tip error 1.00/2.17 px →
   ~0.5/1.0 px (reference potrace: 0.99/2.03 — now beaten ~2×); square
   overshoot 0, disc unchanged.
5. **Spur-budget cap** (`spur-pruning.ts`, `MAX_SPUR_BUDGET_PX = 12`):
   the protrusion budget scaled with the JUNCTION radius uncapped, so a
   fat hub (a blob's inscribed disc) inflated the budget past real
   stroke lengths and Centerline collapsed thick shapes (12-spoke star
   → one 2-point chain). Capping at fat-stroke scale (the same 12 px
   junction-condense uses) restores all 12 spokes; corner-wedge
   artifacts (~3-6 px protrusion) still prune. Bug vs ADR-100's
   documented rule, not a redesign.
6. **Spatial-grid acceleration** (`centerline/spatial-grid.ts`): the
   ridge-reconnect arrival test and open-end weld search now query a
   uniform cell hash instead of scanning every segment (222× fewer
   candidates); candidate order is re-sorted to the original scan order
   so selection/tie-breaking is BYTE-IDENTICAL (proven by full-output
   deep-equal on three fixtures plus a permanent determinism test).
   Edge trace ~955 → ~639 ms on the 1024² fixture; the remaining floor
   is canny/median/distance-field/thinning — documented future work.

**Amendment (2026-07-03, third) — closed rings must return to their start
point.** The maintainer's live-app trace of the ARCH "A" showed the counter
(and other letter counters) with small seam gaps, while every offline metric
reported the counter CLOSED. Root cause: the corner/aligned closure tiers mark
a ring `closed: true` while leaving its endpoints up to a join gap (~1.5–5 px)
apart — the closing edge is left IMPLICIT. potrace and text glyphs close their
rings by making the last point coincide with the first (potrace explicitly
appends the start point); the canvas line-stroke renderer
(`strokePolylinesBatched`) and the G-code toolpath emitter both draw a closed
polyline's points AS GIVEN and never synthesise the closing edge, relying on
that convention. Edge/centerline rings violated it, so a stroked/engraved
closed loop showed — and would have CUT — a gap the size of the endpoint
separation (fill rendering hid it, which is why the perceptual IoU/coverage
metrics, which rasterize via fill, never caught it). Fix: `closeRingEndpoints`
(centerline/loop-closure.ts) appends the start point to any closed ring whose
ends are not already coincident; applied at the final output of both
`edge-trace.ts` and `trace-centerline.ts`. Verified end-to-end in the live
browser: all 41 closed rings of the arch logo now return to start
(max endpoint self-gap 0). The closure metrics were also strengthened — an
edge-trace invariant now asserts every closed ring returns to start, the class
of bug the old flag-trusting metrics missed.

**Amendment (2026-07-04) — even-curvature smoothing (edge/centerline bowls).**
The maintainer reported curved letter parts (a "B" bowl) tracing as faceted
polygonal chords. Measured against a VERIFIED reference — the real Roboto "B"
glyph outline rasterized and traced (`_letter-b-smoothness.test.ts`), scored
by facet ratio (% of 1px steps kinking ≥14°, corners excluded) — ours was
1.9% at 100px vs the official potrace binary's 0.5% on the identical bitmap.
Two experiments proved the faceting was baked into the CHAIN, not the
DP/Chaikin end-stage: disabling Douglas-Peucker still left 1.5%. Root cause:
independent per-vertex sub-pixel snapping + only two Taubin passes leave
pixel-scale curvature noise (the line does not turn evenly like a fitted
Bézier); the Chaikin output stage then froze a kink at every pinned
soft-turn vertex. Fix (both halves, `src/core/trace/centerline/`):
`chain-smoothing.ts` evens the dense chain with corner-anchored Taubin (8
passes, shrink-free λ/μ, the sharpener's corners + hard turns + endpoints
pinned) between sharpening and DP; `curve-fit.ts` replaces the Chaikin body
of `refineChainForOutput` with a centripetal Catmull-Rom resample (corners
break the spline and stay exact). DP epsilon 0.55→0.45 to give the spline
control points on tight bowls. Result: 100px facet ratio 1.9% → **0.5%
(matches the potrace reference)**, 160px 0.9% → 0.2%, 60px 4.1% → 2.6%;
deviation from the true glyph unchanged (mean ≤0.23px). Verified perceptually
on the synthetic B and the real logo's "O" (a smooth ellipse) and ARCH HOUSE
letters. Corner/apex/disc/closure/determinism gates all hold; both Edge
Detection and Centerline benefit (shared `finalizeChains`). Known residual:
60px glyphs sit at 2.6% (improved, not yet potrace parity) — a stem/arm
junction sub-pixel artifact, not bowl faceting.

**Amendment (2026-07-04, second) — apex snapping for Edge Detection.** Edge
traced sharp convex silhouette tips ~1.8-2.8px short of the true corner (star
apex 1.80/2.81), while Line Art already reconstructs them (0.66/0.96). Reused
`potrace-apex.ts` `snapCornersToInk` on Edge's closed rings, with the
outward-ink guard built from a FILLED source-luma bitmap (`edge-ink-support.ts`
- Edge's own Canny mask is a hairline and would reject every move). A
`minRingPerimeterPx` gate (250px) confines recovery to genuine large
silhouettes; small text (30-185px rings, already well-localised by Canny+ridge)
is left untouched so its crowded corners do not re-facet. potrace's own apex
behavior is byte-identical (the gate defaults to 0). Result: Edge star apex
1.80/2.81 -> 0.96/1.54 (beats the potrace 1.16 binary 0.99/2.03); disc RMS
0.035 and B-bowl facet 0.2% unchanged (no collateral); verified sharp by eye.
Edge Detection now sits at or above the potrace reference on every axis it
shares - curves (best of all presets), corners, bowls, and ring closure.

**Direct 1:1 verification.** `_reference-iou.test.ts` rasterizes OUR
Line-Art output and the reference potrace 1.16 output on the identical
bitmap (disc + star, where auto-upscale does not fire) and measures area
overlap: **disc IoU 0.9989, star IoU 0.9983** (≈ 99.9 % pixel-for-pixel
agreement at 4× supersample; 189/518400 and 312/640000 mismatched
sub-pixels). Recall 0.9996–0.9999 (we cover essentially all reference
ink); the sub-0.2 % residual is precision — the sharper apex tips we
push past potrace's blunted corners — i.e. where we exceed the reference,
not miss it. This is the measured "1:1 match against a reference": the
two vectorizations are indistinguishable except where ours is better.

---

## ADR-024 — Windows desktop distribution + auto-update mechanism

**Status:** Accepted | **Date:** 2026-07-04

### Context

The Electron desktop shell has existed and been CI-typechecked since Phase A
(`electron/main.ts`, `electron-builder.yml`, `pnpm build:desktop`), but it was
never packaged into a distributable installer, never hosted for download, and
had no update path (`publish: null`). This ADR was reserved from the start
("before first signed release") and is written now to launch **KerfDesk as a
downloadable Windows installer alongside the online web app**.

Three constraints shaped it:
- **Non-negotiable #8** — "No telemetry, no network calls — local-first. Ever."
  An auto-updater necessarily makes a network call.
- **Security posture** — "No auto-update from arbitrary URLs," plus the
  deliberate no-preload / no-`ipcMain` hardening of the Electron shell.
- **Non-negotiable #9 / burn-safety** — an update must never interrupt a job.

The maintainer chose **full auto-update** (over notify-only) for the desktop app.

### Decision

1. **Distribution.** electron-builder produces an **NSIS x64 installer**
   (unchanged target; per-user `perMachine:false`, assisted `oneClick:false`),
   built in CI on annotated **SemVer tags `vX.Y.Z`** (not per-commit). The tag
   drives the artifact version via `-c.extraMetadata.version=$VERSION` so the
   installer, `app.getVersion()`, and the update feed agree. Hosted on
   **Cloudflare R2** (bucket `kerfdesk-downloads`, served at
   `https://dl.kerfdesk.com/desktop/`), linked from `https://kerfdesk.com/download`.
   **Not GitHub Releases** — the repo is private (ADR-018); public asset URLs
   would need a separate public repo or tokens. **Not** bundled into the Pages
   deploy — keeps the web deploy small and decoupled.

2. **Auto-update = `electron-updater`, main-process, self-hosted.**
   `electron-builder.yml` `publish: { provider: generic, url:
   https://dl.kerfdesk.com/desktop }` makes the build emit `latest.yml` +
   `.blockmap`. In `electron/main.ts` (packaged only, `app.isPackaged`):
   `autoDownload = true`, `autoInstallOnAppQuit = true`, then
   `checkForUpdatesAndNotify()` — a background check + OS-native "update ready"
   notification that installs on the next natural quit. The check runs in the
   **main process** (Node `net`), so the locked renderer CSP is unchanged and no
   renderer update-UI is required.

3. **Burn-safety (non-negotiable #9).** The app **never** calls
   `autoUpdater.quitAndInstall()`. Updates apply only on a user-initiated quit,
   which cannot happen mid-burn without the operator stopping/closing the app
   (existing `src/ui/app/use-unload-stop.ts` soft-resets the machine on unload).
   No mid-stream interruption is possible.

4. **This revises non-negotiable #8's "no network calls."** #8 is amended (this
   ADR) to permit exactly one call: the desktop updater's check/download against
   our **own pinned `kerfdesk.com`-family origin**. It transmits **no user data
   and no telemetry** and is user-disablable; the web app and every CAM/streaming
   path stay fully offline. The separate posture "no auto-update from
   **arbitrary** URLs" is **honored** — the feed URL is pinned at build time.

5. **Code signing deferred.** v1 ships **unsigned**: the `/download` page
   documents the Windows SmartScreen "unknown publisher" step. Auto-update still
   functions unsigned, and per-user install-on-quit largely avoids UAC. Signing
   (Azure Trusted Signing ~$10/mo, or an OV/EV cert) slots into the release
   workflow later behind env-var/secret gating with no code rework; once signed,
   `electron-updater` verifies the publisher signature, hardening the channel.

6. **Dependency.** `electron-updater` (MIT, electron-builder ecosystem) is added
   to `dependencies` (it is `require`d by the packaged main process).
   RESEARCH_LOG.md entry per ADR-017.

### Consequences

- KerfDesk launches as a real downloadable Windows app that keeps itself current
  while the web app is unchanged.
- The strict "local-first, no network, ever" posture gains one narrow,
  self-hosted, no-user-data exception, recorded here and in PROJECT.md #8.
- The no-preload/no-IPC shell is preserved: `checkForUpdatesAndNotify` + OS
  notification needs no IPC. An **in-app** "restart to update" banner would need
  a hardened `contextBridge` and its own ADR — deferred.
- Green tests never prove the installer runs (CLAUDE.md): a workflow-shape test +
  an auto-update-config unit test guard structure, but install / serial / update
  behavior is verified manually on Windows 10 and 11 (WORKFLOW.md desktop flow,
  AUDIT.md CLAIMED row) before the launch is called done.

### References
ADR-007 (Windows-only desktop), ADR-011 (platform adapter), ADR-018 (private
repo → not GitHub Releases), ADR-060 (offline-PWA update model this mirrors),
ADR-017 (dependency policy), PROJECT.md non-negotiables #8 / #9.

---

## Future ADRs (anticipated, not yet written)

**Numbering.** The contiguous body runs ADR-001..057 (ADR-057 = Registration Box).
The active build plan (`.claude/plans/plan-a-full-build-sparkling-kazoo.md`) reserves
ADR-054..091 for its tickets — note its allocation table lists 057 as "Offset fill,"
which collides with the already-written Registration Box, so that table needs
reconciling before those tickets land. Independent (non-build-plan) ADRs should take
the next free number **above** the reserved range (ADR-092 and up); ADR-092 (Device
Setup wizard) is the first.

- ADR-023 — Web-app deployment target (covered ad-hoc in the current
  Cloudflare Pages setup commits; promote to formal ADR if the deploy
  config grows further).
- ADR-024 — Update mechanism for Windows desktop. **Written (Accepted
  2026-07-04) — see the ADR-024 section above.** Full auto-update via a
  self-hosted `electron-updater` feed on Cloudflare R2; v1 ships unsigned.
- (Earlier reservations for ADR-019..023 were stale — Phase B / E
  shipped without formal ADRs at those slots. ADR-019 / ADR-020 /
  ADR-021 are the first three slots since reused.)

## ADR-098 — CNC router mode becomes a first-class product track (Phase H "Router")

**Status:** Amended by ADR-209
**Date:** 2026-07-02

### Context

Commit `032d476` landed an experimental CNC router mode: a `MachineConfig`
discriminated union on `Project`, per-layer `CncLayerSettings`, a pure
`compileCncJob` pipeline (profile / pocket / engrave with depth passes and
tabs), a spindle/Z-aware `cncGrblStrategy` emitter, CNC preflight, and UI
wiring. The independent parity audit
(`audit/reports/cnc-easel-parity-audit-2026-07-02.md`) verified it is a real
CNC MVP — not renamed laser UI — but landed without a scope-gating ADR, and
PROJECT.md remained laser-only with DXF import explicitly out of scope.

The maintainer has decided to build this into LaserForge's own full
professional CNC/router mode — not a thin Easel clone — including true
V-carving, toolpath simulation, DXF / STL / G-code import, 3D relief carving
(first-class from the start), tool + feeds/speeds libraries, multi-tool jobs,
motion polish (ramps, climb/conventional, leads, parking), and tiling.

### Decision

1. CNC router mode is adopted into the canon roadmap as **Phase H ("Router",
   v0.8)**, sub-phased H.0–H.10. The previously anticipated phases renumber:
   Marlin et al output strategies H→I, macOS/Linux desktop I→J (precedent:
   ADR-051 renumbered Marlin G→H when drawing tools took Phase G).
2. **All parsers are clean-room.** DXF, STL, and G-code (.nc) parsers are
   hand-written in `src/io/` — no parser libraries. clipper2-ts (already
   adopted) remains the only geometry dependency; no new runtime dependencies
   are planned for Phase H.
3. **Hardware verification targets the 4040 machine.** Every output-affecting
   sub-phase ends with an air-cut checklist executed by the maintainer;
   AUDIT.md rows stay CLAIMED until that evidence exists.
4. The laser non-negotiables extend to CNC with analogs: bounds check, origin
   honesty, no partial output, deterministic G-code (snapshot + fuzz), units
   honest, pure core — plus the CNC-specific **no XY rapid below safe Z**
   invariant (`findPlungedTravelIssues`, shipped). The former universal
   stock-bottom depth cap is superseded by ADR-209.

#### Standing 4040 air-cut protocol (referenced by every sub-phase)

Home → clamp scrap / set work XY zero → set Z zero ~30 mm above the
spoilboard (air gap) → feed override 50% → run the job end-to-end → verify:
retract before every travel, pass ordering (pockets/engraves before profiles,
inner before outer), spindle spin-up dwell before first plunge, correct park.
Log the result in AUDIT.md; only then may a row flip CLAIMED → VERIFIED.

### Alternatives considered

- **Thin Easel-parity clone.** Rejected — the maintainer wants LaserForge's
  own professional CNC surface; Easel is a reference point, not the spec.
- **Parser libraries for DXF/STL (`dxf-parser`, MIT etc.).** Rejected by
  maintainer mandate: clean-room everything. ADR-017 evaluation is therefore
  moot for Phase H parsers; it still applies if a geometry library is ever
  proposed.
- **Keeping CNC as an experimental side branch.** Rejected — an unmerged
  track rots against main and evades the governance the rest of the repo
  follows.
- **A separate CNC application.** Rejected — the Scene/Job pipeline, canvas,
  and GRBL streaming are shared; the discriminated `MachineConfig` union
  already isolates the differences cleanly.

### Consequences

- PROJECT.md gains the Phase H sub-phase table; DXF import moves in-scope
  (AI / PDF import stay out).
- WORKFLOW.md gains F-CNC flow IDs (F-CNC1–3 document the existing surface;
  F-CNC4–19 are reserved for the sub-phases).
- `CncPass` must become a discriminated union (contour | path3d) before
  variable-Z features land (H.1 tidy-first refactor).
- The G-code snapshot corpus grows CNC fixtures; CI time increases.
- Two machine families now share the UI; every layer-panel change must be
  checked in both modes.

### Verification

- Per diff: full CI gate (`pnpm test / lint / typecheck / format:check`);
  refactor diffs prove byte-identical G-code snapshots.
- Per feature: fast-check property tests (100 seeds) for each new invariant;
  perceptual tests (ADR-025 analytic-ground-truth pattern) for every
  geometric claim (V-carve depth field, relief terraces/scallops, pocket IoU).
- Per output-affecting sub-phase: the standing 4040 air-cut protocol above.

### Reversal triggers

- 4040 air-cut failures traced to compiled toolpaths (not machine setup) in
  two consecutive sub-phases → halt Phase H, re-audit the CNC core.
- The clean-room DXF parser cannot reach usable real-world compatibility
  within its sub-phase budget → revisit the no-library mandate via ADR-017.
- Maintenance burden: if CNC-attributable regressions in laser mode exceed
  ~1 per sub-phase, revisit the shared-UI decision.

## ADR-101 — CNC/laser UI separation policy: gate-and-hide

**Status:** Accepted
**Date:** 2026-07-02

> **Numbering note:** ADR-101 follows ADR-098 on this branch by design, not
> by accident. ADR-095–098 are reserved for the multi-controller track's
> renumbered ADRs and ADR-099 is the Phase-H collision resolution, both
> recorded on branch `claude/nice-fermat-55d508` (see
> `HANDOFF-CNC-2026-07-02.md` §2). Do not fill the gap.

### Context

ADR-098 chose one shared shell for both machine families and rejected a
separate CNC application. The CNC MVP and H.1–H.5 established a first
gating precedent — the Material Library hides in CNC mode, the
CncSetupPanel hides in laser mode, layer rows swap field sets — but the
command registry (`src/ui/commands/`) has zero machine-kind awareness. In
CNC mode today, the operator can invoke laser calibration generators
(Material/Interval/Scan-Offset/Focus tests), Fill Selection, Convert to
Bitmap, Trace, image-mask tools, and the Registration Jig; the per-object
Power Scale editor renders and silently does nothing (CNC compile ignores
`powerScale`); raster images import but are silently dropped by CNC
compile (`compile-cnc-job.ts` ignores `raster-image` objects by design);
and the right rail is laser-branded.

The maintainer decided (2026-07-02 session): laser-only surfaces hide in
CNC mode; there is no separate CNC workspace, no CNC-only shapes, and no
parallel CNC tools palette — shapes and text are machine-agnostic geometry
sources consumed by both compilers.

### Decision

1. **Policy — gate-and-hide.** A UI surface whose effect exists only in one
   machine family's output pipeline is *hidden* (not disabled) while the
   other family is active. Machine-agnostic surfaces — drawing tools, text,
   vector import, edit/arrange, preview, save — are never gated.
2. **The command registry gates at its single choke point.**
   `AppCommandContext` gains `machineKind`; `buildAppCommands` filters a
   laser-only ID set when the project machine is CNC
   (`src/ui/commands/machine-command-gate.ts`). All command surfaces (menu
   bar, toolbar, workspace context menu) already tolerate absent IDs, so
   hiding is uniform and shortcut dispatch is unaffected (no gated command
   has a hotkey). Laser-only set:
   - From the separation audit list: `tools.material-test`,
     `tools.interval-test`, `tools.scan-offset-test`, `tools.focus-test`,
     `tools.fill-selection`, `tools.convert-to-bitmap`,
     `tools.trace-image`, `tools.apply-image-mask`, `tools.crop-image`,
     `tools.remove-image-mask`, `tools.registration-jig`.
   - Same principle, beyond the audit list (each verified laser-only in
     the current tree): `tools.retrace-original` and
     `tools.multi-file-trace` (Trace family — the maintainer's directive
     hides "Trace" in CNC), `tools.adjust-image` and
     `tools.save-processed-bitmap` (laser Image-mode raster processing;
     CNC compile never consumes rasters), `tools.close-open-fill-contours`
     and `tools.close-fill-contours-with-tolerance` (Fill-mode repair),
     `tools.optimization-settings` (its only lever, `reduceTravelMoves`,
     is applied by `optimizePaths`, which passes `kind: 'cnc'` groups
     through untouched — verified in `src/core/job/optimize-paths.ts`).
3. **Laser-output-only object editors hide in CNC:** the per-object Power
   Scale input and image-adjustment editors
   (`src/ui/layers/SelectedObjectProperties.tsx`).
4. **Raster images stay importable in CNC mode** (maintainer's chosen fix):
   CNC preflight advisories gain a non-blocking warning when an
   output-enabled layer carries raster images, naming what is dropped —
   following the H.2 stock-footprint advisory pattern
   (`detectMachineJobWarnings`).
5. **Auto-focus hides in CNC mode.** *Provisional* — flagged for maintainer
   review: auto-focus is a laser focus routine; the CNC Z-zeroing flow
   arrives as its own H.7 surface.
6. **Device-profile laser-only fields hide in CNC mode:** the $30/$31/$32
   power range, air assist, scanning offsets (laser Image raster timing),
   and the autofocus command editor. *Provisional* — H.7 CNC machine
   profiles add the CNC counterparts. The connect-time Device Setup wizard
   keeps its laser steps for now (its firmware writes are individually
   confirmed, unlike the one-click path already gated in CNC); wizard
   behavior on a CNC connect is an open H.7 question.
7. **Shared chrome re-labels machine-aware** (right-rail heading, connect
   copy, "Estimated burn time" wording, "Laser:" shortcut hint, menu
   family label). The internal `'laser'` command-family key does NOT
   rename — only user-visible labels — to avoid churn across help topics
   and tests.
8. Relief-objects-in-laser-mode UX (warn/strip/block) is a separate
   decision, not part of this ADR.

### Alternatives considered

- **Disable-with-reason instead of hide.** Rejected — disabled laser
  concepts would still advertise themselves inside a router workspace; the
  maintainer chose hiding, extending the Material-Library precedent.
- **Per-surface filtering (menu, toolbar, context menu each filter).**
  Rejected — N surfaces × M commands drifts; one choke point in
  `buildAppCommands` cannot.
- **A separate CNC workspace.** Considered and rejected by the maintainer
  this session (re-affirming ADR-098).
- **Hiding raster import in CNC mode.** Rejected — the maintainer's
  separation audit chose a preflight advisory; images may still serve as
  visual reference, and projects opened from laser mode carry them.

### Consequences

- Every future command must be classified at birth: laser-only (add to the
  gate set), CNC-only (gate the other way when the first such command
  lands), or machine-agnostic. The gate module carries this checklist.
- Laser-mode behavior is byte-identical: the gate is an identity function
  for laser projects.
- WORKFLOW.md F-CNC1 documents the hidden surfaces; the PROJECT.md Phase H
  intro references this ADR between H.5 and H.6 (the maintainer-approved
  integrated build order).

### Verification

- Unit tests pin the gate: laser context exposes every command; CNC
  context hides exactly the laser-only set; machine-agnostic survivors
  present in both.
- Component tests for Power Scale and panel visibility in both modes;
  preflight advisory unit test.
- Full CI gate. No G-code change ⇒ no 4040 air-cut row (UI-only).

### Reversal triggers

- Operators report needing a hidden tool in CNC mode (e.g. Trace for
  cut-a-logo workflows) → revisit per-command with the maintainer.
- The laser-only set grows past ~25 entries → the shared-shell decision
  itself is under strain; re-open ADR-098's shared-UI clause.

### Amendment 2026-07-13 — Trace family reclassified machine-agnostic

**Trigger:** the first "Reversal triggers" bullet above — the maintainer needs
Trace available in CNC for cut-a-logo workflows (trace a raster to vectors, then
cut those vectors on the router).

**Change:** `tools.trace-image`, `tools.retrace-original`, and
`tools.multi-file-trace` move out of `LASER_ONLY_COMMAND_IDS` and become
machine-agnostic (visible in both laser and CNC). The other raster tools
(`tools.adjust-image`, `tools.crop-image`, `tools.apply-image-mask`,
`tools.remove-image-mask`, `tools.save-processed-bitmap`) stay laser-only — they
prep a raster *engrave*, which CNC has no mode for.

**Why it is safe:** a `traced-image` object already flows through the CNC cut
pipeline unchanged (`compile-cnc-job.ts` `collectLayerPolylines` handles it like
imported SVG/text/shape, and the kept trace-source raster is already excluded
from the CNC "raster will be skipped" advisory via `role !== 'trace-source'`).
No compile-pipeline change is needed.

**Fidelity caveat (recorded for operators):** the tracer is outline-based, so a
single thin stroke traces as two parallel contours. On a laser that is cosmetic;
on a CNC *profile* cut it becomes two cuts bracketing the stroke rather than one
centerline pass. Cutting out a filled shape/logo — the common CNC case — is
unaffected. The Trace dialog shows a CNC note to this effect.

**Verification:** `machine-command-gate.test.ts` moves the three Trace IDs into
`CNC_SURVIVORS`, locking the new behavior; the data-driven "hidden set equals
the laser-only set" assertion updates from the source of truth automatically.

## ADR-102 — three.js for the 3D relief viewer (explicit ADR-098 §2 override)

**Status:** Accepted
**Date:** 2026-07-03

### Context

Relief carving (H.4/H.5) renders on the canvas as a 2D grayscale depth
map. The maintainer approved a REAL 3D viewer for reliefs in the
2026-07-02 session, with the explicit condition that it stay blocked
behind this ADR: ADR-098 §2 says "no new runtime dependencies are planned
for Phase H," and a WebGL scene graph is exactly the kind of wheel the
clean-room mandate does not extend to — hand-rolling camera math, depth
buffers, and lighting is weeks of risk for zero product differentiation.

### Decision

1. Adopt **three.js** (MIT) as a runtime dependency, explicitly overriding
   ADR-098 §2 for this one library. The clean-room mandate is about
   PARSERS and GEOMETRY (data fidelity we must own); presentation is not
   canon-critical.
2. **three.js is UI-only.** It may be imported beneath
   `src/ui/relief-viewer/` and nowhere else — never in `core/` or `io/`.
   clipper2-ts remains the only geometry dependency of the core. The
   heightmap→mesh conversion stays a PURE core function returning plain
   `Float32Array`s (positions/indices/normals feed three's BufferGeometry
   at the UI boundary), so the viewer's geometry is testable without
   WebGL.
3. **Lazy-loaded.** The viewer dialog imports three via dynamic
   `import()` so the ~150 KB gzip lands in its own chunk and the base
   bundle is unchanged until the first 3D view opens.
4. Environments without WebGL (jsdom, headless CI) get a graceful
   fallback message, which is what component tests assert.

### Alternatives considered

- **Clean-room WebGL viewer.** Rejected — violates the spirit of
  ADR-017 (don't rebuild commodity infrastructure); high defect surface.
- **Keep the 2D depth map only.** Rejected by the maintainer — a relief
  workflow without a 3D read of the carve is guesswork.
- **babylon.js.** Heavier, Apache-2.0, no advantage at this scope.
- **regl / raw-gl wrappers.** Lighter but shifts scene/camera/lighting
  boilerplate back onto us.

### Verification

- RESEARCH_LOG.md dependency row (version, license re-verified) — CI
  cross-checks package.json against it.
- Pure mesh-builder unit tests against analytic heightmaps; component
  fallback test in jsdom; full gate.
- Visual check of the rendered relief in the isolated preview browser.

### Reversal triggers

- Bundle-size or supply-chain audit flags three.js → replace the viewer
  with a static isometric canvas projection (pure core, no dependency).


## ADR-103 — Market-parity build-out: sender workflows, vector booleans, 3D cut preview (2026-07-03)

**Status:** accepted (maintainer session directive). Individual G-items
marked PROVISIONAL where this session applied judgment; review welcome.

### Context

Maintainer directive: "build a full working CNC app with everything the
best CNC app on the market has." The grounded comparison
(`audit/reports/cnc-market-gap-audit-2026-07-03.md`, researched against
VCarve 12 / Easel / Carbide Create+Motion / gSender 1.6 / OpenBuilds)
shows the post-Phase-H CAM core is competitive, and the remaining
table-stakes (T1) and differentiator (T2) gaps cluster in sender
workflows, vector editing, and 3D visualization. Per CLAUDE.md, scope
lands here before code.

### Decision — build now (Phase H.11, in priority order)

- **G1. Vector booleans + offset.** Union / subtract / intersect /
  exclude on selected closed paths, plus inward/outward offset with a
  distance field. Implemented on **clipper2-ts, already the approved
  geometry dependency** (ADR-098 §2) — this deliberately supersedes the
  Phase-G note that deferred the "geometry kernel" to a future
  evaluation: the evaluation happened (ADR-017 pattern) when clipper2
  was adopted for pockets/v-carve; booleans use the same engine. Weld
  = union. Node-level editing beyond this stays future work.
- **G2. Probing wizard.** Guided touch-plate probing: **Z** (plate
  thickness compensated) and **XYZ corner** (plate edge offsets + bit
  diameter). Two-stage G38.2 (fast seek, retract, slow re-probe),
  `G10 L20` work-offset zeroing, ALARM:4/5 decoded, Idle-only
  preflight, 30 s watchdog. The XYZ cycle performs all contact motion
  before one combined X/Y/Z offset commit, so a failed leg cannot leave a
  partially rewritten WCS. PROVISIONAL defaults: seek 150 mm/min,
  re-probe 25 mm/min, retract 2 mm, max travel 25 mm.
- **G3. Real-time overrides.** GRBL 1.1 realtime bytes: feed
  0x90–0x94, rapid 0x95–0x97, spindle 0x99–0x9D, surfaced as
  +/-10 / +/-1 / reset controls during a running job, with the live
  `Ov:` values from status reports shown when present. Machine-agnostic
  (GRBL overrides apply to laser jobs too).
- **G4. General 3D cut preview.** The H.2 material-removal grid
  rendered as a shaded heightfield in the ADR-102 three.js viewer for
  ANY CNC job (not just reliefs). UI-only, same lazy chunk, same jsdom
  fallback.
- **G5. Feeds & speeds calculator.** Chipload-based: RPM x flutes x
  chipload = feed; plunge as a percentage; starter chipload chart
  (softwood / hardwood / plywood-MDF / acrylic / aluminum x bit
  diameter bands) with every value editable. Writes into the layer
  card; composes with H.7 presets. PROVISIONAL: chart values are
  industry-typical starting points, clearly labeled as such.

### Stretch (build if session capacity allows, same rules)

- **G6. Dogbone / T-bone corner fillets** for interior square corners.
- **G7. Start-from-line job recovery** (gSender-style, with safe-Z
  preamble reconstruction).
- **G8. Spoilboard surfacing generator** (pure G-code wizard).

### Explicit roadmap — NOT silently skipped (each needs its own ADR)

Arc/curved text; system-font import; drag-placeable tabs; pocket raster
strategy + pocket rest-machining; v-carve inlay automation; macros /
quick actions; keymap editor + gamepad; remote mode; diagnostics
dashboards; G2/G3 arc **output**; adaptive clearing; nesting; rotary;
two-sided; thread milling; photo/sketch carve; keep-out zones; firmware
flashing. The standing "do not market as Easel-equivalent" directive
stays until the maintainer lifts it.

### Constraints carried over

ADR-098 §1/§3 unchanged: clean-room, no new runtime deps (G1–G8 add
none; G4 reuses ADR-102's three.js), every output-affecting feature
lands CLAIMED until a 4040 air-cut. Defaults must keep existing G-code
byte-identical; the one intentional exception is the **CNC banner fix**
(the laser-worded `$32=1` header line in router exports — an E2E-run
defect), which will carry the snapshot acknowledgment line.

### Verification

Per feature: unit + property tests, WORKFLOW.md flows (success / error /
empty / edge) before UI, full gate per commit, isolated-preview
perceptual pass where renderable, AUDIT.md CLAIMED rows with named
pending hardware checks.

## ADR-104 — Integration numbering: controllers keep 094–097 + Phase I; CNC renumbers to 098/101/102/103 + keeps Phase H (2026-07-03)

**Status:** accepted (recorded at the merge of `claude/determined-dewdney-7ec915` into `main`).

### Context

Two Phase H tracks were built in parallel off pre-Phase-H mains: the CNC
router track (ADR-094 = CNC scope on its branch) and the multi-controller
track (ADR-094–097 = driver seam/Marlin/Smoothie/Ruida). An earlier
resolution (ADR-099, drafted on the controller branch but never landed)
gave CNC the 094 number — however the controller track merged to `main`
FIRST, publishing 094–097 and (via the trace rebuild) ADR-100. Published
numbers win.

### Decision

- Controller ADRs keep **094–097** as published on `main`; the trace
  rebuild keeps **ADR-100**. The controller product phase is relabeled
  **Phase I — v0.9 "Multi-controller"** in PROJECT.md (its WORKFLOW flow
  IDs keep their original F-H prefix).
- The CNC track keeps the product label **Phase H — v0.8 "Router"** and
  its ADRs renumber at integration: CNC scope 094→**098**, gate-and-hide
  100→**101**, three.js 101→**102**, market-parity 102→**103**. Every
  in-tree reference was swept in the merge commit; pre-merge commit
  messages retain the old numbers (immutable history — read them against
  this table).
- ADR-099 is retired unused; the number stays reserved to avoid a third
  meaning. Next free ADR: **105**. *(Running update — published since:
  ADR-105 Easel-parity pack, ADR-106 box generator, ADR-107..110 Camera
  Mode v1..v4 — next free ADR: **111**.)*

## ADR-105 — Easel-parity UX pack: persistent 3D pane, pocket raster fill, bundled design library (2026-07-03)

**Status:** accepted (maintainer directive: "make sure that we have
everything Easel has and more"). Grounded by
`audit/reports/easel-1v1-comparison-2026-07-03.md`.

### Decisions

- **G9 — persistent 3D pane.** A docked, collapsible right-side pane in
  CNC mode renders the simulated cut result (stock + removal heightfield,
  the ADR-102 scene) LIVE while designing — Easel's split-view. The pane
  computes a coarse toolpath + removal grid outside Preview mode,
  debounced per edit; Preview mode reuses the scrubbed preview grid.
  UI-only; compile/emit untouched.
- **G10 — pocket raster fill.** `CncLayerSettings.pocketStrategy?:
  'offset' | 'raster-x' | 'raster-y'` (absent = offset, byte-identical
  output). Raster pockets inset the region by the bit radius (clipper2),
  hatch it with serpentine sweeps at the layer stepover, and finish with
  the innermost perimeter ring per depth pass — Easel's Fill Method
  offset/raster X/raster Y.
- **G11 — bundled design library.** A curated, LOCAL starter library
  (Easel's cloud "3M designs" is out of scope for a local-first app):
  `lucide-static` (ISC — MIT-compatible per ADR-017) provides the icon
  corpus; a manifest bundles a curated subset by category into a Library
  dialog that inserts through the existing SVG import pipeline. Larger
  art: users import SVGs from CC0 sources (openclipart et al) — the
  dialog links the guidance. PROVISIONAL curation; growable.
- **Explicitly NOT gaps (answering the drivers question):** Easel Driver
  exists because a cloud page cannot reach serial ports; KerfDesk talks
  WebSerial directly (browser) / native serial (Electron) — no agent to
  install. FTDI/CH340 USB-UART drivers are OS/board-level, identical for
  every sender. Post-processors: external CAM (Vectric/Fusion) targets
  us with their stock GRBL post; running such files live is roadmap
  (G12, external-program streaming — the simulator already re-imports
  them read-only).

### Verification

Unit tests per feature; raster-fill coverage/no-gouge checks; jsdom
fallback for the pane; license-check green with the new dependency;
full gate per commit. Hardware remains CLAIMED per ADR-098 §3.

## ADR-106 — Parametric finger-joint box generator: claim-model joinery (2026-07-03)

**Status:** accepted (maintainer-approved build plan, 2026-07-03).
**Numbering note:** drafted as ADR-105 on the box-generator branch, but
the Easel-parity pack published 105 on `main` first — published numbers
win (ADR-104 precedent). Pre-merge commit messages on
`claude/relaxed-liskov-0df88b` say ADR-105; read them as this ADR.

### Context

Operators want cut-ready finger-joint boxes for both laser and CNC
router modes. A previous attempt failed because the 2D panel math did
not encode the 3D assembly: panels rotate 90° into place, material
thickness eats into each mating panel, and the cutting process (laser
kerf / endmill radius) changes fit. Behavior research on MakerCase
(reverse-engineering study) and boxes.py (docs only — GPL, no code
copying per ADR-017) isolates the two classic failure classes this
design is built around:

1. **Corner conflicts.** Three panels meet at each cube corner; naive
   per-edge tab math either double-claims the T×T×T corner cube (parts
   collide — cannot assemble) or never claims it (visible hole).
   MakerCase's own study lists corner fillers as a known deferred gap.
2. **Fit compensation applied wrong.** Kerf widening done per-tab
   instead of as a uniform contour offset, or CNC interior corners left
   square so square tabs cannot seat (missing relief).

### Decision — own math, built against those two failures

- **One sequence per cube edge.** Each of the 12 cube edges is shared
  by exactly two panels. Per edge ONE alternating cell sequence is
  computed — odd cell count `n` = largest odd ≤ span/targetFingerWidth,
  clamped ≥ 3 (`1` for tiny spans), cell width `f = span/n` — and BOTH
  panels derive material ownership from that one sequence: A owns
  exactly what B does not. Complementarity holds by construction;
  both-tabs / neither-tab is unrepresentable. Odd count ⇒ symmetric ⇒
  opposite panels stay interchangeable.
- **Corner rule.** Each of the 8 T×T×T corner cubes has exactly one
  claimant: global axis priority **Z > Y > X** (top/bottom > front/back
  > left/right) among *present* panels. Open-top: corner cells that
  would belong to the missing top fall to the next-priority panel.
- **Outline walk.** Panel outline = closed rectilinear polygon walked
  from claims: boundary at the outer face line where a cell is owned,
  recessed by T where the mate owns it. No holes in v1 (dividers later).
- **Fit — division of labor (nothing duplicated).** Laser beam width
  stays in per-layer kerf compensation (`kerf-offset.ts` at compile;
  nominal = line-to-line press fit — LightBurn parity: kerf lives in
  cut settings, not the drawing). CNC cutter compensation stays in
  `profile-paths.ts` (`profile-outside`). The generator bakes exactly
  two things:
  1. **Clearance `c`** (signed, + = looser; default 0 laser = press
     fit, 0.15 mm CNC = glue fit): every panel polygon offset by −c/4
     via `offsetClosedPolylinesForKerf`. Derivation (corrected at S2
     from an earlier −c/2 draft): a uniform inward offset δ narrows
     every tab by 2δ AND widens the mating recess by 2δ, so joint play
     = 4δ; the contract is play == c, hence δ = c/4 — tabs narrow c/4
     per flank, recesses widen c/4 per flank, notch − tab = c exactly,
     uniformly. Never per-tab arithmetic.
  2. **CNC corner relief** in the shipped F-CNC26 corner-overcut
     convention (`dogbone.ts` precedent): a circle of one bit RADIUS
     centered ON the seat-critical reflex corner vertices, subtracted
     from the panel. The generator knows which corners mate, so it
     relieves exactly those (not `dogboneVectorObject`, which unions
     circles into cutout regions and blankets all sharp corners).
     **Ordering pinned: clearance offset FIRST, then reliefs at full
     bit radius** — offsetting after would shrink reliefs below tool
     diameter. Laser mode: no reliefs.
- **Modules.** Pure core `src/core/box/` (box-spec, edge-pattern,
  panel-claims, panel-outline, panel-fit, layout, generate-box) — NOT
  `core/shapes` (its index is at export capacity). UI `src/ui/box/`
  (dialog + canvas preview). Insertion wraps panels into ordinary
  `kind:'shape'` polyline objects via the existing `createPolyline`
  (ids injected UI-side via `crypto.randomUUID()`, ONE undo step,
  `ensureLayersForColors`, all inserted panels selected, ungrouped).
  Compile/preview/emit untouched; zero G-code snapshot churn.
- **Validation.** Pure `Result`-style union, no throws: dims/T > 0;
  inner dims stay positive when derived; finger width clamped to
  [max(2mm, T), span/3]; CNC: `f > toolDiameter` (error) and warn when
  `f < 2·toolDiameter`; `|c| < min(f, T)/2`. Violations →
  `{ kind:'invalid', issues }` rendered in the dialog; generation
  disabled.
- **v1 scope.** Closed 6-panel + open-top 5-panel; inner dimensions
  default (what the contents need), outer via toggle. Deferred as
  staged follow-ups: lids (slide/hinged), dividers, engraved panel
  labels (needs the io/text pipeline — unreachable from pure core),
  dogbone/T-bone relief styles (same future-refinement note as
  `dogbone.ts`).

### Verification (green structural tests ≠ fit — CLAUDE.md rule 2)

1. **Virtual 3D assembly referee** (fast-check, 100 runs, predicates in
   `src/__fixtures__/property/`): map each derived panel polygon into
   box coordinates via its placement (this encodes "panels turn
   sideways"), extract both panels' exact 1D occupancy intervals along
   each shared edge band — computed from the OUTPUT polygons, not the
   internal claim model. Assert: nominal ⇒ exactly complementary (zero
   overlap, zero gap); with clearance ⇒ uniform play ≈ c within 2·10⁻³
   (clipper rounds to 3 decimals), never interference; each cube corner
   has exactly one claimant (closed box). Fuzz: W,D,H ∈ [20,600],
   T ∈ [1,25], finger ∈ [1.5T,5T], open/closed, c ∈ [0,0.5].
2. **Invariants:** assembled outer bbox == outer dims exactly; every
   polygon simple and closed; reliefs only at reflex corners, only when
   CNC, diameter == tool diameter; determinism (same spec ⇒
   JSON-identical output — core has zero RNG).
3. **Perceptual fixture** (ADR-025 harness): render the generated sheet
   for a canonical spec; IoU vs analytic expectation + opt-in PNG
   artifact for human eyeballing.
4. **Hardware:** physical fit is NOT software-verifiable — the feature
   lands CLAIMED per AUDIT.md convention with a named pending check:
   cut a 60×40×30 mm, T=3 box on the Falcon (laser) / 4040 (router)
   and assemble it.

---

---

## ADR-107 — Camera Mode: overhead-camera alignment (manual 4-point homography v1; staged v1–v4)

**Status:** Accepted; staged in small PRs. | **Date:** 2026-06-27

> Numbering note: authored on `claude/camera-mode-v1` as ADR-094/095 (then the next
> free slots above the build plan's ADR-054..091 reservation). Merged after ADR-104's
> integration renumbering had assigned 094–104 to the controller/CNC tracks, so —
> following the ADR-104 precedent — the camera ADRs renumber on merge: v1 = ADR-107,
> v2 = ADR-108; v3 / v4 reserve ADR-109 / ADR-110. Pre-merge commit messages retain
> the old numbers (immutable history — read them against this note).
> Renumbered AGAIN at the main merge: origin/main had published ADR-105
> (Easel-parity pack) meanwhile — published numbers win (ADR-104) — so the
> camera ADRs were then v1=106..v4=109 — and renumbered a THIRD time when the
> Phase K box generator published ADR-106: final numbers v1=ADR-107,
> v2=ADR-108, v3=ADR-109, v4=ADR-110.

### Context

`PROJECT.md` listed "Camera alignment, overhead camera" under Out of scope; the maintainer
requested it. LightBurn's camera (capture → lens calibration → 4-marker alignment → live
overlay → print-and-cut → capture-to-trace) is the behavioral reference. Competitor source
was read directly: MeerK40t `camera.py` (`cv2.getPerspectiveTransform` from four manually
dragged corners, no RANSAC), Rayforge (capture-to-trace, `findHomography` with an image
y-down → bed y-up flip), OpenPnP (fiducial detection + intrinsic calibration). An adversarial
second audit verified the math against that code and found no errors.

The decisive constraint is the < 1 MB compressed web-bundle target (ADR-017): OpenCV.js
(~8–10 MB WASM) is ~10× the budget. The CV math actually required is small — a 4-point
homography is an 8×8 linear solve; Brown–Conrady undistort and inverse-homography rectify are
each a few dozen lines — and hand-rolls to ~150–250 LOC of pure TypeScript.

### Decision

1. **Hand-rolled pure-TS CV in a new `src/core/camera/` module — no OpenCV.js.** Rejected on
   bundle size, not licence (OpenCV.js is Apache-2.0, which is permitted). RANSAC (v3) injects
   its RNG per the pure-core no-random rule.
2. **Capture via a new `CameraAdapter` on `PlatformAdapter`** (`getUserMedia` / enumerate /
   stream), mirroring the existing `SerialAdapter` contract (`isSupported` / request,
   AbortError → null). Electron is Chromium, so one web code path serves web and desktop.
3. **v1 live overlay via CSS `matrix3d`** (the GPU performs the perspective divide; Canvas2D is
   affine-only and physically cannot warp). `matrix3d` covers the homography only — distortion
   correction (v2) cannot ride it and its live-undistort tech (WebGL shader / CPU remap /
   still-path-only) is resolved at v2.
4. **v1 alignment = manual 4-point homography** (matches LightBurn and MeerK40t: exact 8-DOF,
   no RANSAC). **Alignment targets are laser-engraved** at known machine coordinates, reusing
   the registration-jig engrave machinery (ADR-057). Fiducial auto-detection is deferred to v3;
   `js-aruco` / `js-aruco2` are rejected because their bundles include LGPL-v3 code.
5. **Calibration persists as a `readonly` optional field on `DeviceProfile`** (sibling of
   `scanningOffsets`; additive normalize in `deserialize-project.ts`; no `schemaVersion` bump).
   In-progress calibration drafts use the existing `localStorage` calibration-draft pattern.
6. **Staging:** v1 overlay + manual 4-point (this ADR) → v2 Brown–Conrady lens calibration
   (ADR-108) → v3 fiducial auto-align + 2-point print-and-cut (ADR-109) → v4 capture-to-trace
   reusing the existing trace pipeline (ADR-110). Each phase ships as its own small PR set.

### Consequences

- New pure-core module `src/core/camera/`; new `src/platform/web/web-camera.ts`; new
  `src/ui/camera/` (overlay + alignment panel) and a camera Zustand slice; one `readonly`
  field on `DeviceProfile`. No new runtime dependency; v1 bundle impact ~< 10 KB.
- The camera frame is a UI/IO concern only — core never generates it. The existing
  `drawBitmapAtTransform` / `view-transform` machinery and the registration-jig drag panel are
  reused rather than reinvented.

### Verification

Pure-core property and unit tests prove the math (four-correspondence round-trip, degeneracy
rejection, y-flip consistency) and run in CI. **They do not prove the overlay lands on the
real bed** — per CLAUDE.md rule 2 (green math ≠ fidelity), accuracy is verified on a physical
USB camera over a real machine (available to the maintainer): engrave the four targets, align,
and confirm a placed object burns where the overlay showed it. The y-flip *direction* can only
be confirmed against a real capture (a self-consistent pure test shares the flip and cannot
catch a mirror). A golden-image regression fixture (the ADR-025 perceptual harness) built from
a one-time real capture guards the math thereafter. The zero-install web target requires an
https / secure context or `getUserMedia` silently fails.

### Out of scope for v1

Lens distortion correction (v2), fiducial auto-detection (v3), capture-to-trace (v4), and
non-Chromium (Firefox) `OffscreenCanvas` fallbacks — tracked by ADR-108 / 109 / 110.

---

## ADR-108 — Camera Mode v2: fisheye lens calibration + de-fisheye render

**Status:** Accepted; staged in small PRs. | **Date:** 2026-06-28

### Context

The Falcon A1 Pro (like most laser bed cameras) uses a wide-angle lens, so the live feed
is visibly barrel-bowed. The ADR-107 4-point homography corrects perspective only — it
pins the four corners but cannot remove lens curvature, so straight bed edges stay curved.
A camera-implementation study (MeerK40t, OpenPnP, LightBurn, Rayforge, LaserWeb4, OpenCV)
confirmed the universal fix: a lens-distortion model applied to the frame **before** the
homography.

Licensing (ADR-017/018): GPL/AGPL apps (OpenPnP, LaserWeb4) may be **studied** but not
vendored; only MIT/BSD/Apache code may be copied. OpenCV.js (the build) is excluded on
bundle size (ADR-107), not licence — and the distortion math is not copyrightable, so the
equations are clean-roomed in TypeScript from the published Kannala-Brandt model.

### Decision (maintainer-chosen, 2026-06-28)

1. **Model: Kannala-Brandt fisheye** (θ-polynomial, k1..k4), not Brown-Conrady. It stays
   well-behaved at the wide field angles where Brown-Conrady's r⁶ term diverges; MeerK40t
   uses exactly this (`cv2.fisheye`) for the same hardware class. Pure-TS forward
   (`θ_d = θ(1 + k1θ² + k2θ⁴ + k3θ⁶ + k4θ⁸)`) plus a Newton inverse.
2. **Calibration: guided board.** Print a checkerboard, capture ~5 poses (4 corners +
   centre) with a per-capture reprojection-error score (LightBurn) and per-quadrant
   coverage feedback (Rayforge); fit K (fx,fy,cx,cy) + D (k1..k4) with an in-TS
   Levenberg-Marquardt minimiser over reprojection error. ChArUco is rejected — its ArUco
   decode needs an LGPL bundle barred by ADR-107; a plain checkerboard detects clean-room.
3. **Render: WebGL fragment shader.** The inverse-distortion sampling runs per-pixel on the
   GPU (LaserWeb4 proves `regl` does this < 1 MB, no OpenCV); output→input sampling so a
   rectified output pixel reads the distorted source. Supports live UVC video, not only the
   polled still.
4. **Order:** capture → de-fisheye → 4-point homography (ADR-107) → overlay. The homography
   now runs on rectified pixels. K + D persist on the readonly `DeviceProfile` field ADR-107
   reserved.

### Staging

v2.a fisheye math (pure core) · v2.b checkerboard detection (pure, `ImageData` in) ·
v2.c LM intrinsic solver (pure — the highest-risk port) · v2.d WebGL undistort shader ·
v2.e calibration wizard UI (capture poses, coverage + error score, and an OpenPnP-style
A/B "Apply Calibration?" toggle). Each is its own small PR.

### Consequences

- New pure-core `src/core/camera/{fisheye,checkerboard-detect,calibrate}.ts`; a new WebGL
  renderer and calibration wizard in `ui/camera/`. No new runtime dependency; the math is
  clean-roomed from the published Kannala-Brandt model and OpenCV/glfx equations (referenced,
  never copied).
- Once distortion is on, the overlay moves off pure CSS `matrix3d` (which cannot carry lens
  curvature) to a composited undistort→homography frame.

### Verification

Pure tests prove the math (distort/undistort round-trip; the LM solver recovers a known
K/D from synthetic board poses). Per CLAUDE.md rule 2, green math is **not** a straight real
image: an A/B "Apply Calibration?" toggle (OpenPnP) lets the operator **see** the bed edges
straighten on the real Falcon, and a golden frame guards regressions (ADR-025). Physical
straightness is hardware-verified, not asserted by a green suite.

### v2.c as-built (2026-06-28)

The LM intrinsic solver shipped as pure-core modules in `src/core/camera/` — all internal
except the single public entry point `calibrate(views, options?)`: `levmar` + `levmar-kernel`
(generic central-difference Levenberg-Marquardt with Marquardt damping), `rodrigues`
(axis-angle ↔ matrix, incl. the near-π log-map branch), `lm-params` (flat parameter packing),
`calibrate-residuals` (reprojection residuals; behind-camera corners masked inactive, not
penalised), `init-guess`, `calibrate` + `calibrate-metrics`, and the `calibrate-fixtures`
synthetic oracle (its own independent Rodrigues so a transposition bug cannot self-cancel).

Decisions made during the build (deviating from / refining the draft design):

- **Init = robust fisheye seed, NOT Zhang's pinhole closed-form.** `B = K⁻ᵀK⁻¹` factorises a
  negative/imaginary focal under Falcon-class barrel distortion, so K is seeded from the
  device-nominal focal (`0.7·imageWidth` default, or a measured `options.initialGuess`), D=0,
  and only the per-view R/t are taken from a homography decomposition (forced `t.z>0`,
  Gram-Schmidt orthonormalised). The wrong-K basin test confirms LM crosses to truth.
- **`behind-camera` failure reason dropped.** The `t.z>0`-forcing seed makes a whole-board
  behind-camera result unreachable; shipping the reason would be dead code. Reachable failures:
  `too-few-views | too-few-points | rank-deficient | no-convergence`.
- **Karpathy finding — noise overfits the high-order terms.** Zero-noise synthetic recovery is
  machine-precision for K and D from both a good and a wrong-K init. But under 0.2px detection
  noise the reprojection RMS stays low (~0.15px) while the weakly-observed `k3,k4` overfit to
  absurd values (e.g. k3 ≈ 200). **v2.e must add a coefficient-sanity bound + an RMS gate and
  prefer more poses/points; a low RMS alone does not mean a usable calibration.**

### v2.d as-built (2026-06-28) — render path refines decision #3

Shipped pure-core, all verified: `rectify-map.ts` (per-pixel output->input sample point, the
math the renderer mirrors), `cpu-rectify.ts` (bilinear-sampled de-fisheye over an RGBA buffer),
`camera-calibration.ts` (the persisted `CameraCalibration` type + an untrusted-JSON normaliser),
and a new optional `cameraCalibration?: CameraCalibration` on `DeviceProfile` (the ADR-107 #5 /
ADR-108 #4 "reserved" field — it did NOT exist in code; this closes that doc-vs-code drift),
normalised in `deserialize-project.ts` (override, not merge, so a malformed value is dropped).

**Render refinement (flag for the maintainer).** Decision #3 chose a WebGL fragment shader,
justified by "supports live UVC video." But the Falcon A1 Pro is a **polled network still**
(`getCapturePhoto`, ~1.5 s cadence), not 60fps video — so the tested CPU rectify (one pass per
polled frame) is adequate AND is the no-WebGL fallback the ADR already required. Building an
unverifiable GPU shader now would violate CLAUDE.md rule 2 (no "works" without perceptual proof).
**As-built: ship the CPU rectify as the v2 render path; defer the WebGL shader to a live-video
optimisation if/when a UVC camera is supported.** The maintainer can override this back to
WebGL-first; recorded here rather than silently swapped.

**Karpathy proof (no hardware needed).** `cpu-rectify.test.ts` distorts a known smooth scene
through the forward KB model, rectifies it back, and confirms reconstruction to <6 grey levels
over the interior — proving the de-fisheye *pipeline* straightens curvature. What remains
hardware-gated is only whether the **real Falcon lens matches the calibrated model**, surfaced by
the v2.e A/B "Apply Calibration?" toggle on a real captured frame.

**FOV tradeoff.** The rectify uses `outputK === sourceK` (the `outputK` parameter is separate so a
future widened "new camera matrix" can be slotted in). This trades ~7–8% of peripheral field for a
border-free overlay — the same default MeerK40t/LightBurn use. The v2.e wizard copy should mention it.

### v2.e as-built (2026-06-28) — trust gates + capture session (pure core); UI handed off

Shipped pure-core, all verified: `calibration-trust.ts` (`assessCalibrationTrust` flags implausible
KB coefficients `|k|>1`, RMS `>1.5px`, or a near-empty image quadrant — the gate that catches the
v2.c k3/k4-overfit a low RMS would otherwise hide), `pose-diversity.ts` (`checkPoseDiversity` —
geodesic rotation spread; rejects the 5-near-identical-shots focal/depth-ambiguity trap),
`resolution-match.ts` (`frameMatchesCalibration` + `scaleIntrinsicsToFrame` for apply-time frame
rescaling), and `calibration-session.ts` (the wizard's pure reducer: collect → solve → assess).

**Reduced distortion model.** `CalibrationOptions.distortionModel: 'k1k2' | 'k1k2k3k4'` (default
full; a string union, not a boolean per CLAUDE.md). `'k1k2'` freezes `k3=k4=0` via a new generic
`LevMarOptions.fixedIndices` (the param's Jacobian column is zeroed, so the damped step never moves
it). The wizard should default to `'k1k2'` for low-angular-coverage Falcon captures.

**Two solver behaviour changes (decisions, recorded):**
- **LM terminates on a damping explosion.** A sustained reject streak drives λ past `LAMBDA_MAX`
  → the step is negligible → we are at a minimum → `converged: true`. The absolute gradient stop is
  too tight to catch a nonzero-cost (reduced-model) minimum at pixel scale.
- **`calibrate()` returns a best-effort fit on non-convergence, not a hard failure** — OpenCV/
  MeerK40t behaviour, resolving the v2.c audit's concern that `converged:false → 'no-convergence'`
  wrongly rejects usable fits. `'no-convergence'` now means only a genuinely blown-up (non-finite)
  LM run. The wizard's trust check, not the solver, judges usability.

**Conditioning finding (honest).** For a narrow-FOV planar board (θ ≈ 0.12 rad here) even `k1,k2`
are weakly observable and trade off under noise (e.g. k2 → 1.0 while RMS stays ~0.15px) — the same
Karpathy lesson one order down. This is inherent to narrow-FOV planar calibration, not a solver bug;
`assessCalibrationTrust` is the backstop. Wider angular coverage (more board tilt/closer board) is
the real remedy, which the pose-diversity + coverage gates nudge the operator toward.

**Handed off (hardware-gated, NOT built).** The wizard's React UI + live camera/canvas wiring —
polling Falcon frames, detecting the checkerboard and feeding `BoardObservation`s, rendering
coverage/RMS/trust, and the A/B "Apply Calibration?" overlay (`rectifyImage`) — needs the
maintainer's real Falcon to build and verify (CLAUDE.md rule 2 perceptual proof, rule 4 side-effect-
free). The session/solve/assess/persist (`toCameraCalibration`) and de-fisheye (`rectifyImage`)
dependencies are all shipped and exported. **One pure piece is deliberately NOT shipped: a
checkerboard GRID DETECTOR.** `refineCornerSubpixel` only *refines* an already-located corner; finding
the grid in a real frame (the hardest pure-CV step) is part of the handed-off work, best built and
tuned against real Falcon captures.

**v2.e audit fixes (post-audit, all gated).** The trust gate now also inspects the intrinsics it
gates (`intrinsics-implausible`: non-positive/non-finite focal, or a principal point thrown far
outside the frame) — a degenerate-but-finite K with a low RMS no longer reads "trusted".
`CalibrationResult.ok` now carries `converged: boolean` + a typed `exit` (`tolerance` |
`iteration-cap` | `damping-stall`) so the wizard can warn before applying a best-effort fit; the
LM damping-stall stop is now `converged:false` (a stall is not a tolerance stop). Non-finite
distortion coefficients are flagged explicitly, `scaleIntrinsicsToFrame` guards non-positive frame
sizes, and the pose-diversity floor is documented as provisional + overridable.

### v2.b as-built (2026-07-03) — checkerboard auto-detection ships; focal sweep added

The handed-off GRID DETECTOR is now shipped as pure core, closing v2.b: `gray.ts`
(RGBA→luma), `xcorner.ts` (a clean-room centrosymmetry ring response — 16 taps at
radius 3; alternation across 90° minus an opposite-sample edge penalty — plus
non-max suppression), `grid-lattice.ts` (seed at the candidate nearest the cloud
centroid, basis from its two non-collinear nearest neighbours, then BFS integer-
lattice growth with second-order local extrapolation, full-window extraction and a
deterministic orientation), and `detect-checkerboard.ts` (orchestration + sub-pixel
refinement + `checkerboardObjectPoints`/`toBoardObservation` for the session).

**Verification (per CLAUDE.md rule 2, no hardware needed for this layer).** The
harness RENDERS frames through the forward KB model (`board-render-fixtures.ts`:
undistort each pixel to a ray, intersect the board plane, supersampled checker
shading) and detection runs on pixels alone: 54/54 corners on all seven test poses
(mean error < 0.4 px, matched bijectively against projected truth), robust to
sensor-scale noise, typed failures on blank/cut-off frames, and an end-to-end run
whose detections calibrate back to the true camera. A rendered A/B (distorted grid
with detections marked vs. de-fisheyed with the AUTO-recovered fit) was visually
confirmed straight. What remains hardware-gated is only real-Falcon frames
(lighting, blur, real sensor noise) via the wizard's live view.

**Solver finding (measured) + focal sweep decision.** From the default focal seed
(0.7·width) on detected corners, LM crawls the flat focal↔k1k2 valley: fx error
was still ~22% after 300 iterations, ~12% after 800, ~4% after 3000 — while the
same data seeded near the true focal settles in a few hundred (fx to ~1%). The
audited solver is left untouched; instead `calibrate-sweep.ts` adds
`calibrateWithFocalSweep()`: five short probes at fx/width ∈ {0.45, 0.55, 0.7,
0.9, 1.2}, keep the lowest-RMS basin, polish that seed with the caller's budget.
`solveSession` now routes through it, and it degrades to exactly one `calibrate()`
call when the caller supplies a measured focal. Corollary (also measured): the
step/cost tolerances are tight enough that realistic solves end `iteration-cap`
while micro-improving — the wizard must treat `iteration-cap` + trusted-gate-pass
as normal, not as a warning state, and should pass a generous `maxIterations`
(hundreds; a solve is seconds, cost scales with corners not pixels). Individual
K/D parameters remain only weakly identifiable on planar targets — acceptance is
judged on the fitted MAPPING (and the A/B view), not parameter closeness.

### Overlay wiring as-built (2026-07-03) — alignment persists; workspace overlay mounts

The beta exported `CameraOverlay` but never mounted it, and the solved
homography lived only in the ephemeral camera store — F-CAM1's "saved to the
device profile" promise was doc-vs-code drift. Closed by: a persisted
`cameraAlignment?: CameraAlignment` on `DeviceProfile` (`camera-alignment.ts`
normalizer, same untrusted-JSON discipline as `cameraCalibration`; the type
records the pixel `basis: 'raw' | 'rectified'` because composing a rectified
frame with a raw-basis homography would silently mis-register), an explicit
"Save & show on canvas" action in the aligned Falcon view, and
`WorkspaceCameraOverlay` mounted as a canvas-area sibling that re-computes the
canvas's own fit-to-bed view from its measured box (Workspace is untouched).
Overlay sources: a captured still (LightBurn's Update Overlay model, the
accurate default-to-be once rectified alignment lands) or the continuous live
video; panel controls cover show/hide + fade + still/live. Material-thickness
shift compensation and the rectified-basis alignment flow are follow-ups
(ADR-109 scope).

---

## ADR-109 — Camera Mode v3: automatic marker alignment (no-click homography)

**Status:** Accepted; shipped with tests. | **Date:** 2026-07-03

### Context

ADR-107 reserved v3 for "fiducial auto-align," rejecting ArUco decoders on
licence (LGPV-bundle) grounds. The v2.b work shipped a proven clean-room
X-corner detector — which is itself a fiducial detector if the fiducials are
checker patches. Manual 4-point alignment (clicking bed corners in the frame)
remains as the fallback and the Falcon path (its cross-origin frames block
pixel readback, so no client-side detection is possible there).

### Decision

1. **Markers = five 2×2 checker patches**, engraved at known bed coordinates
   (`generateCameraAlignPattern`, flowing through the normal generator →
   preview → burn pipeline). Each patch centre is a literal X-corner for the
   existing detector. 10 mm cells keep the sub-pixel refinement window inside
   one cell even at ~1.3 px/mm camera resolution (smaller cells measurably
   biased the corner by ~1.5 px in the harness).
2. **The origin target is a patch PAIR** (two patches, 30 mm apart, midpoint =
   target): the unique tight pair disambiguates camera rotation — including a
   180°-mounted camera — with zero user input. Detection = top X-corner
   candidates → the dominant closest pair → remaining three singles → points
   ordered clockwise from the origin (a physical camera never mirrors, so
   image-clockwise equals bed-clockwise).
3. **Rectify before aligning when a lens calibration exists.** The alignment
   then lives in the rectified basis (`CameraAlignment.basis`), giving
   distortion-free registration bed-wide; without calibration the raw-basis
   homography is exact at the four targets and slightly bowed between them.

### Verification

Rendered-frame harness (plane renderer shared with the board fixtures):
detection finds all four targets in layout order for fronto / tilted / 180°-
rotated cameras (≤1.5 px vs projected truth); typed failures for a blank bed
and a missing origin pair; solved homography registers a mid-bed probe to
< 2 mm raw-basis under a mild lens, and < 0.7 mm bed-wide in the rectified
flow. NOT verified on real hardware: engraved-marker contrast/lighting and
the physical burn-vs-overlay registration — the maintainer's F-CAM4 pass.

### Out of scope

Print-and-cut (2-point re-registration of a printed sheet) — the natural v3.5
follow-on now that marker detection exists; capture-to-trace stays ADR-110.

---

## ADR-110 — Camera Mode v4: capture-to-trace at true bed coordinates

**Status:** Accepted; shipped with tests. | **Date:** 2026-07-03

### Context

ADR-107 reserved v4 for capture-to-trace. The prerequisite geometry all
exists now: rectification (v2), a persisted basis-tagged alignment (overlay
wiring), and the marker auto-align (v3). LightBurn's equivalent traces a
camera capture the user then positions manually; because our warp lands in
bed coordinates, the trace needs no positioning at all.

### Decision

1. **Warp the aligned frame top-down into bed-mm space** (`warp-to-bed.ts`,
   pure core): output→input sampling through the INVERSED homography
   (`invertMat3`, adjugate), reusing the rectifier's bilinear sampler so the
   two resamplers cannot drift. Off-frame pixels stay transparent.
2. **Basis discipline is enforced, not assumed** (`trace-from-camera.ts`): a
   rectified-basis alignment de-fisheyes the capture first and REFUSES to run
   without a calibration; a raw-basis alignment uses raw pixels. Mixing bases
   would silently mis-register — the same rule the overlay follows.
3. **The RasterImage's bounds ARE the bed** (4 px/mm), so the existing trace
   dialog and pipeline (ADR-100) need zero changes and traced vectors land at
   the photographed object's true machine coordinates.

### Verification

Core closed loop: render a camera view of the marker bed → auto-align from
pixels → warp top-down → re-detect the markers in the warped image → they sit
at their true bed coordinates (< 0.75 mm at 2 px/mm). UI decision tests cover
the typed failures (no alignment / basis mismatch). NOT verified on hardware:
a real photographed object traced and burned back in place — the F-CAM5 pass.

## ADR-111 — CNC beginner-mode UX pack: material picker, machine auto-fill, limit advisories, Basic/Advanced disclosure (Phase H.13, 2026-07-04)

**Status:** accepted (maintainer directive after a real 4040 cut wandered:
"Is this the easiest for a user to understand? … Can some of it
automatically be filled in with machine detection?"). Chosen scope: the
full beginner-mode set (#1–#4). Diagnosis pointed at mechanical/setup
causes, but the panel made cut-wrecking numbers *easy* — it accepted feed
1000 / depth-per-pass 1.5 for 6 mm ply on a 1/8" bit with zero guidance.
The KerfDesk panel is a powerful LightBurn/VCarve-style surface (every
number exposed, all manual); Easel/Carbide are friendlier because they
auto-fill feeds from a material, hide advanced fields, and pull limits from
the controller. This pack adds those affordances without removing any pro
control.

### Decisions

- **#1 Material picker (layer card).** A "Material" select
  (`Custom` + `CHIPLOAD_MATERIALS`) at the top of each CNC layer card. On
  pick, `calculateFeeds()` (ADR-103 chipload engine, unchanged) fills
  feed / plunge / depth-per-pass from the layer's bit and current RPM,
  under a **2-flute** one-click assumption; the advanced Feeds calculator
  keeps full flute/RPM control. `CncLayerSettings.materialKey?: string`
  records the choice (display/round-trip only — absent = manual "Custom",
  byte-identical output); normalize validates it against the material set.
- **#4 Basic/Advanced disclosure.** A persisted `showCncAdvanced` flag
  (localStorage; default **Basic = false**) gates the advanced field group
  (feeds, stepover, pocket fill, cut-type tails). Basic keeps Material, Cut
  type, Bit, Cut depth, Tabs. A one-click **Through cut (= N mm)** button
  sets cut depth to the stock thickness — disambiguating the
  cut-depth-vs-stock-thickness pair. The two "Spindle" fields are
  relabelled: the machine's "Spindle max" is the RPM ceiling (GRBL $30);
  the layer's "Spindle" is that layer's running speed.
- **#3a Machine auto-fill.** An opt-in "Machine reports …" banner on the
  Material & Bit card, shown only when the connected controller's detected
  `$$` values differ. Apply writes spindle max ($30 → `params.spindleMaxRpm`)
  and bed size ($130/$131). **Correction to the plan:** bed lands on the
  shared `project.device` (bedWidth/bedHeight), NOT on `stock` — the stock
  is the workpiece on the bed, not the machine envelope, and
  `CncMachineConfig` has no bed field. Never silent; the banner disappears
  once values match.
- **#3b Limit advisories.** At Save/Start, `detectCncMachineLimitWarnings`
  compares the job against the detected limits: stock larger than reported
  travel, and a layer feed above the reported max rate ($110/$111). Both
  advisory (not a gate), like the H.2 stock-footprint advisory. Kept a
  **separate module** from `detectCncStockWarnings` (toolpaths vs stock)
  for single-responsibility, rather than the plan's "extend" wording. The
  live snapshot threads through `detectMachineJobWarnings(project,
  controllerSettings?)` (defaults null → callers unchanged).

### Out of scope

Saving custom materials (a future CNC Material Library reusing a
`CncLibrary.materialPresets` slice); an inch/mm field toggle (the canvas
already has one; fields stay mm).

### Verification

Unit tests (material-apply + normalize round-trip; through-cut helper;
detected-apply thresholds; limit-advisory thresholds) and jsdom component
tests (material pick fills feeds; Basic hides advanced; detected Apply
patches params + device, leaves stock untouched). Full gate per commit.
Perceptual pass in an isolated preview: Basic/Advanced toggle, material
pick fills safe numbers (not 1000/1.5), injected `controllerSettings` shows
the Apply banner + stock/feed advisories. Defaults improve, but the
physical cut stays CLAIMED per ADR-098 §3 — the operator owns clamping,
work-zero, and the actual feed the machine can survive.

## ADR-112 — Project-level CNC material picker: set material once for the job (Phase H.14, 2026-07-04)

**Status:** accepted (maintainer follow-up to ADR-111: on the live app, opening
CNC mode showed only the dense machine "Material & Bit" panel and no material
picker — the ADR-111 picker is per-layer and invisible until a design is
imported, and the panel titled "Material & Bit" had no material control at all).
Chosen fix (maintainer): a project-level picker in that panel, Easel-style.

### Decisions

- **Project material lives on the stock.** `CncStock.materialKey?` — the
  workpiece's material, chosen once. NOT compiled directly (feeds still live
  per-layer); display + seed only, round-trips in `.lf2`. Bed/stock separation
  from ADR-111 §3a holds: this is the material ON the bed, distinct from the
  per-layer feeds it fills.
- **Picker in the Material & Bit panel**, above Bit — the two "what am I
  cutting" selectors together, present the moment you enter CNC mode. Picking a
  material runs `applyCncStockMaterial`: auto-fills feed/plunge/depth-per-pass
  for **every** current layer (its own bit + spindle, 2-flute) in one undoable
  step. "Custom" clears the association and leaves feeds for hand-tuning.
- **New layers seed** from the project material: manual Add and SVG import both
  seed via the shared `seedLayerFromStockMaterial`, so the Easel flow (set
  material → import) brings layers in with safe feeds. Text/drawn-shape inserts
  do NOT seed — consistent with them not taking laser layer-defaults either; a
  documented minor follow-up, not a silent gap.
- **Per-layer override preserved.** The ADR-111 per-layer Material picker still
  overrides a single layer; the project picker sets the default/bulk.
- **DRY:** `isChiploadMaterialKey` extracted to `core/cnc` (the layer + stock
  normalizers and the picker all validate against it).

### Out of scope / follow-ups

Seeding text and drawn-shape inserts; a "mixed" indicator when layers diverge
from the project material; saving custom material presets (still ADR-111's
deferred CNC Material Library).

### Verification

Unit: validator table; stock round-trip + drop-unknown; pure apply (layer
fill/no-op, project set/clear/laser-noop, seed on/off) with feeds computed via
calculateFeeds (not pinned magic numbers). Store: action fills + dirty + undo;
seeding on manual Add + SVG import; no-material = no cnc block (byte-identical).
jsdom: the panel renders the dropdown and picking sets the stock material. Full
gate per commit. Live browser NOT driven into CNC mode (shares the maintainer's
scene, CLAUDE.md §4). Physical cut CLAIMED per ADR-098 §3.

## ADR-113 — Region-enhance re-trace (dialog boundary mode) (Trace fidelity, 2026-07-05)

**Status:** accepted (maintainer-directed follow-up to the trace-fidelity work).

### Context

Small features inside a large raster sit at the tracer's detection floor: a
~67px² letter counter in a 1024px logo drops out at native size. The whole-image
auto-upscale can't rescue it — `shouldUpscaleSmallSource` gates on
`max(w,h) < SMALL_SOURCE_EDGE_PX = 100` (`auto-upscale.ts`), so a 1024px source
is never supersampled, and quadrupling a 1024px buffer for one small feature is
the exact cost that gate exists to avoid. The dialog already had a
LightBurn-style **Boundary crop** (box a region → the trace contains ONLY that
region's paths, `traceImageRegion`), reachable from `retraceOriginalAction`
("Re-trace Original") with the retained source raster.

### Decision

Add a **second boundary mode** rather than a new canvas tool. The boundary box's
mode is a stringly union `BoundaryMode = 'crop' | 'enhance'` (no boolean flag):

- **`crop`** (default, LightBurn parity): unchanged — delegates to
  `traceImageRegion`, result is just the region.
- **`enhance`**: trace the FULL image, re-trace the boxed **source** region
  supersampled 2×, and patch the re-traced geometry back into the full trace so
  the small feature is recovered while the rest of the trace survives. The pure
  merge lives in `core/trace/region-enhance.ts` (`enhanceRegionPaths`); the
  worker-backed orchestration is `src/ui/trace/region-enhance-trace.ts`
  (`traceImageWithBoundaryMode`), which injects the app's worker tracer into the
  pure core.

The **venue is the existing dialog**: it reuses `retraceOriginalAction` and the
boundary-box UX (drag to box, Clear Boundary), so no new tool, command, or canvas
surface is introduced. The mode toggle is visible only when a boundary exists;
clearing the boundary resets the mode to `crop`. Default stays `crop`.

**Why 2×** — mkbitmap's documented sweet spot ("a greyscale image contains more
detail than a bilevel image at the same resolution"); 3×+ invents detail. Capped
per `computeRegionUpscaleFactor` at 1× if the 2× crop would exceed
`MAX_UPSCALE_SOURCE_PIXELS`. **Margin-ring merge rule**: the region is shrunk by
`REGION_EDGE_MARGIN_PX` before the swap so crop-edge fragments (which hug the
border) and larger outlines crossing the box both keep their original geometry;
only polylines fully inside the shrunk interior are dropped/replaced, merged by
colour key.

### Consequences

- **LightBurn divergence, maintainer-sanctioned.** LightBurn's answer to a
  dropped small feature is manual node-editing; it has no region-enhance re-trace.
  The maintainer sanctioned this divergence as a fidelity win, so it is a
  deliberate choice, not a bug against the LightBurn reference.
- The full-image trace runs twice in enhance mode (once whole, once on the crop);
  acceptable because enhance is an opt-in on a user-boxed region, not the default.
- The core merge is unchanged by this ADR (it landed earlier); this ADR is the
  UI seam + venue decision only.

### Verification

Unit: `region-enhance-trace.test.ts` (crop delegates unchanged with one trace;
enhance runs the full trace + supersampled crop trace and patches — a
region-contained polyline replaced, an outside one survives). Preview:
`use-trace-preview.test.ts` (enhance mode reaches the preview path; the ready
state reflects the patched trace). jsdom: `ImportImageDialog.workflow.test.ts`
(the mode toggle renders only after a region is boxed, defaults to Crop). Full
gate per commit. **NOT verified perceptually this session** — the rendered
recovery of the real logo counter against the source is the maintainer's
perceptual pass (CLAUDE.md §2); green tests are not fidelity proof.

## ADR-114 — Commercial legal pack: EULA, installer acceptance, shipped third-party notices (2026-07-05)

(ADR-113 is reserved by the trace-fidelity track on its own branch; this entry
deliberately skips it to avoid a repeat of the ADR-094/ADR-106 collisions.)

**Context.** The 2026-07-05 release audit found the product legally unsellable:
the repo LICENSE (ADR-018) affirmatively denies everyone the right to *use* the
software and no EULA, terms surface, or machine-safety disclaimer existed
anywhere a customer could see. Separately, the bundled Roboto (Apache-2.0) and
three OFL-1.1 fonts plus all nine production npm packages shipped without the
license texts their licenses require — THIRD_PARTY_NOTICES.md covered only the
Rayforge camera adaptation and was not bundled.

**Decision.**
1. `public/eula.txt` is the customer-facing End User License Agreement: use
   grant, restrictions, machine-safety warning, warranty disclaimer, liability
   cap, third-party pointer, termination. It ships in every bundle (vite
   `public/` → `dist/web`, which electron-builder packs) and the NSIS
   installer requires acceptance (`nsis.license`). The repo LICENSE (ADR-018)
   still governs the *source*; the EULA governs the *distributed binary* —
   they are complementary, not conflicting.
2. `scripts/generate-third-party-notices.mjs` builds
   `public/third-party-notices.txt` from real sources — each production
   dependency's `node_modules` LICENSE verbatim plus each font's name-table
   copyright record — with the canonical Apache-2.0/OFL-1.1 full texts
   committed under `scripts/license-texts/` (downloaded from apache.org and
   openfontlicense.org). `build:web` regenerates it and the generator fails
   loudly on a missing LICENSE, so a new dependency cannot ship un-attributed.
3. The About dialog names both files and carries a short safety notice.

**Consequences.** The EULA text is an engineering draft: it must be reviewed
by a lawyer before the first sale (jurisdiction/governing-law clause is
deliberately absent). First-run in-app acceptance (web) remains open — the
web bundle surfaces the EULA via About, not a blocking dialog; revisit when
the storefront exists.

## ADR-115 — Edge Detection engine: local-contrast mask + potrace geometry (Trace fidelity, 2026-07-05)

**Status:** accepted (maintainer-directed after rejecting ADR-059's letter quality).

### Context

The maintainer's perceptual pass on the live app rejected the Canny-chain
Edge Detection engine (ADR-059): serif letters traced with hooked/curled
spur artifacts at serif tips, wandering contours cutting across serifs,
blobby small letters, and a dropped letter counter. Side-by-side renders on
the same logo pixels showed the failure was NOT detection (Canny finds the
ink) but GEOMETRY SYNTHESIS: the thin → stroke-graph → junction-weld →
spur-prune → chain pipeline manufactures the artifact classes, and every
prior fix (apex snap, spur pruning, weld tuning, spline caps) was
whack-a-mole against that architecture. The clean-room potrace backend
(Line Art) traced the same letters cleanly — but its global 128 threshold
drops faint ink (the LANGEBAAN letters run luma 125-195; a Canny-fill probe
measured ~88k ink pixels the global threshold misses on this logo).

A Canny-loop-fill mask was prototyped and REJECTED: closing edge loops
morphologically consumes small interior holes (letter counters) — the exact
detail at stake. The winning mask is mkbitmap's design (potrace's own
companion preprocessor): local-contrast thresholding.

### Decision

`traceImageToEdgePaths` becomes: **local-contrast ink mask → shared potrace
geometry.**

- `local-contrast-mask.ts`: ink = darker than the local box-blur mean by
  `delta`, unioned with the global 128 threshold (solid interiors read ~0 in
  a highpass, the union keeps them filled). No morphology — a 3px counter
  survives any radius.
- `potrace-trace.ts` exports the extracted `potraceBitmapToPolylines`
  geometry stage (scan → polygon → curve → optimize → apex snap), now shared
  by Line Art/Smooth/Sharp AND Edge Detection.
- The Canny-era option fields remain the public knobs; the engine derives
  its parameters from them so dialog/presets/merge are untouched:
  low threshold ratio → delta (0.074 → 6, clamp 2..12), blur sigma → radius
  (1.2 → 12, clamp 4..32), edgeMinLengthPx → potrace turdSize.
- **Output is closed contours only** — LightBurn's trace semantic (its
  tracer is potrace-based). The chain engine's open-stroke output is gone;
  thin strokes trace as thin outline rings, as LightBurn does.
- **Seam-invariant fix in `potrace-apex.ts`** (latent Line Art bug exposed
  by the rebuild): `snapCornersToInk` deduped a ring's closing point and
  never re-appended it, so every apex-rebuilt ring shipped `closed: true`
  with first ≠ last — while job compilation documents closed segments as
  "last equals first by construction" and the emitters draw points as given
  (cornered shapes engraved with their final edge missing). Snapped rings
  now re-append the (possibly moved) start vertex.

### Consequences

- The maintainer's reported artifact classes are gone at the engine level:
  serif feet hug (no smile arcs), no hooks/spurs, and the LANGEBAAN counter
  census reads 2/2/2 at NATIVE resolution — the defect ADR-113's
  region-enhance was built to patch no longer occurs on this logo, so
  region-enhance becomes a general-purpose recovery tool rather than the
  counter fix.
- Benchmark recalibrations (documented in arch-house-edge-benchmark.ts):
  `langebaanExcessTurnPer100Px` target 12 → 135 — the old target measured
  the spline engine's evened curvature, which turned smoothly precisely
  because it melted letters; potrace's polygon style measures ~117 while
  rendering every letter legible. `openPolylineCount` expectation flips
  > 10 → 0 (all-closed by construction). Disc radial RMS 0.12 → 0.15
  (measured 0.135; the ridge-snap sub-pixel pass no longer exists; 0.015px
  is far below laser resolution).
- Orphaned modules pending a separate cleanup commit: `canny-edges.ts`,
  `edge-subpixel.ts`, `edge-ink-support.ts` (no remaining app importers;
  their tests still pass; `edge-reconnect.ts` was deleted in ARC-07). The
  centerline pipeline
  keeps its chain machinery (its own mode) including the spline deviation
  cap from the earlier fidelity fix.
- Known residuals accepted from the render review: small junction notches
  on ~10px G/E glyphs and occasional ~1px foot ticks — polygon-style output
  at glyph sizes near the information floor.

### Verification

Test-first on the seam bug (edge ring measured 14px first→last before the
fix; potrace-apex pins the invariant). Engine contract tests rewritten
against real semantics (sensitivity gates a contrast-8 bar; Detail radius
fills vs hollows a broad faint square; disc smoothness rebaselined with
measured values). Full trace + perceptual suites 328/328; renders of
np-house-H / np-house-all / np-lang-all read and compared against the
baseline (serifs hug, letters legible, counters present) — the maintainer
saw the prototype renders and approved the architecture before
implementation; the final engine renders await the maintainer's own pass.

## ADR-116 — Box generator v2: panel cutouts, divider grid, slide lid (2026-07-07)

**Status:** accepted (maintainer directive: "I need my box designer to be
a full broad tool"). Builds on ADR-106; scope lands here before code.

### Context

The v1 generator ships two styles (closed, open-top) on an engine whose
hard parts — per-edge complementary sequences, corner-cube arbitration,
uniform-offset fit, corner-overcut relief, and the virtual assembly
referee — are style-independent. The single blocker between v1 and the
broad-tool tier (dividers, lids, hardware mounts) is that a `BoxPanel`
carries exactly ONE outline ring: ADR-106 said "no holes in v1". This
ADR adds interior cutouts once, then spends that capability on the two
most-requested styles. Behavior references: boxes.py docs and MakerCase
(reverse-engineering study only — boxes.py is GPL, no code copying,
ADR-017).

### Decision 1 — panel cutouts (the enabling upgrade)

- `BoxPanel` gains `cutouts: ReadonlyArray<Polyline>` (closed interior
  rings in the same sheet frame as the outline).
- **Insertion changes carrier:** panels insert as `kind:'imported-svg'`
  vector objects (the established carrier for baked generated geometry —
  dogbone/weld precedent), one `ColoredPath` holding outline + cutout
  rings. This is chosen over per-ring shape objects because (a) even-odd
  fill semantics make cutouts real holes under Fill mode, (b) compile-time
  kerf offset is already containment-aware for hole rings
  (`kerf-offset.ts`), and (c) the `source` field ("Box panel: Front")
  finally carries panel names into the scene — closing the v1 gap where
  `SceneObject` has no name field. Undo/selection semantics unchanged
  (one undo step, all panels selected). The generator's own insert path
  never routes through `importSvgObject`, so Phase C re-import
  replace-by-source semantics cannot trigger on generated panels.
- **Fit generalizes for free:** the −c/4 clearance offset on correctly
  oriented multi-ring polygons shrinks material and therefore WIDENS
  every cutout by c/4 per flank — exactly the slot play the joint
  contract requires. Corner relief extends to cutout rings: every
  slot corner a mating tab must seat against gets the F-CNC26 overcut
  at full bit radius, same post-offset ordering.
- **Referee extension:** slot bands. A junction between a tabbed part
  and a slotted panel is checked like a cube edge: one shared sequence,
  exact complementarity at c = 0, uniform play/2 flank gaps otherwise,
  zero interference always.

### Decision 2 — divider grid

- `BoxSpec` gains `dividersXCount` / `dividersYCount` (0–N, evenly
  spaced partitions across width / depth; 0 = v1 output, byte-identical).
- Divider panels stand on the bottom panel (no bottom slots in v2),
  height = inner height, and carry tabs into **through-slots** in the
  two walls they meet — through-slots are the standard laser-box
  aesthetic; half-depth dados are CNC 2.5D work and stay deferred.
  Tab/slot layout reuses `edge-pattern` over the divider junction height
  (odd cells, divider owns the odd cells), so complementarity is by
  construction, exactly like cube edges.
- Divider×divider intersections use egg-crate cross-laps: X-dividers
  notched half-height from the top, Y-dividers from the bottom, notch
  width T (widened by the clearance pass like any recess).
- Validation: resulting compartment pitch must exceed 2·T and, for CNC,
  the slot/notch cells must clear the relief tool (same rule family as
  ADR-106).

### Decision 3 — slide lid

- New style `'slide-lid'`: bottom, back, slotted left/right walls,
  front wall shortened to the slot floor, plus a loose lid panel.
- Geometry (refined at V3 build): outer height = inner + 3T — bottom,
  cavity, lid band, and a captive top strip. The side walls carry a
  C-channel spliced into their solid front edge at the lid band,
  stopping one thickness INSIDE the wall body (stopping at the body end
  would leave a zero-width neck — the fit offset severs it, which is how
  the referee caught the draft geometry). The lid slides over the
  shortened front and stops against the in-wall post; lid = full outer
  width × (outer depth − 2T), leading edge carries a half-round thumb
  notch built with on-edge-exact endpoints (no clipper).
- A slide lid must SLIDE: validation requires clearance > 0 for this
  style (defaults stay 0.15 mm CNC; laser default rises to 0.2 mm for
  slide-lid only). The referee gains a mandatory-play check for the
  lid/slot bands and a lid-clears-front check.

### Staged diffs (each independently reviewable + CI-green)

- **V0 — docs:** this ADR, PROJECT.md Phase K.2 block, WORKFLOW.md
  F-K6/F-K7 flows.
- **V1 — cutout infrastructure:** `BoxPanel.cutouts`, multi-ring
  panel-fit (offset + relief across rings), named `imported-svg`
  insertion (amend F-K1's carrier wording in the same diff — flows
  describe shipped behavior), referee slot bands, benchmark category
  `cutouts`.
- **V2 — dividers:** divider spec + validation, wall-slot claims,
  divider outline builder (tabs + cross-laps), dialog fields + preview,
  referee divider bands, benchmark category `dividers`.
- **V3 — slide lid:** style + geometry, mandatory-play validation,
  dialog style option, referee lid checks, benchmark category
  `slide-lid`.
- **V4 — closeout:** AUDIT rows (CLAIMED + named hardware checks: cut an
  organizer with 2×1 dividers and a slide-lid box, assemble and slide),
  session report, PROJECT status flip.

### Out of scope (each needs its own ADR)

Lift-off lip lids, hinged lids and living-hinge curved boxes, polygon
prisms (hex/octagon), dovetail/angled fingers, CNC dado/rabbet 2.5D
joinery, T-slot bolt+nut joints, bottom slots for dividers, engraved
panel labels (io/text). Named so they are deferred, not forgotten.

### Verification

Same regime as ADR-106: every new junction type gets exact-referee and
play-referee coverage; the seeded benchmark extends (new categories must
score 100% and the v1 categories must stay 100% — no style may regress
another); perceptual fixtures per new style; determinism over the
enlarged spec space; physical fit stays CLAIMED until the named cuts.

## ADR-117 — Keep-awake during active jobs: renderer screen wake lock, Electron permission allowlist (2026-07-07)

**Status:** accepted. (Renumbered from a draft ADR-116 after the box-generator v2 pack claimed that number on main the same day.)

### Context

A long job streams G-code over Web Serial for hours from a renderer
process. OS display sleep can throttle or suspend that renderer mid-burn;
the 5-second stream-stall watchdog detects the freeze but cannot prevent
it. The 2026-07-07 multi-layer-job trust audit listed missing endurance
protection as a gap — and the follow-up investigation found the feature
was already half-shipped, undocumented: `useActiveJobWakeLock` (App-mounted,
laser-store-subscribed, visibility re-acquire) had landed without an ADR,
WORKFLOW flow, or AUDIT row, and was **provably dead on the desktop app**:
Electron routes `navigator.wakeLock.request('screen')` through the session
permission handlers as the string `'screen-wake-lock'`
(`shell/common/gin_converters/content_converter.cc`, verified on the
shipped 42-x-y source), the deny-by-default trusted-renderer policy
(serial + `fileSystem*` only) rejected it, and the hook's best-effort
`catch` swallowed the denial silently. The operator had no signal either
way.

### Decision

- Keep-awake stays a **renderer** concern via the standard Screen Wake
  Lock API — one implementation serves web and desktop. **No main-process
  `powerSaveBlocker`**: it would need IPC to track job state, and the
  security posture's zero-`ipcMain` surface is worth more than the
  marginal extra blocking strength.
- `trusted-renderer-policy.ts` allows `'screen-wake-lock'` alongside
  `serial` and `fileSystem*` — still gated to trusted origins and the
  main frame; Chromium grants it without a prompt.
- Lock lifecycle is bound to `isActiveJob` (streaming | paused | done |
  errored, until the post-job Idle clears the streamer): acquire on
  activation, re-acquire on `visibilitychange` and UA-initiated release,
  release on job end and dispose.
- Failure is non-blocking and **visible once**: a single LaserLog line
  ("Keep-awake unavailable — the OS may sleep the screen mid-job") on the
  first denial or missing API, so a marathon burn is never silently
  trusted to a machine that will sleep. Retries stay quiet.

### Consequences

- Desktop keep-awake goes from silently denied to granted; web behavior
  is unchanged. The permission surface grows by exactly one prompt-free
  Chromium permission.
- A screen wake lock keeps the display (and with it, the system) awake on
  typical setups, but cannot survive a lid close or manual sleep — the
  log line tells the operator to disable system sleep before long burns.
  Supervised operation remains the rule for laser jobs regardless.
- No new dependency, no IPC handlers, no platform-adapter surface: the
  Wake Lock API is identical in both delivery targets.

### Verification

jsdom hook tests pin acquire/release/re-acquire and the one-shot warning
(denied + missing API); policy tests pin `screen-wake-lock` granted for
trusted check+request and denied for untrusted origins and subframes.
NOT verified: the packaged Electron runtime grant, and a real hours-long
burn with display sleep armed — CLAIMED in AUDIT.md until the maintainer
runs one.

## ADR-118 — Interrupted-job checkpoint: fingerprint-verified resume after a crash (2026-07-07)

**Status:** amended (repository schema v3, versioned exact-artifact provenance, and execution
archive, 2026-07-19).

### Context

If the app dies mid-stream (tab crash, OS kill, power blip), the job is
simply gone from the app's point of view: the operator must guess which
G-code line the machine stopped at and enter it into Start-from-line by
hand. The 2026-07-07 trust audit called this out (gap 3b): for a
multi-hour job, "guess the line" is the difference between salvaging a
workpiece and scrapping it.

The original v1 stored only a fingerprint and acknowledgement count, then
recompiled the open autosaved project. That was not an isolated recovery
record: project restoration, scope/origin drift, global Start blocking, and
controller-session residue could all affect an unrelated current job. Recovery
therefore needs an exact immutable execution artifact and separate ownership
from the live editor/controller state.

### Decision

- Store recovery in a versioned IndexedDB repository. Its operational owners are
  the exact `activeRun`, zero or one interrupted `recoveryCapsule`, zero or one
  clean `lastCompletedReceipt`, and one short-lived `pendingStart` write-ahead
  slot introduced in repository schema v2. Immutable artifacts are keyed by a
  unique `runId`; progress and terminal writes must own that identity, so jobs
  with equal line counts cannot update one another.
- Repository schema v3 also owns a bounded, oldest-pruned `executionHistory` of
  completed and interrupted runs. It normally retains at most 20 runs and 100 MiB
  of estimated full artifact payload. The newest run and any active, recovery,
  replay, or pending-Start owner remain protected even when one protected record
  temporarily exceeds those ordinary limits.
- An exact artifact contains emitted G-code and fingerprint, materialized output,
  output scope, resolved origin, streaming/device configuration, canvas/tool
  plans, and (for CNC) the prepared semantic job and recovery manifest. Archived
  controller observations are diagnostics only: they are never written to
  firmware or copied into the open profile/session.
- Current exact-artifact schema v2 requires provenance schema v2. It binds the
  exact G-code, canonical machine profile, build/transport/controller evidence,
  workflow/review evidence, and archived controller observation with SHA-256.
  Stage, hydration, archived reads, and export decoding all validate those
  bindings. The IndexedDB v1→v2 upgrade adds an outer
  `pre-provenance-db-v1` origin only to exact schema-v1 records already present
  in the old database. New writes carry `current-v2`; stage, archive/export, and
  external decode accept only that origin with schema-v2/V2 provenance. Exact
  schema-v1 artifacts always fail closed at runtime, including records tagged by
  the upgrade: the outer IndexedDB origin remains mutable and cannot prove that
  a payload genuinely predates provenance. Fingerprint-only legacy capsules stay
  non-executable and may use only the separately gated current-project fallback.
- Raster row providers are materialized into typed arrays before persistence so
  recovery storage is structured-clone safe. Artifact capture caps the combined
  raster payload at 32 MiB before calling any row provider and bounds the complete
  artifact (G-code, embedded project images/fonts, plans, and binary data) at a
  conservative 64 MiB allocation-free estimate. A larger executable job continues
  without recovery/archive capture and shows the existing forensic-record warning
  instead of allocating an unbounded archive copy before Start.
  The read-only Execution archive can export a retained exact artifact as `.lfexecution.json`; its versioned
  tagged-binary envelope preserves typed arrays, hashes every encoded field, and
  never recompiles or overlays live editor/controller state.
- Fresh Start stages the artifact before the first write, but does not replace an
  older capsule. Only transport acceptance activates the new run and supersedes
  the older capsule. A refused preflight, operator cancellation, settings error,
  or failed first write deletes the staged artifact and preserves the capsule.
- Startup reconciles an unresolved `pendingStart` as the newest interrupted
  candidate with zero diagnostic acknowledgements. This deliberately prefers a
  possible false-positive recovery prompt over offering an obsolete source after
  a newer program may have begun. A short owner lease prevents a second live tab
  from classifying an in-progress handoff as a crash. Schema-v1 slots migrate
  without dropping their active, recovery, or replay ownership.
- The App-mounted tracker advances only the live `activeRunId`, throttles ordinary
  progress writes, and moves terminal streams to the capsule. A progress commit
  patches the already-verified in-memory active record only when its generation,
  slot revision, and run identity match the transaction base; cross-window drift
  falls back to an authoritative slot refresh, hydrating only new or unverified
  artifacts. This avoids re-reading and hashing a large immutable artifact every
  25 acknowledgements without weakening cross-tab ownership. Clean completion
  requires all acknowledgements, controller-specific settlement, and fresh stable
  Idle; only then is a replay receipt created. A terminal event that races ahead
  of activation is deferred and retried after acceptance, without delaying or
  refusing the machine stream.
- Recovery storage failures are nonblocking warnings. Artifacts displaced from
  every operational owner and the bounded execution history are garbage-collected
  after an atomic slot transition. A deletion generation marker prevents an
  incomplete Forget purge from resurrecting old slots after reload.
- A staged artifact is integrity-checked before transmission and retained as verified
  in-memory evidence through durable activation. After the first controller write,
  activation updates slots without cloning or hashing the artifact again; immutable
  artifacts already verified in the current generation are reused for local mutation
  hydration. Public refresh/startup still rereads storage, and corrupt slots authorize
  an explicit fail-closed empty reset rather than being hidden by revision monotonicity.
- The former `laserforge.job-checkpoint.v1` localStorage value is migrated once as
  a nonblocking `legacy-fingerprint-only` capsule. It may use the old current-
  project fingerprint fallback only inside explicit recovery; ordinary Start,
  update prompts, and controller qualification never consult it.

### Consequences

- An interrupted run appears as the collapsed, non-red **Interrupted job saved**
  card. Review/open/close/cancel is read-only. Only the final explicitly confirmed
  supervised Start may claim and activate it.
- Laser recovery streams from the sealed exact G-code. CNC recovery uses the
  sealed prepared semantic job and manifest, never acknowledgement count as cut
  proof. Both require fresh qualification of the connected controller and
  physical setup.
- A claim is revision- and attempt-ID-bound across windows. Pre-acceptance failure
  releases it for retry; uncertainty after transmission begins becomes the newest
  interrupted attempt rather than poisoning the source capsule.
- Laser and CNC recovery pass a recovery-specific final authorization callback to
  the store's existing wire boundary. After all queue/live-state awaits and before
  streamer creation, it compares the prepared controller session, qualification,
  settings observation, position/status, WCO/origin, and Work Z evidence. Drift
  sends no recovery-program bytes, cancels `pendingStart`, and releases the claim.
- Ordinary **Start current job** always compiles the current canvas from line 1.
  Cleanly completed, still-exact work separately offers **Run same job again from
  start**, which recompiles, rechecks the signature/fingerprint, and creates a new
  run identity with zero progress and no recovery state.
- Completed and interrupted terminal runs appear newest-first in a read-only
  **Execution archive**. Export is forensic output only: it reads the retained
  immutable artifact, preserves raster binary payloads and recorded provenance,
  and sends no controller command.

### Verification

Repository tests cover multi-megabyte and bounded materialized-raster round trips,
immutable run ownership, bounded/protected execution history, claim conflicts,
legacy/corrupt/quota handling, deletion generation, repository schema migration,
real IndexedDB origin migration, coherent progress fast-path/cross-tab fallback,
pending-Start crash reconciliation, garbage collection, and completion/interruption
before activation. Integrity tests cover current provenance creation, legacy
compatibility, downgrade refusal, hash/profile/workflow/controller/buffer-observation tampering, and removal
of current provenance at stage, hydration, archive-read, and export-decode
boundaries. Flow/UI tests cover nonblocking ordinary Start, read-only
Review/Cancel, retryable failed recovery, exact replay invalidation, archive
display/export, and PWA independence. Hardware crash, air-cut recovery, and
physical CNC qualification remain release acceptance work.

### Amendment â€” schema v2: also store the output scope + job placement (2026-07-11, PST-02)

The original checkpoint stored only the fingerprint + acked counts. But resume re-compiles the project through `prepareStartJob`, whose bytes depend on the output scope (cut-selected-graphics + selection ids) and the job placement â€” and a crash resets BOTH to their defaults. A run that used a non-default scope/placement therefore recompiled to different bytes on resume, failed `fingerprintsEqual`, and dead-ended with a false "it was edited since" refusal exactly when a long selective burn most needed to resume. `JobCheckpoint` now also carries `outputScope` + `jobPlacement`, and `JOB_CHECKPOINT_SCHEMA_VERSION` is bumped 1 â†’ 2 so pre-existing v1 slots (which lack the fields) read as `null` and are discarded (transient â€” the only cost is one stale recovery prompt). `runCheckpointResumeFlow` passes the stored scope/placement into `prepareResume`, reproducing identical bytes; the manual Start-from-line path still uses current app state.

### Amendment â€” schema v3: store the RESOLVED job origin, not the placement settings (2026-07-11, R1)

PST-02 (v2) stored the placement SETTINGS (`{startFrom, anchor}`). That is byte-deterministic for Absolute / User Origin / Verified Origin, but NOT for `current-position`: `resolveCurrentPosition` freezes the live head XY into `JobOriginPlacement.currentPosition` at compile time, and on resume it re-resolved against the (moved) post-crash head, translating the job to a different origin and renumbering every line â€” reopening the exact false "it was edited" refusal for a normal placement mode (Codex re-audit R1). The checkpoint now stores the RESOLVED `jobOrigin` (a `JobOriginPlacement`, so a current-position run carries its frozen XY); `JOB_CHECKPOINT_SCHEMA_VERSION` is bumped 2 â†’ 3 (older slots read null and are discarded). `prepareStartJob` gained an optional `resolvedJobOrigin` override: a resume re-validates the live machine through the frozen origin's MODE (a vanished custom origin / unknown position still refuses) but COMPILES with the frozen origin so the bytes match the fingerprint. `prepareStartJob` surfaces the resolved `jobOrigin` on its ok result so the write site can capture it. An absent `jobOrigin` = Absolute (no translation).

### Amendment — transport-aware incident recovery and protected Start intent (2026-07-15)

The original safety banner offered the same **Recover controller** Ctrl-X action for every incident,
including a physically absent USB transport. That action could create another write-failure notice and
claim the global recovery operation while the only useful action—reconnect—was disabled. It also made
controller reset look like job recovery even though the durable checkpoint is a separate record.

- A lost/failed transport now offers **Reconnect controller…** and **I made the machine safe**. Ctrl-X
  is offered only for a connected controller that explicitly reports `Sleep`, and is labeled **Reset
  controller (does not resume job)**. Store-level defense refuses soft reset before mutating recovery
  state when no live transport exists. Connect/reconnect no longer clears the incident notice; only the
  operator acknowledgment does. None of these actions reads, clears, or advances the job checkpoint.
- Connection management remains an escape hatch during recovery and startup-handshake ownership. Other
  motion and job controls remain gated until the link and controller state are settled.
- Ordinary Start (including Ctrl+Return) remains independent of an archived interrupted-job record;
  opening or dismissing recovery does not import its settings, G-code, origin, Work Z, or machine
  observations. The neutral card offers **Review** and **Discard**; a separate line-one replay exists
  only after verified clean completion.
- Recovery Review is a temporary sandbox. Its final Start transaction claims the current run/revision
  with a unique attempt ID, validates the live controller, stages a new attempt artifact, and replaces
  recovery state only after transport acceptance. Pre-acceptance failure releases the claim; an
  uncertain post-write failure is itself the newest capsule.
- Laser recovery treats archived G-code as immutable source input but generates a fail-dark re-entry:
  `M5`/`S0` precede unpowered positioning, positive power returns only on burn motion, and session-bound
  live `$32` evidence is confirmed before the capsule claim and checked again at the wire boundary.
- Controller readiness is epoch-bound: disconnected → qualifying (response/reset cleanup/settings
  read) → qualified or failed. GRBL-family reset/reconnect/wake/probe/settings-write paths own one `$$`
  read after fresh Idle; late replies from prior epochs cannot qualify Start. Failure is shown inline
  with Retry/Reconnect instead of a generic settings-confirmation alert.
- **Ordinary Laser Start amendment (2026-07-17):** qualification remains the source of fresh
  controller evidence, but its incomplete/failed state is not itself a hard Laser Start gate.
  Missing `$30`/`$32` evidence follows the already accepted warning-and-acknowledgement path in Job
  Review, matching controllers that expose no numeric settings dump. A reported `$30` mismatch or
  reported `$32=0` remains blocking. An in-flight settings transaction still owns the serial channel
  until it settles. CNC Start and every supervised recovery keep the strict fresh-qualification
  requirement because spindle/WCS re-entry semantics cannot be inferred safely.
- **Forget Controller** safely stops when necessary, closes/revokes transport, advances epochs, and
  clears controller evidence, live execution, recovery/replay data, notices, errors, transcript, and
  logs while preserving the project, selected profile, libraries, and preferences. It is a logical app
  reset, not GRBL `$RST=*` or a physical EEPROM factory reset; uncertain motion retains a safety warning.
- A clean settled run retains an exact receipt. **Run same job again from start** remains available only
  while canvas/profile/scope/placement/execution signature match, then performs full fresh qualification
  and compilation and starts a new run ID at line 1.

## ADR-119 — Box designer usability pack: fit test coupon, assembled 3D preview (2026-07-07)

**Status:** accepted.
**Numbering note:** drafted as ADR-118, but the interrupted-job
checkpoint published 118 on `main` first — published numbers win
(ADR-104 precedent). Pre-merge commit messages say ADR-118; read them
as this ADR.

**Status detail:** accepted (maintainer: "yes build it" on the ranked
improvement assessment). Builds on ADR-106/116.

### Context

The generator's joints are referee-proven, but the clearance NUMBER is a
guess until material is cut — and the flat-sheet preview makes users
assemble the box in their heads. Both gaps close with existing
machinery: the calibration-tool family (Material/Interval Test) and the
generator's own placement model.

### Decision 1 — fit test coupon (Tools → Box Fit Test…)

- Pure core `fit-coupon.ts`: TWO strips. A comb strip carries N tabs on
  a graduated clearance ladder (default 0.05–0.30 mm, 6 rungs,
  start/step/count configurable); a slot strip carries the N mating
  notches. Rung i bakes the production fit law analytically — tab width
  f − cᵢ/2, notch width f + cᵢ/2, both T deep — so the rung that feels
  right on the bench IS the number to type into the Box Generator.
- Rung identification without text: i+1 index nicks (1 mm square)
  along the strip edge under each rung.
- CNC mode runs the slot strip through the shared relief pass
  (corner-overcuts at notch corners, full bit radius); validation reuses
  the box rules (f > tool, ladder < min(f, T)/2).
- Inserts as two named vector objects (imported-svg carrier), one undo
  step, same insertion path as box panels.

### Decision 2 — assembled 3D preview

- Pure core `assembled-layout.ts`: every generated part's 3D frame
  (origin, u/v basis, normal, slab offset) — walls from the documented
  drawing convention, dividers from their slabs, the slide lid from its
  channel band. This is the referee's placement knowledge exposed as a
  reusable layout (kept in sync by tests, not imports).
- UI: the Box Generator preview gains a Flat/Assembled toggle. The
  assembled view is a Canvas2D isometric projection (extruded plates,
  painter-sorted, even-odd fill so cutouts read as holes) — deliberately
  NOT three.js: a dialog preview needs no camera, no lazy chunk, and
  must render under jsdom guards like BoxPreview does.

### Verification

fit-coupon: exact per-rung width law (notch − tab == cᵢ), determinism,
benchmark category `fit-coupon` (must hold 100% alongside the existing
nine). assembled-layout: unit-pinned frames for every part kind across
styles. Preview: component tests (toggle, jsdom-safe render). Hardware
remains CLAIMED; the coupon exists precisely to make those cuts
informative.

---

## ADR-120 - MIT license, open-source release (supersedes ADR-018)

**Status:** Accepted | **Date:** 2026-07-07

### Context

ADR-018 made the source proprietary and the repo private while the
monetization model was undecided, and defined explicit reversal triggers.
The maintainer has now decided to open-source the project: community
adoption and contribution matter more than source control at this stage
(reversal trigger 3), and the zero-install web + desktop combination is
the product wedge, not source secrecy.

ADR-018's asymmetry argument still holds: public-then-private is not
reversible. This decision is made deliberately, with the tree cleaned
for public consumption first: internal audit reports, study notes, and
session plans removed from the published tree; competitor names removed
from public-facing copy per the standing neutrality policy.

### Decision

- **License: MIT.** `LICENSE` is the standard MIT text, copyright
  Johann Stolk. `package.json` declares `"license": "MIT"`.
- **Repo visibility: public** (the flip itself is a maintainer action on
  GitHub, executed after the release-blocking item below is resolved).
- **Dependency policy unchanged** (ADR-017): MIT-compatible licenses only;
  GPL-family dependencies remain rejected now because the combined MIT
  work must stay redistributable under MIT, not merely by policy.
- **EULA (ADR-114) reduced to a distribution notice.** With an MIT source
  license the restrictive use-grant/no-redistribution clauses are void;
  `public/eula.txt` becomes a License & Safety Notice (MIT grant reference,
  machine-safety warning, warranty disclaimer, third-party pointer). The
  NSIS installer continues to show it for safety-terms visibility.
- **THIRD_PARTY_NOTICES.md / public/third-party-notices.txt** reworded:
  first-party code is MIT, third-party components remain under their own
  licenses.

### Release blocker (RESOLVED by ADR-123)

The in-house potrace-style trace backend (`src/core/trace/potrace-*.ts`)
had unresolved provenance: a 2026-06-10 audit found its internals mirror
the GPL-2 potrace C implementation's details (helper names, constants,
pipeline order) with no provenance record. If that code was derived from
the GPL source, it could not be published under MIT. The three exits were
(a) replace the backend with a documented clean-room implementation,
(b) revert to the Unlicense imagetracerjs backend, or (c) establish and
record that the existing code was independently written. **Exit (a) was
taken: ADR-123 removed every `potrace-*.ts` module and routes all filled
presets through the in-house contour backend. This blocker is closed.**

### Alternatives considered

- **Apache-2.0:** adds a patent grant; heavier text. MIT matches the
  existing dependency ecosystem and the ADR-008 posture being restored.
- **AGPL-3.0:** protects against closed hosted forks but deters the
  hobbyist audience and contradicts the MIT-compatible dependency story.
- **Source-available (BSL):** not open source; fails the adoption goal.

### Verification

- `LICENSE` reads "MIT License" (this commit).
- `pnpm license-check` still enforces the ADR-017 dependency allow-list.
- `public/third-party-notices.txt` regenerated without proprietary wording.
- The potrace provenance blocker is closed by ADR-123 (the `potrace-*`
  modules no longer exist in the tree).

---

## ADR-121 - Machine-camera frames ride the loopback bridge: frame proxy and server-side discovery (Camera, 2026-07-07)

**Status:** accepted.
**Numbering note:** drafted on the camera branch as ADR-116, but `main`
published ADR-116 through ADR-119 first; published numbers win.

### Context

Camera Mode v1-v4 supported USB cameras and a direct HTTP image poll for
some machine cameras. The maintainer's machine camera exposed two missing
pieces: pixel-consuming features were gated on a USB `MediaStream`, and the
browser/direct-image route was blocked or tainted by CSP and CORS. The local
RTSP bridge already had the right security shape: loopback origin, CORS for
trusted app origins, and private-network policy checks.

### Decision

- Machine camera still frames go through the local bridge, not directly
  through the browser. `GET /frame.jpg?url=...` proxies one http/https/rtsp
  frame with trusted CORS headers and private-network restrictions.
- Discovery moves server-side through the bridge, so production CSP does not
  block camera probing.
- The UI consumes frames through one source abstraction: USB stream,
  machine-JPEG, or machine-RTSP. Calibration, auto-align, overlay stills,
  trace-from-camera, and snapshots all capture through that source path.
- The frame proxy rejects untrusted origins, recursive bridge URLs, redirects,
  and non-private targets before fetching upstream camera bytes.

### Verification

Bridge policy tests cover allowed and rejected URLs/origins, frame proxy
responses, PNA preflight, discovery, and health reporting. UI/source tests
cover machine-camera activation and pixel-readable capture. Hardware
verification remains a separate live-machine checkpoint.

## ADR-122 - Camera-driven positioning and burn-target alignment wizard (Camera, 2026-07-07)

**Status:** accepted.
**Numbering note:** drafted on the camera branch as ADR-118; renumbered here
because `main` already published ADR-118 and ADR-119.

### Context

Once machine-camera frames are pixel-readable (ADR-121), the camera workflow
still needs two operator-facing pieces: a guided target-burn alignment flow
and a way to act on what the overlay shows. LightBurn-style camera setup burns
its own target and then solves alignment; the app previously required more
manual orchestration.

### Decision

- Add a bed-alignment wizard that burns the five-marker target through the
  normal `runStartJobFlow`, watches the job finish, prompts the operator to
  clear the bed, captures a frame, optionally de-fisheyes it, detects markers,
  solves the homography, and persists the alignment.
- Add click-to-position: a crosshair workspace tool maps a canvas click
  through the same origin transform used by G-code emission, clamps inside the
  machine bed, and sends one absolute beam-off jog through the existing gated
  jog path.
- Keep absolute zero-valued jog words (`X0`, `Y0`, `Z0`) in absolute jog mode
  for GRBL, Marlin, and Smoothieware; in relative mode zero deltas still mean
  "do not move this axis."
- Add snapshot saving and a wider monitoring view using the shared
  pixel-readable capture path.

### Verification

Tests cover wizard store transitions, burn-step job-flow integration,
auto-align failure paths, click-to-position origin mapping and gating,
absolute zero-axis jog command emission, snapshot encoding, and camera panel
state. Live hardware alignment accuracy remains a separate checkpoint.

---

## ADR-123 — Own-engine trace: remove the potrace-derived backend (closes the ADR-120 blocker)

**Status:** Accepted | **Date:** 2026-07-08

**Numbering note:** drafted as ADR-122, renumbered to 123 because the camera
branch published ADR-121/122 to `main` first (published numbers win, ADR-104
precedent).

### Context

ADR-120's one release blocker was `src/core/trace/potrace-*.ts` (~2,369
lines): a 2026-06-10 audit found the internals mirror the GPL-2 potrace C
implementation (helper names, constants, pipeline order) with no provenance
record, so the code could not ship under MIT. ADR-120 listed three exits;
the maintainer chose (a) — replace it with an in-house backend — and it was
built and perceptually accepted over three review loops (2026-07-07/08):

1. **Line Art de-wobble** — the flattener defaults on (Smoothness ramp),
   rewritten to a total-least-squares line fit with a three-gate
   noise/feature classifier; sharpener tangents use leg chords so boundary
   noise no longer mints false corners.
2. **Small-glyph overshoot + Edge reroute** — corner rebuild skips glyph-
   scale rings; a coverage gate stops the sharpener amputating serifs; Edge
   Detection was rerouted off the potrace geometry stage onto the shared
   `contourPolylinesFromMask` finisher.
3. **Big-letter corners + arc wobble** — a dense-stage moving circle-fit
   smoother evens mid-wavelength mask noise on large curves.

Each defect class is guarded by an analytic instrument
(`contour-straightness` / `contour-glyph-fidelity` / `contour-roundness`).

### Decision

- **Delete every `potrace-*.ts` module** (trace, apex, bitmap, curve +
  optimize, params, path-scanner, polygon family) and their tests, plus the
  dead `edge-ink-support.ts` and the two potrace comparison harnesses
  (`_contour-vs-potrace-audit`, `_sharp-candidates`).
- **All binary filled presets (Line Art, Smooth, Sharp) route to
  `contour-trace.ts`; Edge Detection shares its finisher.** The dispatch
  predicate `shouldUsePotraceTraceBackend` is renamed `isBinaryContourPreset`
  (backend-neutral) and lives in `contour-trace.ts`. This was already the
  runtime path (the ADR-120-era A/B swap), so production output is unchanged
  by the deletion.
- **Two kept symbols move out of the potrace modules:** the LightBurn dialog
  model (`LightBurnTraceSettings` + `DEFAULT_LIGHTBURN_TRACE_SETTINGS`) to a
  new `lightburn-trace-settings.ts`, and the `TraceBitmap` bitmap shape to
  `local-contrast-mask.ts` (its only surviving producer). The potrace
  parameter converter is deleted with the backend.
- **imagetracerjs stays** as the multi-colour / no-fixed-palette fallback
  (Unlicense, ADR-013) — untouched.

### Consequences

- The whole surfaced trace surface is now original / permissively-licensed
  code; the ADR-120 MIT-release blocker is closed. The Selinger 2003 potrace
  algorithm is neither used nor referenced by shipped code (the external
  potrace 1.16 binary remains only in TRACE_AUDIT-gated measurement fixtures,
  never bundled).
- Measured on the arch-house logo: contour IoU 0.92, band-IoU 0.94, hole
  census exact, ~40% faster than the old potrace path. Fidelity is
  eyeballed against the source (CLAUDE.md #2), not asserted from IoU alone.
- Known residual: sub-pixel mask-noise ripple on large curves; the named
  next lever is sub-pixel boundary extraction from the anti-aliased luma.
- Not verified: a LightBurn side-by-side; the Sharp/Smooth/Centerline live
  passes were rendered and reviewed but not burned.

### Verification

- Adversarial audit (5 dimensions, then per-finding refutation): 0 blockers,
  0 majors, 5 minors — all cleared. Provenance dimension confirmed clean-room
  (standard published math, zero potrace fingerprints in code, no GPL
  dependency).
- Routing pin (`trace-to-paths.test.ts`): the three binary presets classify
  to the contour backend and Line Art dispatches through it end-to-end;
  centerline/edge/multi-colour do not. Replaces the deleted potrace pin.
- Full suite green after the deletion; `tsc --noEmit` + lint clean.
- Perceptual: the five presets rendered through the app dispatcher and
  reviewed; the three fidelity instruments gate regressions.

## ADR-124 — Capture Board Corners: build the registration box from jogged machine coordinates (2026-07-08)

**Status:** accepted (maintainer directive: "jog the head to each corner,
press a button, remember the coordinates … draw the shape on canvas with
exact size so I can center artwork on a placed board"). Scope lands here
before code.

> **Numbering note.** Drafted as ADR-122, but the camera and trace-engine
> merges to main landed ADR-116–123 first (ADR-122 = potrace-backend removal,
> ADR-123). Renumbered to **ADR-124** — the next free number above main's
> body — when this feature was rebased onto main for merge, following the
> ADR-092/093/123 numbering-note convention.

### Context

The operator places a board (wood/acrylic offcut) somewhere on the bed and
wants to burn on it — usually centered. Today nothing tells the app where
that board physically sits or how big it is, so lining artwork up with a
placed board is guesswork. LightBurn solves this with a camera; the
camera-free path (ADR-057 Registration Box) is close but inverted — it
burns an outline first, then you place material inside it.

This ADR is the other direction: material is already placed, so **capture**
its corners by jogging the head to each one and recording the machine
coordinate. Manual hand-jogging cannot work: GRBL is open-loop (no
encoders), so pushing the head by hand does not update the reported
position — capture is always button-jog.

### Decision 1 — reuse the registration box; add a capture front-end

The captured board **is** an ADR-057 registration box (reserved
`REGISTRATION_LAYER_COLOR`), built from jogged corners instead of typed
width/height. That inherits, for free: distinct dashed rendering
(draw-scene), box-anchored placement (`computeRegistrationBoxBounds` →
`prepareOutput`), the artwork-centering machinery, and save/load. The
feature is a new *creation path*, not a new scene concept.

The operator captures four corners. Width and height come from the
axis-aligned **bounding box** of the four points
(`bestFitRectangleFromCorners`), so the result is **independent of capture
order/direction** — up-the-left-side and across-the-bottom both give the
same size and, crucially, the same orientation. (The original
edge-length-averaging was order-dependent: capturing the reverse direction
silently swapped width and height, drawing a horizontal board vertical —
found in live hardware use, ADR-124 amendment 2026-07-08.) Only the *first*
corner is special: it must be the bottom-left, because it sets the origin
(Decision 2); the other three are any order. An off-square diagnostic (the
largest distance from each **bounding-box corner** to its nearest captured
point) warns when the board is rotated on the bed, a corner was mis-captured,
or a corner was skipped and another repeated — measuring box-corner →
nearest-point, not the reverse, so a skipped/duplicated corner (which leaves
a box corner unclaimed) is caught rather than scoring zero. The outline is
drawn axis-aligned, so a large value means the drawn size/orientation won't
match the real board. Inputs are finite-guarded (non-finite → null).

**Known limitation.** The work origin is set at the *first* captured corner
(G92), which is order-dependent, while the geometry is now order-independent —
so capturing a corner other than the bottom-left first silently sets the
origin at the wrong corner with no geometric feedback (the burn would then be
misplaced, but the frame/Start bounds preflight catches an off-bed job). The
"bottom-left first" guidance is the primary mitigation; an origin-aware
first-corner check would need the device origin (deferred).

### Decision 2 — bottom-left sets the origin; box is drawn centered

Capturing the bottom-left corner calls the existing `setOriginHere` (G92
X0 Y0), so that physical corner becomes work (0,0). The box is drawn
**centered on the canvas** (reusing `registrationBoxDefaultPosition`) — a
convenient work area, not the board's true bed position — and job placement
is switched to **user-origin / front-left**. The box's front-left then
anchors to the work origin, so artwork centered on the on-canvas box burns
centered on the real board wherever it sits. This is the exact "no-homing
machine: Set Origin + Frame first" path ADR-057's help already describes,
and it works on machines without homing (the common case for this user
base). The `wcoCache` is inferred immediately by `setOriginHere`, so
user-origin placement is valid with no wait for a later WCO frame.

Registration output is forced to **artwork-only** on capture: the material
is already placed, so the outline is a guide, never burned.

The outline is labeled on the canvas with its measured `W × H mm`
(`draw-registration-dimensions.ts`, screen-space text from the box's drawn
bounds) and the size is repeated in the panel, so the operator can compare
what the laser measured against a physical ruler.

### Decision 3 — placement helpers reuse the align + jog machinery

"Center / corner the artwork" reuses selection alignment against the box:
`buildBoxAnchorAlign` composes a horizontal and vertical single-axis
`alignDelta` (exported from selection-align) into a corner snap, wired as
`alignSelectionToRegistrationBox(anchor)` beside the existing
`centerSelectionInRegistrationBox`. "Jog head to" a board point reuses the
guarded `jog` action via a new `jogToMachinePosition`, computed as a
relative delta from the current machine position (so it works for the
(0,0) corner and needs no absolute-jog builder). Motion actions
(home/jog/frame) moved to `laser-jog-actions.ts` when this pushed the
store past the ADR-015 size cap — a mechanical split matching
laser-job-actions / laser-origin-actions.

### Robustness (capture input; hardened during the ADR-124 self-audit)

Width/height derive from the bounding box, so capture order/direction can't
swap them (amendment above); the off-square diagnostic flags a rotated or
mis-captured board. A double-click is deduped — a capture within 1 mm of the
previous corner is ignored (a stationary-head double-click would otherwise
record a corner twice and corrupt the rectangle), backed by an in-flight
guard so the first-corner G92 fires once. "Create board outline" is blocked
below 3 mm in either dimension (a degenerate capture would otherwise be
silently clamped to 1 mm by `sanitizeSize`). A failed origin write surfaces
an in-panel error instead of leaving the operator on "Corner 1" with no
feedback.

### UI entry point (amendment 2026-07-08)

The panel moved from an inline section in the Laser controls column to a
**Place Board** toolbar command (Tools group, beside Registration Jig) that
toggles a NON-modal floating panel top-left of the canvas — the ADR-057
registration-jig pattern (toolbar toggle + `App.tsx`-rendered floating panel
+ ui-store open flag). The panel reads its own connected/Idle gate
(`useCaptureGating`) rather than a prop from `LaserWindow`. Kept ungated
across machine kinds (works for CNC stock placement too), unlike the
laser-only registration jig.

### Manual-size path (amendment 2026-07-08)

For operators who already know their material's exact dimensions, capturing
all four corners is busywork. After the bottom-left corner is captured (which
sets the origin), the panel offers a `ManualSizeForm`: type width × height and
draw. The origin is already correct, so it reuses `addCapturedBoardBox(w, h)`
verbatim and synthesizes the other three corners from the origin + size
(`boardCornersFromOrigin`) so the committed phase (measured readout,
jog-to-corner) behaves identically to a four-corner capture. The synthesis
assumes machine +X = width, +Y = height (the same front-left baseline as the
rest of the feature); the ≥ 3 mm guard is shared (`constants.ts`).

### Limitations (stated, not hidden)

Axis-aligned rectangle only: a physically-rotated board yields an
axis-aligned W×H box (size correct, orientation not), flagged by the
rotation warning. X/Y only, Z ignored. Requires connected + Idle + a live
machine position. Corner eyeballing is ±~0.5–1 mm. True rotated-rect /
N-point polygon capture is a documented follow-up.

### Verification

Pure core (`bestFitRectangleFromCorners` incl. the shear/rotation
diagnostics, `boardMachinePoints`, `buildBoxAnchorAlign`) and store actions
(`addCapturedBoardBox`, `alignSelectionToRegistrationBox`,
`jogToMachinePosition`) are unit-tested. A React panel test — driving the
capture flow with status frames injected into the laser store (NOT the GRBL
simulator) — asserts G92 on the bottom-left corner, the measured box size,
user-origin placement, the double-click guard (one origin write, one
corner), and the too-small-board block. The canvas size label is a
draw-scene text-capture test. **The perceptual render was NOT performed:**
the live preview was unavailable (its port held by the maintainer's own dev
server) and injecting a box into the live scene would break the
side-effect-free rule, so correctness of an axis-aligned rectangle at a
measured size rests on the exact geometry unit tests, not a rendered-pixel
comparison. Also NOT verified: on-machine jog-to-corner, real G92 behavior,
and the physical burn landing on the board — hardware remains CLAIMED; the
operator confirms via the WORKFLOW checklist.

### Amendment (2026-07-08) — lock the captured board

The captured board is created **locked** (`addCapturedBoardBox` sets `locked: true`), unlike the ADR-057 jig, which is operator-positioned and stays movable. Its on-canvas position encodes the physical board's measured location relative to the G92 work origin, so a stray drag would silently break centering, the ADR-125 Fill/Array, and the burn placement. Locking makes it unselectable and undraggable (the hit-test, marquee, snapping, and selection-transform paths all skip locked objects) while it still renders and compiles; "Capture a new board" still replaces it (the box is found by color, not selection).

## ADR-125 — Fill the board: auto-fit + array artwork onto the placed board (2026-07-08)

**Status:** accepted (maintainer directive: expand Place Board — chosen from the
expansion brainstorm: A1 auto-fit + A2 array/step-and-repeat; the material and
camera themes were deferred).

> **Numbering note.** ADR-124 (Capture Board Corners) was the last used number;
> **ADR-125** is the next free, verified against DECISIONS.md at authoring.

### Context

Place Board (ADR-124) turns a physical board into a canvas region — the ADR-057
registration box — tied to the work origin, but the operator could only position
*one* design on it (center / corner-snap). For production (a sheet of coasters, a
row of keychains) they want to *fill* the board: scale one design to fill it, or
tile many copies. Both act on the placed board's region and the current selection.

### Decision 1 — auto-fit is fit-to-region, generalizing fit-to-bed

`fitObjectToRegion` (`core/scene/fit-to-region.ts`) generalizes the existing
`fitObjectToBed`: fit-to-bed already scales-to-fit-and-centers against the bed
`(0,0,bedW,bedH)` with a fixed 10% margin, capped at scale 1 (never grows).
fit-to-region takes any rectangle (the board's scene-space bounds, via
`transformedBBox` of the registration box), a caller-supplied margin, and a
`grow` flag; auto-fit passes `grow: true` so a small design scales *up* to fill.
Centering is rotation-safe (it maps the local center through the scaled
transform), fixing a latent fit-to-bed limitation. The store action
`fitSelectionToBoard` fits the *one* selected design; multi-select is a no-op
(fitting several would pile them on top of each other).

### Decision 2 — array is pure geometry (offsets) + a store tiler

`tileIntoRegion` (`core/scene/tile-into-region.ts`) is pure: given the design's
scene footprint (`cell`), the board `region`, and a layout — explicit `rows × cols`
or `fill` (auto-count how many fit) — it returns one translation offset per grid
slot, the block centered in the region. The store action `tileSelectionIntoBoard`
moves the original into slot 0 and adds a fresh copy (`crypto.randomUUID`, matching
the duplicate action's id minting) per remaining slot, as one undoable edit; copies
inherit the source layer. `MAX_TILE_PER_AXIS` caps a typo (9999 rows) or a 0.1 mm
design from spawning millions of objects. Single-design only, like auto-fit.

### Decision 3 — both live in the post-capture placement panel

Both are gated on a placed board **and** exactly one selected design, in
`BoardPlacementControls` (the panel that already hosts align/jog), grouped under
"Fill board" (Fit to board button) and the array form (`BoardArrayForm`:
fit-as-many-as-fit, or rows × cols, with a spacing gap).

### Consequences

Turns Place Board from "position one design" into "run a production sheet."
**Not covered** (outlined in the expansion brainstorm, deferred): nesting
*different* parts (bin-pack), board→material presets, caliper mode, camera board
detection. **Verified:** pure-geometry unit tests + store-action tests (fill
scale, centering, rotation-safety, grid/fill counts, guards). **NOT** perceptually
rendered in the live app at authoring time — the maintainer's canvas eyeball is
the fidelity gate (green tests assert geometry, not that it *looks* right).

### Amendment (2026-07-08) - review-driven fixes

An adversarial review of this diff surfaced four issues, all fixed here:

- **Rotation-safe fit, not just centering.** `fitObjectToRegion` now scales by the design's rotated footprint (its unit-scale AABB) instead of its intrinsic W x H, so a rotated design fills the board without overflowing it - and without burning off the physical material. (Centering was already rotation-safe.)
- **Re-array cannot silently stack.** After arraying, the whole grid becomes the selection (like Duplicate), which disables Array/Fit (they need exactly one selected design); the operator undoes to re-array. A re-click can no longer drop a second exactly-overlapping grid (a doubled burn).
- **Count + perf caps.** `MAX_TILE_TOTAL` (500) caps the total copies - a tiny design under "fit as many as fit" could otherwise spawn ~10,000 - and the copies are appended in a single pass rather than an O(n^2) per-object loop.
- **Finite-gap guard.** A non-finite spacing (e.g. a huge literal parsing to Infinity) is clamped to 0 in both the array form and `tileIntoRegion`, so it cannot write NaN into a copy's transform or the emitted G-code.

## ADR-126 - Generalize Place Board to a board-shape union; circle boards (2026-07-08)

**Status:** accepted (maintainer directive: capture round boards - "origin the middle of the circle and draw a circle with a hand-measured diameter around the laser origin"; chosen scope: a general board-shape system, circle first).

> **Numbering note.** ADR-125 (Fill the board) was the last used; **ADR-126** is the next free (verify at merge).

### Context

Place Board (ADR-124) captured rectangles only - four jogged corners, origin at the bottom-left. Round stock (coasters, medallions) has no corners, and its natural origin is the CENTRE. Rather than special-case a circle, generalize the captured board to a shape union so future shapes (rounded-rect, polygon) slot in cleanly.

### Decision 1 - a BoardShape discriminated union in core

`BoardShape = { kind:'rect'; widthMm; heightMm } | { kind:'circle'; diameterMm }` (`core/scene/board-capture.ts`), matched with `assertNever`. The capture-in-progress reducer gains `shapeKind` + a resolved `shape`; `corners` is shape-relative (rect: up to four corners; circle: `[centre]` or `[centre, rim]`).

### Decision 2 - circle origin is the centre; size by typing or jog-to-edge

The operator jogs to the CENTRE and Captures, which sets the G92 work origin there (anchor `'center'`, already a valid placement). Then they type the hand-measured diameter, or jog to any rim point and capture it - `diameterFromCenterEdge(centre, rim) = 2*|rim - centre|` (pure) measures it without a ruler. So a circle is one jog + one number, simpler than the rectangle's four corners.

### Decision 3 - reuse: circles need no downstream change

`createRegistrationCircle` (an ellipse on the registration layer) already exists. Crucially, `findRegistrationBoxes` keys on `kind:'shape' && color`, NOT `spec.kind`, so it already finds the circle - meaning Fit/Array (ADR-125), align, lock, remove, and the burn placement all work on a circle board with ZERO change. The store action `addCapturedBoard(shape)` dispatches rect vs circle (locked outline, kept out of the burn, shape-appropriate anchor); `addCapturedBoardBox` is the rectangle back-compat wrapper.

### Decision 4 - shape-aware UI

A Rectangle / Circle toggle at the top of the Place Board panel (switching clears the in-progress capture). The capture phase and the placement controls branch by shape: a circle shows a single Centre anchor (align + jog) and a diameter readout instead of the rectangle's four corners.

### Consequences

Round boards work end-to-end (verified by panel integration tests: toggle -> capture centre -> type/measure diameter -> a locked, centre-anchored ellipse). The shape union makes further shapes additive. Fit/Array measure the circle by its bounding SQUARE, so a design's corners can overhang the arc - an optional inscribed-square fit is a deferred fast-follow. NOT verified: on-machine capture / G92 / burn (hardware CLAIMED); no live perceptual render (rule #4 - the dev server shares the maintainer's scene).

### Amendment (2026-07-08) - inscribed-square fit for circles (PR 5)

Supersedes the "bounding square" note above. Fit/Array now fill a circle board's centered INSCRIBED SQUARE (side = diameter / sqrt(2)) instead of its bounding square, so a design stays inside the arc rather than overhanging the corners. A new pure helper `boardFitRegion(box)` (core/scene) returns the inscribed square for an ellipse box and the full bounds for a rectangle; `fitSelectionToBoard` and `tileSelectionIntoBoard` feed it to `fitObjectToRegion` / `tileIntoRegion`. Rectangle behavior is unchanged.

### Amendment (2026-07-19) - rim-derived centre and physical-point verification

Circle capture now defaults to four well-spaced rim captures. A best-fit circle
derives the centre and diameter, then the head moves to the calculated centre
with the beam off; after motion settles, the operator confirms the current head
position as the centre and the app sets the work origin. The original
marked-centre plus typed/measured-diameter flow remains available as a fallback.

After either a rectangle/square or circle outline is created, its physical
geometry can be checked point by point. Rectangle targets are its four corners;
circle targets are its centre and four cardinal rim points. Selecting a target
moves there with the beam off. The operator can accept it, or fine-jog to the
physical point and confirm. Confirmation updates the existing locked outline:
rectangle corners adjust the applicable extents, circle rim points adjust the
diameter, and rectangle bottom-left or circle-centre corrections also update the
work origin. Confirmation is gated on settled motion and a live machine
position; machine-session, trusted-position, work-origin, or outline/Undo
changes invalidate stale capture geometry rather than applying it to a new
coordinate frame or a mismatched visible outline.


## ADR-127 - Rotary axis engine: one machine-space job for chuck/roller Y-scaling (Phase N, 2026-07-09)

Context. Cylindrical engraving (mugs, tumblers, pens) needs the design Y to drive
a rotary axis instead of the flat-bed Y motor, mapping surface distance to
rotation. The mapping must be applied consistently everywhere the job is measured
- emit, framing, time estimate, placement preflight, and Ruida .rd - or they
disagree with the streamed motion.

Decision. A rotary attachment is an optional `RotarySetup` on the device profile
(persisted in .lf2 and machine profiles). `core/job/rotary-job.ts` (machineSpaceJob)
is the SINGLE source of truth: it scales + rebases Y for a rotary job and is the
identity for non-rotary jobs; every downstream consumer routes through it.
- Chuck: surface mm scaled by mmPerRotation / (pi * objectDiameterMm). Roller: 1:1.
- Both rebase Y to 0 - rotation is relative; a flat-bed Y position is meaningless
  on a cylinder. reverseAxis mirrors within the wrap window for inverted gearing.
- Scale is applied AFTER prepareOutput so the on-canvas preview stays surface-true;
  only emitted motion is scaled.
- Bounds preflight swaps bed height for the one-revolution wrap limit
  (boundsHeightOverrideMm); a job taller than one revolution is refused.
- Image/raster engraving is refused while rotary is enabled
  (rotary-raster-unsupported) - v1 is vectors-only.

Scope of THIS change. Engine only: the rotary math and its wiring through
emit/.rd/preflight/estimate/framing plus the .lf2 + machine-profile round-trip.
The Rotary Setup dialog and command wiring are a deliberate follow-up so this
lands as a small, reviewable, UI-free slice.

Consequences.
- Determinism (#5): disabled/absent rotary is byte-identical to current output
  (asserted in the emit-gcode-rotary tests).
- HARDWARE-GATED / CLAIMED: the Y-scale factor, reverse-mirror sign, and wrap
  limit are structurally unit-tested but have never run on a physical rotary. A
  wrong calibration silently distorts the burn and no automated test can catch
  it. Ships CLAIMED until a maintainer rotary bench pass.

## ADR-128 — Measured-boundary trace pipeline: sub-pixel extraction, supersampling, and fair-then-fit finishing

Context. ADR-123 replaced the potrace-derived backend with the in-house contour
finisher (mid-crack boundary walk -> Taubin pre-smooth -> corner rebuild ->
curvature evening -> straight-run flattening -> spline resample). Measured
against a maintainer reference pair (an idealized outline drawing + a filled
redraw of the Arch House logo), that finisher still produced wobbly stems, serif
spikes/melt, ~1px scallops on organic curves, and sawtooth on the long
hand-drawn strokes. Root analysis (three research briefs + a perceptual loop
harness): those smoothing stages existed to repair QUANTIZATION noise from
binarize-then-walk, and each stage fought the staircase the previous one left.
The frontier is fidelity vs a professional-artist look: fair curves + regular
typography.

Decision. Move the contour lane (and the edge lane, which shares the finisher)
to a MEASURED-boundary pipeline with a fair-then-fit finish:

1. Sub-pixel boundary extraction. The mid-crack walker interpolates the
   pre-threshold grayscale iso-line at each crack (marching-squares style)
   instead of quantizing to lattice midpoints. Loop TOPOLOGY stays on the
   cleaned binary mask; vertex POSITIONS come from the anti-aliasing ramp
   (~0.1px vs ~0.7px). A CrackSubPixelField {lumaAt, thresholdAt} exposes the
   iso per branch (global/Otsu = constant; local-contrast/sketch =
   position-dependent). Saturated binary steps carry no sub-pixel information
   and stay at the midpoint.

2. 2x quality supersample. The binary-contour and edge presets trace at 2x
   (mkbitmap's recipe) so 1-2px features (hooked apex tips, thin subtitle
   strokes) binarize with double resolution. An INTERNAL pixelScale option
   scales EVERY pixel-denominated constant (despeckle/pinhole/min-area areas by
   s^2; simplify epsilon, window and run lengths, local-mean radius by s) so the
   1x tuning holds. Sharp opts out: bilinear supersampling would anti-alias the
   pixel notches it exists to preserve.

3. Wobble stages stand down on measured loops. When most cracks interpolated
   (the boundary is a MEASUREMENT), the quantization-noise stages (chord
   flattener, arc-noise evening) are net harmful -- they fabricate joint steps
   on measured stems. They disable per loop; binary/pixel sources keep the full
   legacy behaviour, protected by the straightness/roundness instruments.

4. Fair-then-fit finish. Measured loops end in least-squares cubic Bezier
   fitting (Schneider's published Graphics Gems method: chord parameterization,
   tangent-constrained LS, Newton reparameterization, corner split) -- on
   low-noise measured data the fit IS the fairing. Large hand-drawn (organic)
   loops are first Whittaker-Henderson penalized-smoothed (fair-chain.ts:
   minimize ||y-x||^2 + lambda*||D2 x||^2, one banded LDL^T solve per
   corner-delimited segment, lambda derived from a frequency cutoff at 2x the
   ink-texture wavelength), THEN fit tight -- because max-error split-fitting
   alone can never stop chasing texture (established over three iterations).
   Corners are hard boundaries: persistence-gated for organic loops
   (turn survives at two window widths), evidence-backed for glyphs.

Scope. Line Art, Smooth, and Edge Detection get the full measured-boundary
stack; Sharp stays 1x pixel-pure; Centerline (the skeleton lane) is untouched.
Engine + perceptual harness only -- no changes to the trace dialog or public
option surface beyond the internal preset flags.

Consequences.
- Provenance stays clean-room: standard published math (marching squares,
  Schneider fitting, Whittaker-Henderson smoothing, scale-space corner
  persistence). No GPL code was read or ported (potrace, libspiro, autotrace,
  cornucopia-lib all avoided; only the imagetracerjs dependency remains, for the
  legacy multi-colour path).
- Fidelity vs fairness: input-mask IoU DROPS slightly on textured art BY DESIGN
  -- the reference style prefers fair lines over faithfully-traced ink
  roughness, and IoU/chamfer are blind to fairness. Verification is the
  perceptual loop harness (arch-house-reference-loop, env-gated) plus a
  resolution-aware apex-fidelity invariant and fair-chain / fit-cubics
  frequency-response unit tests.
- Cost: Line Art / Smooth / Edge trace rises from ~0.6s to ~2-3.5s on a 1024^2
  logo (2x supersample + fitting). Acceptable at import time; a "High quality"
  toggle to reclaim 1x speed is a possible follow-up.
- Karpathy discipline: every iteration was gated on rendered vector-resolution
  crops, not green tests. Perceptually verified against the reference on
  letters, serifs, arch bands, waves and roof lines; NOT verified on physical
  laser output (this changes trace geometry only, no G-code semantics).

## ADR-129 - Enforce no-go/keep-out zones on app-initiated jog and click-to-position motion (2026-07-10)

**Status:** accepted (audit DEV-04: no-go zones gated Start/Frame/export/resume, but jog was zone-blind end to end).

> **Numbering note.** ADR-128 (measured-boundary trace pipeline, merged from main) was the last used; **ADR-129** is the next free.

### Context

No-go/keep-out zones (clamps, cameras, fixtures) are honored by the Start, Frame, export, and resume preflights, but the jog path was blind to them end to end: `jogActions.jog` gated only on autofocus + jog/frame readiness, and `buildJog` checked only finiteness/axis. One jog-pad move or one click-to-position could drive the head straight through a clamp at up to 3000 mm/min. LightBurn has no equivalent (it does not model keep-out zones for jogging), so this is a deliberate KerfDesk safety divergence, recorded here.

### Decision

Add a pure core check `firstZoneCrossedBySegment(from, to, zones)` (`core/preflight/no-go-zones.ts`, reusing the existing segment/rect intersection helpers) and call it at the single jog choke point. All three UI motion paths - jog pad, jog-to-point, and click-to-position - funnel through `jog({dx,dy,feed})`, so the guard covers them all: it resolves the target from the live machine position plus the delta and refuses (same shape as the readiness refusal - set `lastWriteError`, log, throw) when the straight from->target segment crosses an enabled zone, naming the zone.

### Scope / non-goals

The check is skipped (motion allowed) when there is no known machine position for a relative jog - the operator has no live position to reason about either, and blocking would strand jogging. Homing and any future continuous (hold-to-jog) motion are out of scope here; the Safety Zones panel documents these uncovered paths.

### Consequences

A jog that would cross a keep-out is refused before any byte is sent, closing the gap between jogging and the job/frame/export paths. Pure core stays pure (returns the zone or null, no throw for control flow). No G-code or snapshot change. NOT hardware-verified - the geometry and the refusal are unit- and integration-tested (core segment cases + a connected-store jog that crosses a clamp sends nothing), but on-machine behavior is CLAIMED.

### 2026-07-15 audit amendment

The emitted-job scanner follows the same physical-path rule. It evaluates the actual G2/G3 sweep
rather than the endpoint chord, and a live Start supplies the qualified machine position so the
head-to-first-XY entry move is checked too. File export has no trustworthy future head position and
therefore checks only motions encoded in the file. Arc/rectangle checks use the swept curve, not the
whole arc bounding box, so a fixture inside the box but outside the path does not become a nuisance
blocker.

## ADR-130 - Registration-box provenance: protect a captured board from the jig panel (2026-07-10)

**Status:** accepted (audit CAM-04: the Registration Jig panel could silently unlock/replace a captured board, breaking its physical registration).

> **Numbering note.** ADR-129 (jog no-go zones) was the last used; **ADR-130** is the next free.

### Context

Place Board (ADR-124) and the Registration Jig panel share ONE reserved-color registration box (isRegistrationBox keys on the reserved color, not a provenance field). Place Board locks that box because its canvas position encodes the physical work origin (G92). But the always-available jig panel offered a one-click unlock checkbox and a Create/Replace button wired to the same box, so an operator could unlock+drag or replace a captured board and silently break centering, Fill/Array, and the burn placement, with no signal.

### Decision

Add an optional provenance?: 'captured-board' | 'jig' to ShapeObject. Place Board tags its outline 'captured-board' (in the locked() helper, the single construction choke point); jig creates leave it absent. Absent is treated as 'jig' (back-compatible: old .lf2 files load unchanged). The field round-trips as ordinary JSON (the deserializer passes non-text objects through as-is); the shape validator gains one optionalLiteral line so a malformed value is rejected at the .lf2 boundary.

The jig panel reads the current box provenance: for a captured board it disables the unlock checkbox and the Create/Replace button and shows a warning that unlocking or replacing it here breaks its physical registration, and to use Place Board to re-capture or Remove it first. Remove stays available as the explicit, safe path to clear a captured board.

### Consequences

A captured board can no longer be silently unlocked or replaced from the jig panel. The two features keep sharing one box (no second reserved layer), and the tag is additive/optional so nothing else changes. NOT hardware-verified; the guard is unit-tested (io round-trip + a panel render test asserting the disabled controls + warning for a captured board and enabled for a jig box).

## ADR-131 - Canonical Result<T, E> for core control-flow errors (2026-07-11)

**Status:** accepted (audit ARC-01/ARC-02: core geometry ops throw user-facing strings for expected user input, which CLAUDE.md's "Pure core" section bans; there was no shared type to convert them to, so ~46 files hand-rolled ad-hoc `{ ok }` / `{ kind }` shapes).

> **Numbering note.** ADR-130 (registration-box provenance) was the last used; **ADR-131** is the next free.

### Context

CLAUDE.md "Pure core" forbids throwing for control flow: "return a `Result<T, E>` discriminated union." But `grep 'Result<' src/core` returned zero files — the discipline was stated but had no vehicle. Ops such as `weldVectorObjects`, `combineVectorObjects`, and `offsetVectorObjects` threw `new Error(userMessage)` for expected conditions (too-few objects, open contours, empty intersection), and the four store actions swallowed them with the bare `try { … } catch { return state }` shape CLAUDE.md's anti-patterns list explicitly bans. Nothing in the type system marked these as throwing, so every future caller had to rediscover it. A first pass (CNV-10) converted three ops to an ad-hoc `{ ok, message }` shape — which is the very hand-rolling this ADR exists to eliminate.

### Decision

Add one pure-core module `src/core/result.ts` exporting the canonical type and its constructors:

```ts
export type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly error: E };
export function ok<T>(value: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;
```

The `kind` tag matches the house discriminated-union style so `assertNever` closes a switch's default arm on the error variant, exactly like every other core union. There is no top-level `core/index.ts` barrel; consumers import `../result` (within core) or `../../core/result` (from ui), matching how the existing loose core files (`app-branding.ts`, `grbl-streaming.ts`) are imported. New ad-hoc `{ ok }` / `{ kind }` result shapes in core are disallowed going forward — converge on this type. Migration of the ~46 existing ad-hoc sites is incremental, not a single batch diff; ARC-02 converts the vector-geometry cluster first (weld/boolean/offset/dogbone) and supersedes CNV-10's interim `{ ok, message }` shape.

### Consequences

Core control-flow errors now have one typed channel a caller must narrow on (`result.kind === 'error'`) rather than a throw a caller may forget to catch. The addition is behavior-neutral (ARC-01 ships no consumers); the behavior change — deleting the throws and the `catch` swallows — lands in ARC-02. The 46 ad-hoc sites converge opportunistically as they are touched; this ADR is the reference they converge to.

## ADR-132 - The 250-line soft tier is a report-only script, not an ESLint warning (2026-07-11)

**Status:** accepted (audit ARC-03: the 250 soft tier promised by ADR-015, CLAUDE.md's size table, and PROJECT.md non-negotiable 15 had no enforcement mechanism — it was fiction).

> **Numbering note.** ADR-131 (canonical Result) was the last used; **ADR-132** is the next free.

### Context

ADR-015 lists a two-tier file-size discipline: 400 lines hard, 250 soft. The hard tier is a real ESLint gate (`max-lines: ['error', { max: 400, skipBlankLines, skipComments }]`, `eslint.config.mjs`). The soft tier was never implemented: `grep max-lines eslint.config.mjs` shows a single `error/400` entry, and the finding's recommendation to "add a second `max-lines` at warn/250" is **not achievable** — ESLint keys rules by name, so a second `max-lines` config for the same files *replaces* the first (last-wins), it does not stack. You cannot have warn/250 AND error/400 on the built-in rule simultaneously. 78 non-test src files currently sit over 250 counted lines (two — `io/svg/parse-svg.ts`, `ui/library/DesignLibraryDialog.tsx` — pinned at 400 with zero headroom), all invisible.

### Decision

The soft tier is a separate, report-only mechanism, not an ESLint severity. Add `scripts/check-soft-line-limit.mjs` (mirroring `check-file-size-policy.mjs`'s walk) that counts ESLint-style lines — skipping blank and comment-only lines, and skipping string literals so a `//`/`/*` inside a string is not misread as a comment — and lists non-test files over 250, then **always exits 0**. Tests and `__fixtures__` are excluded because `eslint.config.mjs` relaxes file-size for them; the soft report mirrors the hard rule's scope. It is wired as `check:soft-size` and appended (non-failing) to `release:check`; in CI it also appends a table to the job summary. The counter is a line-scan approximation of ESLint's AST count — validated against the audit's independent tally (78 ≈ the finding's 76–81) and against ESLint's own count (the two 400-pinned files register at exactly 400). ADR-015's wording is updated to say the soft tier is report-only.

### Consequences

The soft tier is finally visible without blocking anyone: `release:check` prints the over-250 list every run, so the drift is measured, but only the ESLint error/400 rule fails CI. Splitting the 78 files (especially the two 400-pinned ones, whose next edit forces an unplanned mid-feature split) stays out of scope — each is its own concept-driven tidy PR. Because the counter is an approximation, a file within a line or two of 250 may be mis-listed; it is a report, not a gate, so that is acceptable.

## ADR-133 - Camera bridge trusts only the exact production origins and refuses all loopback frame-proxy targets (2026-07-11)

**Status:** accepted (audit ELE-02: residual-risk hardening of ADR-121's loopback camera bridge; the finding "drivable cross-origin by every *.pages.dev preview; usable as a localhost scanner" was CONFIRMED).

> **Numbering note.** ADR-132 (soft-tier report-only script) was the last used; **ADR-133** is the next free.

### Context

ADR-121's loopback camera bridge opts into Private Network Access and trusted three origin classes in `isTrustedHostedAppOrigin` (`electron/rtsp-camera-bridge.ts`): `https://kerfdesk.com`, `https://laserforge-2fj.pages.dev`, AND any `*.laserforge-2fj.pages.dev` â€” every Cloudflare Pages preview of every branch/PR. Any such preview the operator opened in a normal browser could drive the bridge's `/discover`, `/frame.jpg?url=`, `/probe`, and `/stream.mjpg`. Separately, the frame-proxy URL policy (`electron/camera-frame-proxy-policy.ts`) refused only the bridge's OWN port as a proxy target (`targetsBridgeItself`), so `http://127.0.0.1:<other-port>` was permitted â€” the proxy could read other loopback services, acting as a localhost port/host oracle (timing/error) despite the private-network egress guard and the JPEG-magic content check.

### Decision

Two independent tightenings of ADR-121's origin/target policy:

1. `isTrustedHostedAppOrigin` trusts only the EXACT production hostnames (`kerfdesk.com`, `laserforge-2fj.pages.dev`) â€” the `.pages.dev` subdomain wildcard is dropped. A preview build that must reach a local bridge is expected to gate that behind an explicit dev flag, not a standing wildcard. The loopback-dev-origin allowance (`http://localhost` / `127.0.0.1`, any port) is unchanged: code already running on the operator's loopback can reach the cameras without the bridge's help, so it is outside the S03-001 drive-by-remote threat model.
2. `cameraFrameUrlPolicy` refuses ALL loopback targets (`localhost`, `::1`, `127.0.0.0/8`) on any port, not just the bridge port. The bridge-itself case keeps its clearer "cannot proxy itself" message; every other loopback host returns "private-network hosts only". Real machine cameras live on RFC1918, never loopback, so no legitimate reach is lost.

### Consequences

A preview-build deploy can no longer reach a locally-running bridge (intended â€” previews are for UI review, not hardware). A local test camera bound to loopback can no longer be proxied; real cameras (RFC1918) are unaffected. The residual timing/error oracle across the egress guard's allowed RFC1918 range remains â€” a per-session bridge token replacing Origin-header trust is the next step if the maintainer wants it, deferred to its own ticket. Behavior-only change; no G-code or core impact. The deliberate `camera-frame-proxy-policy.test.ts` expectation that loopback-on-another-port was `ok` is flipped to `invalid`.

### Amendment â€” origin-exact allowlist + residual hosted-origin threat (2026-07-11, R3)

Codex re-audit R3 split into a fixable bug and a documented residual:

- **Fixed (R3):** `isTrustedHostedAppOrigin` compared `url.hostname`, which discards the port, so `https://kerfdesk.com:444` was accepted despite the "exact production origins" intent. It now compares `url.origin` against a set of full origins (`https://kerfdesk.com`, `https://laserforge-2fj.pages.dev`), so a non-default port or a wrong scheme no longer matches. Test-first in `rtsp-camera-bridge.test.ts`.
- **Residual (accepted by design, NOT closed):** hosted-origin access to the loopback bridge is deliberate â€” ADR-121 makes the deployed site a supported bridge client so production CSP does not block camera probing. Therefore a compromise or XSS of an EXACT trusted hosted origin (`kerfdesk.com` / `laserforge-2fj.pages.dev`) can still drive `/discover`, `/probe`, and `/frame.jpg` against the operator's RFC1918/ULA cameras through the loopback bridge. Blocking loopback proxy targets (ADR-133) stops localhost scanning, not RFC1918/ULA discovery. The mitigation is per-session bridge-token auth replacing Origin-header trust; it is a larger change deferred to its own ticket (the maintainer decides whether the deployed-site camera workflow warrants it, or whether hosted access should be dropped). R3 is therefore "port-exactness fixed; hosted-origin access is an accepted, documented residual" â€” not "closed".

## ADR-134 - The workspace camera overlay honors the alignment basis, matching Trace (2026-07-11)

**Status:** accepted (Codex re-audit R2: the overlay applied a rectified-basis homography to raw pixels â€” a bug, not a design choice).

> **Numbering note.** ADR-133 (camera bridge exact origins) was the last used; **ADR-134** is the next free.

### Context

A camera alignment records the `basis` it was solved in (`raw` or `rectified`). `runAutoAlign` persists `basis: 'rectified'` whenever a lens calibration exists â€” the homography was solved on de-fisheyed pixels. Trace (`buildCameraTraceImage`, ADR-110) honors this: it `rectifyImage()`s the raw frame before applying the homography, and refuses (`basis-mismatch`) when a rectified alignment has no calibration. The workspace overlay (CAM-02 / c70f4b87) only rescaled the homography for resolution and never read `alignment.basis`, so a calibrated (rectified) alignment was applied as a linear CSS `matrix3d` directly to raw, distorted pixels â€” the overlay bowed at the bed edges and mis-registered, while Trace of the same scene was correct. A CSS `matrix3d` is a linear projective map and cannot represent the nonlinear de-fisheye, so the live `<video>` overlay cannot be corrected by a transform at all.

### Decision

The overlay honors `basis`, sharing one pure helper with Trace (`rectifyForAlignmentBasis` in `core/camera`, so the two can never diverge again):

- **Captured still, `basis: 'rectified'`, calibration present** â†’ de-fisheye the still in its canvas (same `rectifyImage` params as Trace) before applying the homography. This is the primary LightBurn "Update Overlay" path and is now correct.
- **`basis: 'rectified'`, no calibration** (still or live) â†’ refuse: show a small "needs a captured still" notice instead of a mis-registered overlay.
- **Live `<video>`, `basis: 'rectified'`** â†’ refuse (a CSS transform cannot de-fisheye); the operator captures a still to see the aligned overlay. This matches LightBurn, which lens-corrects a snapshot rather than streaming a de-fisheyed live overlay.
- **`basis: 'raw'`** â†’ unchanged (warp raw pixels directly).

The rectify runs once per source/alignment change (memoized), not per zoom/pan render.

### Consequences

Calibrated overlays now register correctly on the still. A visible UX change: for a rectified alignment on a live USB stream the overlay is replaced by a notice â€” the operator must capture a still (previously they saw a wrong overlay). Per-frame live de-fisheye (canvas-per-frame or a GPU shader, ADR-108) is deferred as a larger feature. NOT perceptually verified: the tests prove the basis routing and that a rectified still produces a new (de-fisheyed) buffer, not that the overlay visually lines up on real hardware â€” that needs a rendered comparison against the bed. The notice wording/placement is a maintainer UX call.

---

## ADR-135 - Gate desktop auto-update on a trusted, code-signed channel

**Status:** Accepted | **Date:** 2026-07-12

### Context

ADR-024 allowed unsigned Windows builds to download an update from the pinned
R2 feed and install it on quit. The feed's SHA-512 value proves only that the
download matches `latest.yml`; both files come from the same origin. An attacker
who can replace the feed can therefore publish a higher-version installer and a
matching hash. With `autoDownload` and `autoInstallOnAppQuit` enabled, that code
would be accepted without an independent publisher identity check.

### Decision

Desktop auto-update is fail-closed behind an explicit trust gate. The updater
may run only when both conditions hold:

1. Electron reports a packaged build through `app.isPackaged`.
2. `IS_DESKTOP_UPDATE_CHANNEL_TRUSTED` is true because production installers
   and update artifacts are code-signed by the same approved Windows publisher.

Until signing is operational, the trust constant stays false. Packaged builds
remain fully usable but perform no update check, download, or install. Operators
update manually from the pinned KerfDesk download page. Enabling the constant
requires a separate release change that configures signing in CI, fails closed
when signing credentials are absent, and verifies a packaged update on Windows.

Once trusted, ADR-024's burn-safe behavior remains: background download,
install-on-natural-quit, and no `quitAndInstall()` call.

### Consequences

- An unsigned release-feed compromise cannot become a silent code-install path.
- Unsigned builds do not notify about new versions; manual download is the safe
  interim experience.
- The R2 publishing workflow may continue producing artifacts, but clients do
  not consume its update metadata until the signing gate is deliberately opened.
- Code signing is now a functional prerequisite for automatic updates, not only
  a SmartScreen/reputation improvement.

---

## ADR-136 - CNC interruption recovery rewinds to a retract-first safe boundary

**Status:** Superseded by ADR-143 | **Date:** 2026-07-12

### Context

ADR-103/118 rebuilt modal state at the first unconfirmed line and emitted a CNC
preamble that started the spindle while the bit could still be embedded, then
rapid-retracted and plunged back to the recorded depth. A stopped spindle may
not accelerate under cutting load. GRBL acknowledgements also prove parsing or
planner admission, not physical execution, so an exact acknowledgement-line
resume can skip accepted-but-unexecuted motion. Finally, the checkpoint kept
progress but discarded the terminal safety reason after reload/reconnect.

### Decision

- CNC recovery treats the first unconfirmed line as an interruption vicinity,
  scans backward to the previous pure `G0 Z<safe>` retract, and replays from
  that semantic boundary. No safe boundary means no automatic resume.
- Its preamble emits a controlled `G1 Z<safe> F<recovered plunge>` extraction
  before any `M3`/`M4`, then starts the last active spindle mode and waits for
  the configured dwell at clearance. The replayed boundary owns XY travel and
  the plunge. Laser recovery keeps its beam-off position-first order.
- The checkpoint optionally persists the terminal safety category, operator
  message, and rejected line without a schema bump; existing schema-v3 records
  remain readable.
- A final `ok` advances progress but does not clear recovery. Clearing requires
  the completed stream to be released while connected at physical `Idle`.

### Consequences

Router recovery deliberately recuts from the start of a cutting segment rather
than trusting an arbitrary buffered line. This can mark already-cut material,
but avoids both gaps and a spindle restart while embedded. The operator still
must preserve work zero and pass all normal readiness checks. The behavior is
unit/integration verified; real interruption and embedded-tool hardware tests
remain unverified and must use the standing air-cut/scrap protocol first.

## ADR-137 - Trace reliability: latest request wins and completed work is reusable (2026-07-11)

**Status:** accepted.

> **Numbering note.** ADR-136 (CNC retract-first interruption recovery) was the last used; **ADR-137** is the next free.

### Context

The trace dialog debounces preview state, but the shared worker client still queues every request. A CPU-bound worker cannot receive a cancellation message until its current synchronous trace returns, so rapid preset changes can put obsolete jobs ahead of the only result the user wants. Every queued request also starts its own fixed timeout. Clicking Trace then decodes and traces the same source again even when the current preview already contains the matching geometry. On large or supersampled images, this duplicate and queued work is a more credible failure source than the tracing quality itself.

### Decision

Make the tracing pipeline explicitly single-flight and latest-wins. Starting a new worker trace retires the worker that owns an unfinished request, rejects that request with a typed superseded error, and runs the new request on a fresh worker. Supersession is control flow, not a preview error and not a reason to retry inline. The timeout applies only to the active request. A ready preview carries the identity of the file, options, boundary, and boundary mode; commit may reuse its paths and bounds only while all of those inputs still match. Bounded resize-at-decode, transferable worker buffers, and backend-specific working-pixel budgets preserve this one-live-job contract while limiting large-image memory and compute.

### Consequences

- Rapid option changes can pay worker startup again, but never wait behind stale CPU work; old worker memory becomes reclaimable as soon as it is terminated.
- The preview and commit paths share one completed result when their inputs match, removing the most common duplicate full trace.
- Large images are bounded before allocation-heavy tracing, and Region Enhance cannot stack an inner 4x supersampling pass on top of its own work scale.
- This is in-process cancellation, not cooperative cancellation inside the tracing algorithms. A backend that monopolizes the main thread remains out of scope, and worker termination latency remains browser-controlled.
- Regression coverage proves superseded jobs cannot fall back inline, stale timers cannot retire the replacement worker, mismatched preview inputs cannot be reused at commit, and working-pixel budgets hold across representative image sizes.

## ADR-138 - The primary toolbar is icon-first and never wraps
The primary toolbar had fourteen text buttons and wrapped into a second row at
compact desktop widths. That reduced canvas height, shifted the numeric toolbar
and workspace during resize, and made the command surface visually dominant.
Removing commands would improve density at the cost of discoverability.

### Decision

- Every toolbar command uses a pinned `lucide-static` icon. Familiar file,
  import, export, Preview, and Shortcuts actions are icon-only at all widths.
- Specialist commands retain icon-plus-label presentation above 1280 px and
  switch to icon-only at 1280 px and below.
- Icon-only buttons keep the complete command label as their accessible name
  and retain the command registry's tooltip, shortcut, disabled reason, and
  pressed state.
- The toolbar is one non-wrapping row. Its command-group region may scroll
  horizontally on unusually narrow windows; the brand and Shortcuts control
  remain fixed outside that region, except the redundant brand wordmark hides
  below 700 px to preserve every command before scrolling is needed.
- Icons come from the already-approved `lucide-static` dependency. Imported SVG
  strings are build assets, never project or user content.

### Consequences

The workspace no longer jumps between one-row and two-row chrome. Common
desktop widths gain vertical space while specialist labels remain available
where room permits. Operators on narrow windows may need to horizontally scroll
the command group, but every command also remains available from the menus.

## ADR-139 - Right workspace rails are independently collapsible, with machine controls fail-visible

**Status:** Accepted | **Date:** 2026-07-13

### Context

The fixed 320 px Cuts/Layers rail and 300 px machine rail consume most of a
1024 px workspace before the drawing tool strip. The canvas remains technically
responsive but becomes too narrow for practical layout work. Neither rail had a
visibility command, so operators could not trade inspector space for canvas
space without resizing the whole application.

The machine rail also owns the visible Stop control. Treating it like an
ordinary hideable inspector during a stream would remove the primary pointer
target for an emergency stop, even though the global keyboard shortcut remains.

### Decision

- Ephemeral UI state tracks Cuts/Layers and machine-panel visibility
  independently. It is not project data and is not included in undo or `.lf2`.
- Each expanded rail has a header collapse button. A collapsed rail remains as
  a narrow named strip with an expand button, preserving location and
  discoverability.
- Checked commands in the Window menu mirror both visibility states.
- Entering a viewport 700 px wide or narrower collapses both rails once. Users
  may expand either rail while remaining compact; the default reapplies only on
  the next transition into compact mode.
- An active job makes the machine panel fail-visible regardless of its stored
  preference. Its collapse button and Window command are disabled until the job
  is no longer active, so the visible Stop control remains reachable.

### Consequences

Compact windows can recover 280 px per collapsed rail without hiding how to
restore the panels. Ending a job restores the operator's prior machine-panel
preference, so a panel that was collapsed before Start collapses again after the
stream fully settles. Panel visibility remains session-only; persistence across
launches can be added later if user testing shows that preference is valuable.
At 700 px and below, the initial canvas no longer collapses to zero width.

## ADR-140 - CNC profile finish allowance + finishing pass (Phase H follow-up, 2026-07-13)

> **Numbering note.** ADR-137 through ADR-139 are accepted. **ADR-140** is allocated to this decision.

Context. A profile cut removes the full wall across its depth passes, so the
finished edge carries the roughing tool's deflection and chatter. Production CNC
work leaves a small "stock to leave" allowance on roughing and removes it with a
light finishing pass along the true contour for a cleaner wall.

Decision. Optional per-layer `finishAllowanceMm` on CncLayerSettings, for
profile-outside / profile-inside cuts only (0/absent = off, byte-identical).
When > 0:
- Roughing offsets the contour by tool-radius + allowance, staying that far
  proud of the finished wall (profileToolpathPolylines gained an allowance arg).
- One finishing pass at the true contour (tool-radius offset, allowance 0) at
  full depth is appended after the roughing passes.
- Holding tabs: the finishing pass projects the deepest roughing path's
  physical tab-center anchors onto the true contour before splitting it. This
  preserves tab locations even when offset contours choose different start
  vertices or distribute perimeter length differently.

Scope. Profile cuts only. Pocket-wall finishing, profile-on-path, and relief
(which already has its own H.8 finishing skim) are out of scope, documented in
code, and covered by a test showing those cut types are unaffected.

Consequences.
- Determinism (#5): allowance 0/absent is byte-identical (tested).
- HARDWARE-GATED / CLAIMED: the toolpath is unverified on a real machine.
- Tab alignment is start-vertex invariant: finishing gaps are centered by
  nearest-point projection from the matching roughing contour's physical tab
  anchors. Automated tests cover contours with deliberately different start
  vertices. Hardware verification remains required before production use.

---

## ADR-141 - The network-camera bridge is desktop and local-development only

**Status:** Accepted | **Date:** 2026-07-12

> **Numbering note.** ADR-140 records the CNC finish allowance; **ADR-141** is the next allocated decision number.

### Context

An exact hosted-origin allowlist still lets same-origin XSS drive the operator's
loopback bridge and reach private-network cameras. A token delivered to browser
JavaScript would not close that threat because the same XSS could reuse it.

### Decision

The bridge accepts browser requests only from `app://app` and HTTP loopback
origins used by local development. Hosted origins are rejected before any
discovery, probe, proxy, or ffmpeg work. Hosted builds retain USB cameras;
network cameras require Desktop or local development.

### Consequences

A compromised hosted page can no longer use KerfDesk's bridge as a private
network camera oracle. Desktop is the supported network-camera workflow.

---

## ADR-142 - Production desktop tags require a valid Windows signature

**Status:** Accepted | **Date:** 2026-07-12

> **Numbering note.** ADR-141 records the network-camera bridge restriction; **ADR-142** is the next allocated decision number.

### Context

The release workflow could publish an unsigned Windows installer when signing
secrets were absent.

### Decision

Tag builds fail before packaging unless `CSC_LINK` and `CSC_KEY_PASSWORD`
exist. After packaging, `Get-AuthenticodeSignature` must report `Valid` before
publication. Manual dispatch remains an unsigned, non-publishing dry run.

### Consequences

A Windows code-signing certificate is required for the next tagged release.
Missing or invalid signing material fails closed. ADR-135's automatic-update
trust constant remains a separate, deliberate release switch.

---

## ADR-143 - Disable executable CNC checkpoint and start-from-line recovery

**Status:** Accepted; scope narrowed by ADR-215 (a pass-boundary NEW job is the supported recovery; line-based executable resume remains disabled) | **Date:** 2026-07-13

### Context

ADR-136 improved one failure mode by rewinding CNC recovery to a retract-first
boundary, but the app still could not prove that retract was safe. A GRBL `ok`
means a line was accepted into controller/planner processing; it does not prove
that the physical cut completed, that position survived the interruption, or
that the cutter is clear. Automatically moving Z can therefore pull a stopped
or broken tool through stock, clamps, or a shifted workpiece. No generic G-code
preamble can infer tool engagement, retained work coordinates, workholding
integrity, or the correct extraction direction.

### Decision

- Automatic CNC restart from both checkpoints and arbitrary G-code lines is
  disabled. The core resume builder returns a stable policy error for every CNC
  request before it parses or emits any motion.
- The UI removes the executable CNC recovery controls and replaces them with a
  supervised recovery message: inspect engagement, establish clearance with a
  machine-specific procedure, re-home if position may be lost, verify WCS/Z
  zero/tool/workholding, and start a newly reviewed recovery job.
- CNC checkpoints remain visible as diagnostic evidence, including accepted-line
  counts and the recorded interruption cause, until the operator dismisses them.
  Their counts are labelled as controller acknowledgements, not completed motion.
- Laser start-from-line and checkpoint recovery remain available with their
  beam-off positioning rules. Ordinary live Feed Hold/Resume is unchanged; it
  resumes the same controller session and is not crash/start-from-line recovery.

### Consequences

KerfDesk no longer offers one-click continuation for an interrupted router job.
Operators may lose machining time and must create a deliberate recovery job,
but the application will not guess physical cutter state from transport-level
acknowledgements. A future CNC recovery feature requires machine-specific,
hardware-validated state acquisition and a supervised recovery state machine;
re-enabling the old retract-first preamble is not an acceptable shortcut.

---

## ADR-144 - Parametric shape edits rematerialize canonical geometry

**Status:** Accepted | **Date:** 2026-07-13

### Context

Rectangle, ellipse, polygon, and star objects retain their generating parameters, but those
parameters were immutable after the initial canvas drag. The selected-object panel exposed only
laser output overrides, despite calling itself Shape Properties, and disappeared entirely in CNC
mode. Resizing could change the overall transform but could not change a rectangle corner radius,
polygon side count, or star inset.

### Decision

- A single selected parametric shape exposes validated geometry fields in Shape Properties for
  both laser and CNC projects. Multi-selection and polyline node editing keep their existing tools.
- Each edit sanitizes the complete discriminated shape spec, then regenerates bounds,
  compatibility polylines, and schema-v2 canonical curves through the established shape factories.
- Rematerialization preserves object ID, transform, color, power scale, operation override,
  provenance, stacking order, and group ownership.
- One committed field edit creates one undo frame. Invalid or unchanged input creates none.

### Consequences

Parametric objects remain editable instead of becoming effectively baked after creation. Preview,
save, laser compilation, and CNC compilation continue to consume the same materialized paths, so
no downstream shape-specific branch is added. Width and radius values remain object-local geometry;
the existing selection transform controls continue to own whole-object scale, rotation, and mirror.

---

## ADR-150 - Adopt bounded variable-data production as a Phase D extension

**Status:** Accepted | **Date:** 2026-07-13

### Context

Phase D originally scoped ordinary text in bundled fonts. The production workflow now also has
typed serial, date/time, CSV, and cut-setting fields, while this branch adds bounded record and
serial ranges, configurable step size, forward/reverse wrap, and reset. Leaving that capability
outside PROJECT.md would make persistence and output behavior look accidental despite its bounded
validators, deterministic tests, and explicit operator controls.

### Decision

- Adopt variable text and bounded sequence controls as a Phase D production extension.
- Keep imported CSV normalized and embedded in the project; no network or database source is
  introduced.
- Advance values only after explicit operator action, successful export, or completed streaming.
  Failed or stale output must not advance production state.
- Clamp persisted ranges to the embedded dataset and require safe integers for serial arithmetic.
- Barcode/QR fields, live databases, and automatic label imposition remain out of scope.

### Consequences

Variable production is now intentional product scope rather than an undocumented accretion.
Projects remain offline and self-contained, and long runs have deterministic bounds and wrap
semantics. The schema surface grows, so load validation and round-trip tests remain release gates.

---

## ADR-151 - Quick Nest uses bounded outline compaction with rectangular fallback

**Status:** Accepted | **Date:** 2026-07-13

### Context

Rectangle-only nesting wastes material around concave and irregular art. Exact outline compaction
can reduce that waste, but its candidate search and polygon intersections run synchronously on the
UI thread. An item-count limit alone does not bound dense outlines, and a large concave corpus can
freeze the application before the operator can cancel.

### Decision

- Quick Nest may compact placements using sanitized closed object outlines after a conservative
  rectangular nest establishes a valid seed.
- Outline mode is limited to 32 items and a deterministic point-weighted work budget of 250,000
  (`itemCount² × totalOutlinePoints`). Candidate count is independently capped.
- Inputs outside either budget use the existing rectangular algorithm immediately. Invalid
  polygons, Clipper failures, or a non-improving search also fall back to the rectangular result.
- Every accepted outline placement is revalidated against the bed, padding, obstacles, and peer
  geometry before it can update the scene.

### Consequences

Small and medium irregular jobs can save stock without changing the safe default for dense or large
jobs. The synchronous algorithm now has an enforceable upper bound, while rectangular fallback
preserves responsiveness and deterministic placement. Moving outline search to a worker remains a
future optimization, not a prerequisite for safe use.

---

## ADR-152 - Offset pockets may use locally tangent native helical entries

**Status:** Accepted | **Date:** 2026-07-13

### Context

Straight plunges load the cutter poorly in pocket stock. Phase H.9 therefore deferred helical entry
until a dedicated decision could define fit validation, controller motion, preview/tiling behavior,
and refusal boundaries. The first candidate used one shared center helix for every offset ring,
which repeatedly bored cleared air and fed laterally at full depth to each contour.

### Decision

- Offset-ring pockets may opt into a native G2/G3 helical entry with bounded minimum/maximum
  diameter and ramp angle. Raster pockets, open paths, islands, and disconnected pockets refuse the
  option instead of silently reverting to a plunge.
- Every clearing ring receives a deterministic tangent entry whose helix ends exactly at that
  ring's contour start. The circle is fit against the enclosing pocket boundary, so very small
  inner rings can retain the configured minimum diameter without leaving the pocket.
- The emitter retracts to safe Z and relocates before every ring. No shared-center re-boring and no
  full-depth connector move are emitted between the helix and its contour.
- Preview, estimates, origin transforms, tiling, persistence, and preflight treat the helix as a
  first-class descending CNC pass.

### Consequences

Supported pockets enter stock gradually while preserving safe relocation discipline and exact
contour joins. More arcs and retracts can increase output size and cycle time, but avoid ambiguous
links through uncut material. Multi-pocket and island-aware planning remains deferred. The motion
is software-verified and hardware-gated until the standing CNC air-cut and scrap protocol passes.

---

## ADR-153 - Two-tool pocket rest machining uses bounded 2D stock subtraction

**Status:** Accepted | **Date:** 2026-07-13

### Context

A small end mill can reach pocket details that a larger rougher cannot, but clearing the entire
pocket with the small tool wastes substantial time. Rest machining needs an explicit definition of
remaining stock and tool-change order; calling ordinary offset rings "adaptive" would overstate the
planner and hide failure cases.

### Decision

- A pocket layer may select one larger end mill to clear bulk material before its normal smaller
  bit machines only the modeled remainder.
- Remaining stock is computed in bounded 2D: inset legal rougher centers, dilate by the rougher
  footprint, subtract that swept region, expand the remainder by the finishing radius, and intersect
  it with the finishing tool's legal center region.
- The larger-tool section runs first. The existing multi-tool contract inserts one manual M0 tool
  change before the smaller rest section.
- Missing tools, invalid diameter order, open contours, oversized roughers, geometry failures, and
  combination with helical entry block preflight. No invalid request falls back to a full-pocket cut
  with the small bit.
- This feature is tool-diameter-based 2D rest machining, not in-process stock simulation or
  constant-engagement adaptive clearing.

### Consequences

Large pockets can clear faster while retaining small-feature reach and island protection. The
result depends on a deliberate manual tool change and correct Z touch-off. Software tests cover
geometry, ordering, persistence, preview, and preflight; hardware remains CLAIMED until the standing
two-tool air-cut and scrap protocol passes.

---

## ADR-154 - Adaptive pockets require verified constant-load ring sequences

**Status:** Accepted | **Date:** 2026-07-13

### Context

Ordinary pocket offsets can spend long segments at high cutter engagement and do not establish that
the requested stock was actually cleared. Calling them adaptive without a bounded planner and an
independent coverage check would overstate both performance and safety. A first implementation can
support common closed pockets without claiming island-aware or full stock-simulation behavior.

### Decision

- End-mill pockets may opt into deterministic constant-load roughing sequences using an explicit
  optimal load, defaulted to 10% and capped at 50% of tool diameter.
- Planning is limited to sanitized closed, island-free regions. Open contours, islands, invalid
  parameters, and geometry failures block preflight instead of falling back silently.
- Each sequence uses a native locally fitted helical entry and conventional cleanup contours.
- An independent bounded stock-removal verifier must confirm engagement and at least 98.5% coverage.
  Jobs exceeding its 1,000,000-cell budget are refused rather than checked at reduced resolution.
- This is bounded 2D adaptive clearing, not a medial-axis trochoidal planner or full in-process stock
  simulation. Hardware status remains CLAIMED until the standing CNC air-cut and scrap test passes.

### Consequences

Supported pockets receive deterministic, software-verified roughing paths with explicit failure
boundaries. Large pockets and island geometry can be rejected even when an ordinary pocket strategy
would compile; that fail-closed behavior is intentional until a scalable, island-aware verifier is
adopted. The planner, verifier, persistence, preflight, preview, and emitted arcs remain release-gated.

---

## ADR-155 - Straight inlays compile as one radius-matched linked pair

**Status:** Accepted | **Date:** 2026-07-13

### Context

Producing a usable straight-sided inlay requires more than duplicating an outline: the pocket and
insert must share the same machinable corner geometry, apply a deliberate fit clearance, run in a
safe order, and retain independent depths. Treating the two halves as unrelated layers would make
fit and placement easy to desynchronize.

### Decision

- One closed source shape may compile into a linked female pocket and mirrored male insert using the
  same end mill and one radius-compensated canonical contour.
- Fit allowance is specified in millimetres per side and split symmetrically between pocket expansion
  and insert contraction. The insert is placed to the right by a configurable positive spacing.
- The female pocket runs before the male profile. Pocket and insert depths remain independent, and
  the insert may use the standard holding-tab contract.
- Open or unusable geometry, non-end-mill tools, invalid depths or clearances, and offsets that erase
  either half block preflight instead of producing a partial pair.
- This decision covers straight-sided inlays only. Tapered V-carve plugs require a separate model for
  glue gap, surface clearance, and plug stock depth.

### Consequences

The two halves cannot drift in tool radius, allowance, ordering, or persisted settings. Mirroring
creates a ready-to-cut pair but increases required stock width, which preview and bed checks must
still validate. Software verification covers geometry, compilation, ordering, persistence, and
preflight; hardware remains CLAIMED until the standing CNC air-cut and scrap protocol passes.

---

## ADR-156 - Manual CNC tabs use persisted normalized contour anchors

**Status:** Accepted | **Date:** 2026-07-13

### Context

Automatic tab spacing can place bridges on corners, visible faces, or difficult cleanup locations.
Direct manipulation is useful only if the displayed handles, saved project, compensated toolpath,
and emitted gaps all describe the same physical positions after ordinary object transforms.

### Decision

- A selected closed profile object may replace its automatic distribution with object-level anchors
  identified by layer color, path index, polyline index, and normalized contour arc length.
- Dragging projects the handle back onto an eligible source contour. Move, rotate, mirror, scale,
  duplicate, save, and reload preserve the normalized anchors with the object.
- Compilation projects each source anchor onto the matching compensated roughing and finishing
  contours before splitting tab gaps. Objects without manual anchors continue using automatic tabs,
  including other objects on the same layer.
- Reset removes the manual anchors for that layer and restores automatic distribution. One drag is
  one undoable interaction, and Escape restores the pre-drag project.
- Manual positions apply to ordinary closed profile cuts. Generated inlay inserts, click-to-add or
  delete, and triangular 3D tabs remain outside this decision.

### Consequences

Operators can move bridges away from weak or visible locations without losing them across project
round trips or object transforms. Anchors depend on the referenced path topology; a future topology-
changing editor must deliberately remap or invalidate them rather than guessing. Software tests
cover persistence, mixed automatic/manual layers, compensated roughing and finishing paths, and
interaction undo; hardware remains CLAIMED pending the standing CNC cut protocol.

---

## ADR-157 - Detected controller identity gates profile transport and output

**Status:** Superseded in part by ADR-228 — the ordinary-Start controller-qualification refusal was deleted (both machine kinds); transport/output reconciliation and cross-family profile refusal remain. | **Date:** 2026-07-13

### Context

Machine profiles previously carried controller family, streaming mode, receive-window size, and
G-code dialect as independently selectable fields. After firmware detection, those fields could
describe different controller families, leaving a seemingly valid profile able to stream with a
stale driver or emit an incompatible dialect.

### Decision

- One pure compatibility policy reconciles configured and detected controller family, streaming
  mode, bounded receive window, and output dialect while reporting every correction.
- Marlin and Smoothieware use one-line acknowledged streaming. Crossing back to a GRBL-family
  controller restores character-counted streaming; compatible explicit GRBL choices remain intact.
- A completed settings read may overlay controller-reported machine limits onto catalog defaults.
  Before such a read, selecting a profile does not borrow stale limits from the current connection.
- Once firmware is detected, profiles for another controller family remain visible but cannot be
  applied. Start and Resume refuse if configured, active, and detected controller identities differ.
- Simulator evidence does not upgrade a controller family to hardware-verified status. Existing
  catalog confidence labels and the physical fault matrix remain authoritative.

### Consequences

Profile selection, connection diagnostics, persisted transport fields, output strategy, and Start
readiness now share one controller contract. Operators may need to reconnect after changing profile
families, and unsafe cross-family combinations fail visibly rather than being corrected only at
stream time. The policy expands safety coverage without claiming a broader hardware ecosystem.

---
## ADR-158 - Browser smoke is independent from the release and deploy gate

**Status:** Accepted | **Date:** 2026-07-13

### Context

`release:check` installed and launched a full browser test environment before every core CI and
Cloudflare deployment. Browser provisioning has different failure modes and runtime variance from
the deterministic unit, type, lint, build, and policy gates; a browser timeout could therefore block
an otherwise verified production build and duplicate the same expensive work during deployment.

### Decision

- Keep Playwright as the real-browser smoke framework and type-check its suite explicitly.
- Run browser smoke in a dedicated pull-request and manually dispatched workflow with its own
  concurrency cancellation and failure artifacts.
- Remove Playwright installation and execution from `release:check`, the core CI workflow, and the
  Cloudflare deploy workflow. Deployment continues to require a successful core CI revision.
- Browser smoke remains an enforceable review signal when branch protection requires its named
  check, but browser provisioning is not a production deploy dependency.

### Consequences

Core verification and deployment have bounded infrastructure requirements, while browser failures
remain visible with traces and screenshots in their own workflow. A repository that wants browser
smoke to block merging must require `Chrome UX smoke` explicitly rather than relying on the release
gate to run it incidentally.

---
## ADR-159 - Schema v2 curves are canonical and compatibility polylines are invalidated

**Status:** Accepted | **Date:** 2026-07-13

### Decision

Project schema v2 stores line, cubic, and elliptical-arc curve subpaths. When `curves` are present,
they are the editable source of truth and machine consumers flatten them with explicit tolerance and
segment budgets. Curve edits regenerate compatibility polylines; a legacy polyline-only edit deletes
the stale curve field. Serialization promotes remaining polyline-only paths to line curves, and the
v1→v2 migrator performs the same one-way promotion for old projects.

### Consequences

Preview, hit testing, save, laser compile, and CNC compile cannot silently choose conflicting copies
of geometry. Topology-changing code must update curves and rematerialize polylines, or deliberately
invalidate curves. Budget exhaustion refuses the operation instead of emitting partial geometry.

---

## ADR-160 - Rotary raster is an explicit experimental amendment to ADR-127

**Status:** Accepted | **Date:** 2026-07-13

### Decision

ADR-127's vectors-only refusal remains the default. Raster rows may use the same rotary machine-space
Y transform only when both rotary and rotary-raster Labs gates are enabled and the output caller
passes the explicit permission. Otherwise preflight returns `rotary-raster-unsupported`. Surface
row spacing is scaled; pixel power data and non-rotary output remain unchanged.

### Consequences

The experimental path is testable without weakening saved-project or encoder defaults. It remains
hardware CLAIMED and must not be presented as verified cylindrical photo engraving.

---

## ADR-161 - Labs gates experimental laser features locally and fail closed

**Status:** Accepted | **Date:** 2026-07-13

### Decision

Tools → Labs owns explicit gates for rotary, rotary raster, low-power Fire, print-and-cut, and camera
alignment v2. Gates default false, tolerate unavailable/corrupt local storage by reverting false,
and encode dependencies (`rotaryRaster` implies `rotary`; disabling rotary disables its raster gate).
They are workstation consent, not portable project authorization; output paths must receive explicit
permission rather than reading UI storage from core code.

### Consequences

Opening a project on another machine cannot silently arm experimental behavior. Each feature still
requires its own profile, capability, preflight, and hardware-confidence checks.

---

## ADR-162 - Low-power Fire is profile-opted, hard-capped, and momentary

**Status:** Accepted | **Date:** 2026-07-13

### Decision

Fire appears only for laser projects when the Labs gate, controller capability, profile capability,
and profile `fireControl.enabled` all agree. Power is capped by the configured limit and an absolute
5% ceiling. The control requires a known idle position with no alarm, job, motion, probe, autofocus,
controller operation, or pending untracked acknowledgement. Pointer/key release, leave, cancel,
window blur, visibility loss, unmount, and error all request laser-off; release emits `M5`.

### Consequences

Fire is a supervised positioning aid, not a persistent power toggle. Profiles without an explicit
safe contract expose no control, and simulator coverage does not replace a physical safety pass.

---

## ADR-163 - Cut Planner exposes five persisted deterministic policies

**Status:** Accepted | **Date:** 2026-07-13

### Decision

The former `reduceTravelMoves` switch is retained only as a compatibility mirror. The persisted Cut
Planner owns travel policy, inside-first ordering, layer priority, path-direction reversal, and the
planning start reference. Nearest-neighbor ordering is deterministic, preserves semantically ordered
raster/scanline work, and falls back to source order above its 2,000-segment synchronous budget.
This is a bounded greedy planner, not a claim of full 2-opt optimality.

### Consequences

Operator intent round-trips and output remains deterministic. Adding another policy requires schema
validation, legacy defaults, output tests, and a new complexity bound.

---

## ADR-164 - Adopt bounded offline editing and interoperability already shipped

**Status:** Accepted | **Date:** 2026-07-13

### Decision

- Adopt bounded node and Bezier-handle editing for imported/materialized paths under ADR-159's
  geometry invalidation rule; general weld/boolean/offset kernel work remains deferred.
- Adopt defensive LightBurn `.clb` import into native libraries and refreshable native preset-to-layer
  bindings. `.clb` export, manufacturer packs, and LightBurn `LinkPath` synchronization remain deferred.
- Adopt explicit `.ttf`/`.otf` import with project embedding under count and byte budgets. Automatic
  host system-font enumeration remains out of scope.
- Adopt bounded offline variable text from embedded CSV, serial, date/time, and cut-setting fields.
  Network/database sources, barcode/QR generation, and automatic imposition remain out of scope.

### Consequences

These tested capabilities are intentional product scope rather than undocumented exceptions. Their
offline, bounded persistence contracts remain release gates; this decision does not authorize the
larger geometry, cloud-data, font-discovery, or LightBurn round-trip systems named above.

---

## ADR-171 - Work-Z readiness uses source-qualified, epoch-bound evidence

**Status:** Superseded in part by ADR-228 — readiness no longer refuses Start (Job Review warns); the epoch-bound evidence model itself remains in use. | **Date:** 2026-07-13

### Context

The CNC stock-top contract was represented by one session Boolean. It recorded neither how Z0 was
established nor which reference state it belonged to. A future invalidation omission could
therefore let stale truth suppress the Start warning or unlock tool-change Continue. Persistent
origin paths also emit `G92.1`, which clears a prior `G92 Z0` even when persistent XY authority
remains valid.

### Decision

- Replace the Boolean with `WorkZZeroEvidence { source, referenceEpoch }`, where source distinguishes
  a manual Zero Z from a fully settled probe transaction.
- Maintain a dedicated `workZReferenceEpoch`. Normal motion and XY-only origin changes preserve it.
  Reconnect, reset, alarm, home, tool changes, probe attempts, Z/tool/full-WCS console mutations,
  motor release, and configuration changes advance it and clear the evidence.
- Start advisories and tool-change Continue accept evidence only when its epoch equals the current
  work-Z reference epoch.
- Reset Origin and Set Persistent Origin invalidate Z evidence because their command sequences emit
  `G92.1`. Multi-write actions apply that invalidation after the successful `G92.1` write, so a later
  `G10` failure cannot leave stale evidence behind.

### Consequences

Known motion no longer causes unnecessary re-zeroing, while reference-changing operations cannot
reuse an earlier bit-to-stock claim. The record still does not prove active tool identity, physical
touch-plate removal, WCS number, clamp state, or spindle-at-speed; those require additional modeled
evidence and hardware qualification.

---

## ADR-172 - Missing qualified work Z blocks CNC Start

**Status:** Superseded by ADR-228 — the block is demoted to a Job Review warning; Zero Z and probing remain available in the panel. | **Date:** 2026-07-13

### Context

KerfDesk's generated CNC programs define Z0 as the stock top, but Start treated
missing work-Z evidence as an overridable warning. Continuing could therefore
apply every programmed depth from an unknown datum. ADR-171 made the evidence
source-qualified and reference-epoch-bound, so the host can now distinguish
current setup evidence from missing or stale state without relying on XY origin.

### Decision

- Missing, stale, or absent work-Z evidence is an early CNC Start blocker.
- Manual Zero Z and a fully settled probe are accepted only when their evidence
  epoch matches the current work-Z reference epoch.
- Set Origin remains XY-only and cannot satisfy the Z gate. Laser jobs retain
  their existing Start behavior because they have no stock-top depth contract.
- Other machine/project advisories remain warnings; this policy change is
  limited to the datum required by the emitted CNC coordinates.

### Consequences

An operator must explicitly establish stock-top Z0 before every fresh CNC Start
after a reference-invalidating event. This adds setup friction but removes a
direct path to cutting at the wrong physical depth. It still does not prove
tool identity, clamping, plate removal, or spindle-at-speed feedback.

---

## ADR-173 - Bind work-Z evidence to the compiled CNC tool plan

**Status:** Superseded in part by ADR-228 — a tool-vs-evidence mismatch warns in Job Review instead of blocking; the binding model remains in use. | **Date:** 2026-07-13

### Context

Epoch-bound evidence proved that Z0 was freshly established, but not which cutter was in the
spindle. Z0 for a 3.175 mm end mill could therefore unlock a job whose first compiled section uses a
different bit. The same ambiguity existed after M0: a freshly zeroed but wrong replacement cutter
could unlock Continue. Comment labels improved operator guidance but were not stable identity.

### Decision

- Manual Zero Z and probe transactions snapshot the stable ID of the Active bit when the physical
  reference operation begins. A project edit while probing cannot relabel the completed evidence.
- The prepared CNC Job produces structured tool-plan metadata from its exact contiguous section
  order. The metadata travels beside the stream; emitted G-code remains byte-identical.
- CNC Start requires current Z evidence whose tool ID matches the first compiled section. Each M0
  hold carries the next section's ID and Continue requires newly established evidence for that ID.
- Legacy/imported streams without structured IDs retain their existing label-only behavior; native
  KerfDesk CNC compilation always supplies the structured plan.

### Consequences

Changing the selected cutter or compiling a different first section can no longer reuse unrelated
Z evidence. The host proves consistency between operator-selected tool identity, Z evidence, and
the compiled plan; it still cannot physically sense the cutter, clamp, touch plate, or spindle.

---

## ADR-179 - Block controller-reported active spindle/coolant before CNC Start

**Status:** Superseded by ADR-228 — active-accessory findings are Job Review warnings; the live-state fence relaxed to one fresh status report (transport liveness). | **Date:** 2026-07-13

### Context

GRBL `Idle` means motion is idle; it does not mean spindle and coolant are off. A manual command or
interrupted workflow can leave `M3`, `M4`, `M7`, or `M8` active before KerfDesk's controlled CNC
preamble. GRBL reports controller-commanded accessories in `A:`: `S` is clockwise spindle, `C` is
counter-clockwise spindle, `F` is flood, and `M` is mist. The field appears alongside the
intermittent `Ov:` report only while an accessory is active, so `Ov:` without `A:` is the protocol's
all-off observation. A frame with neither field carries no new evidence.

This status is controller state, not physical sensor feedback. It cannot prove spindle RPM, coolant
flow, relay position, or that external hardware followed the command.

### Decision

- Parse `A:` and cache its last observation across sparse status frames. Preserve an active cache
  until an `Ov:` frame without `A:` observes all accessories off. Clear the cache when connection or
  controller-reset evidence is lost.
- Block CNC Start and CNC resume whenever the live cache reports any spindle direction or coolant
  channel active. Name every active channel in the blocker.
- While CNC controls are otherwise idle, show a recovery action for active accessories. It sends one
  guarded, acknowledged `M5 M9` block only after the operator confirms the cutter is clear and
  stopping is safe; Start stays blocked until a fresh status report confirms the all-off state.
- Arming any job stream invalidates the prior accessory observation. A partial initial or refill
  write may already have executed accessory commands even when transport reports failure.
- After the final CNC setup confirmation, discard the pre-modal cache and actively request status
  until a fresh `Ov:`/`A:` observation arrives. Before that request, reserve an app-wide
  `start-arming` controller operation, drain earlier app acknowledgements, and send an acknowledged
  queued dwell marker. Its `ok` is the inbound/command fence: earlier app commands and buffered
  serial output have been consumed before the live observation. Recheck the zero-ack ledger and
  every live gate synchronously before arming.
- Reserve transport writes before awaiting the port, then atomically transfer successful writes to
  the ack ledger. Reset/reconnect advances a write epoch: late completions from the old epoch reject
  and cannot decrement current counters or reassert origin/work-Z evidence. The queued Start marker
  must receive a correlated positive `ok`; `error`, `ALARM`, timeout, or reboot cancels arming.
- CNC Start fails closed while `A:`/`Ov:` evidence is missing. Any app command that can change
  spindle or coolant state invalidates the prior observation until a fresh accessory report arrives.
  Laser Start is unchanged. Firmware that omits these fields cannot run CNC jobs with this gate.
- grblHAL `SP1:`/`SPn:` secondary-spindle telemetry is a hard blocker. KerfDesk does not yet model
  machine-specific spindle selection and recovery, so it must not collapse those spindles into `A:`
  or offer the primary-spindle `M5 M9` recovery action.
- grblHAL `A:E` (spindle encoder fault) and `A:T` (firmware tool change pending) are hard blockers.
  Exceptional flags latch across ordinary `Ov:`-without-`A:` frames and clear only on reset/reconnect
  or an explicit `A:` report that omits them.
- A reboot banner cancels `start-arming`, invalidates volatile origin/work-Z/position evidence, and
  advances setup epochs. The final arm boundary must still own the reservation and the same epochs.

### Consequences

KerfDesk no longer treats motion-idle as an accessory-neutral CNC handoff. A stale commanded spindle
or coolant state is stopped and observed before the job-owned retract/spin-up sequence begins. The
single-block recovery avoids issuing `M5`, invalidating cached Idle, and then incorrectly attempting
a separately guarded `M9`. Physical at-speed and output feedback remain future hardware/profile work.
The safety claim requires KerfDesk to be the controller's only command owner. A pendant, WebUI,
second serial/network sender, PLC, or firmware macro can mutate state after any observation; GRBL has
no transaction that atomically couples a status report to the following job bytes. Those concurrent
external mutations remain outside KerfDesk's single-sender contract and require a controller/VFD
interlock or machine-specific supervisory protocol.

---

## ADR-180 - Generic same-session CNC Resume is manual-recovery-only

**Status:** Accepted | **Date:** 2026-07-13

### Context

KerfDesk already refuses CNC checkpoint and start-from-line recovery, but its
ordinary Pause/Resume path still treated a router like a laser stream: Pause
sent GRBL realtime feed hold (`!`), then Resume immediately sent cycle start
(`~`) and refilled the stream. GRBL normally keeps a spindle commanded during
feed hold, but KerfDesk did not prove that the controller reached a settled
hold or that the spindle remained running. A safety-door transition,
spindle-stop override, VFD fault, pendant, WebUI, PLC, or other sender can stop
the cutter while it remains engaged. Blind cycle start can then feed a
stationary cutter.

An `A:`/`FS:` status snapshot is not enough to repair the generic path. It
reports controller-commanded state at one instant, not uninterrupted physical
rotation, VFD health, coolant flow, or exclusive ownership. A newline queue
fence is also invalid during a paused stream because outstanding job lines and
terminal responses already own that ordered channel.

### Decision

- Pause remains available for CNC and sends the controller's realtime hold.
  Its copy now warns that continuation requires Stop and supervised recovery.
- Generic CNC Resume is disabled in the UI and independently rejected in the
  store before `~` or any stream refill. The paused streamer remains intact so
  Stop stays available.
- KerfDesk does not auto-start/orient the spindle or guess a retract direction
  while cutter engagement is unknown. The operator must inspect and clear the
  cutter using a machine-specific procedure, then run a newly reviewed job.
- Laser/non-CNC same-session Resume is unchanged.
- A future CNC opt-in requires an explicit machine-profile policy, exclusive
  control of every mutating path, controller-visible safety/VFD faults, and an
  ack-neutral realtime-status arbiter. It must prove stable settled Hold state
  and unchanged session/setup/spindle evidence before sending cycle start. No
  current profile is silently opted in.

### Consequences

An operator can still stop feed promptly with Pause, but cannot continue a
generic router job with one click. This trades machining time for a fail-closed
engagement boundary and removes the stationary-cutter failure described by the
maintainer. Hardware-backed spindle-at-speed and machine-specific continuation
remain a separate, fault-injected implementation rather than an inference from
legacy GRBL telemetry.

---

## ADR-181 - CNC Start requires epoch-bound exclusive-access attestation

**Status:** Accepted | **Date:** 2026-07-13

### Context

GRBL terminal responses are bare `ok`/`error` lines with no sender identity,
session nonce, or command ID. Status reports describe global controller state,
not who caused it. A queue fence and fresh Idle/accessory snapshot therefore
have meaning only while KerfDesk is the sole mutating sender. A pendant/MPG,
controller WebUI, network or second serial sender, PLC command path, macro, or
SD/file job can change motion, offsets, spindle, coolant, or overrides before
the first job bytes without producing evidence KerfDesk can attribute.

### Decision

- The existing per-Start CNC physical-setup confirmation also requires the
  operator to affirm that KerfDesk is the only command owner. The prompt names
  common alternate paths and explicitly preserves emergency-stop, safety-door,
  and feed-hold circuits.
- The attestation is bound to the exact G-code fingerprint and to the current
  composite controller/setup epoch: trusted-position and work-Z-reference
  generations. Reconnect, reset/banner, alarm/sleep, homing, origin/probe
  changes, tool changes, and other trust invalidations make it stale.
- The store revalidates the attestation before the Start queue fence. Missing,
  incomplete, wrong-program, or stale evidence writes no controller byte.
- The existing Start reservation continues to require the same epochs through
  the queue fence and fresh live-readiness observations.

### Consequences

This is a fail-closed operator declaration, not protocol proof or a hardware
ownership lease. Stock GRBL still cannot exclude or identify other command
paths. True multi-sender support requires a sole gateway or firmware lease plus
machine-level selector/interlock enforcement; physical spindle-at-speed and VFD
feedback remain separate evidence.

---

## ADR-182 - grblHAL MPG ownership is a latched CNC Start blocker

**Status:** Accepted | **Date:** 2026-07-13

### Context

ADR-181 makes sole command ownership an operator contract because stock GRBL
cannot identify input owners. grblHAL provides one narrower piece of explicit
evidence: status field `MPG:1` reports that manual-pulse-generator mode has
taken controller input ownership, and `MPG:0` reports its release. The field is
intermittent, so a later status frame that omits it cannot prove ownership was
returned. Starting a queue fence while a known MPG owner is active can also
misattribute another sender's bare `ok` to KerfDesk.

### Decision

- Parse only exact `MPG:1` and `MPG:0` fields. Missing or malformed fields are
  unknown, not inactive.
- Latch explicit MPG evidence across ordinary status reports. Clear an active
  latch only on explicit `MPG:0` or a new controller/transport session.
- On the first transition to active, invalidate trusted position, work-Z, and
  Verified Frame evidence. Repeated sparse/redundant reports do not churn the
  epochs, and `MPG:0` does not restore the invalidated setup.
- For CNC only, block a known active MPG owner before the Start queue fence.
  Recheck the latch after the fresh live-status query and before arming job
  bytes, so an acquisition observed during Start also fails closed.
- Laser jobs and controllers that never report MPG retain existing behavior.
  ADR-181's operator attestation remains required because `MPG:0` is not proof
  that every network, serial, PLC, macro, or physical command path is inactive.

### Consequences

KerfDesk no longer sends CNC Start traffic after receiving explicit evidence
that a grblHAL pendant/MPG owns input. The operator must return control and wait
for `MPG:0`. This is one protocol-visible competing-owner signal, not a general
ownership lease; unexpected-ack contamination is intentionally a separate
decision because attribution false positives require a broader ledger audit.

---

## ADR-183 - Unexpected GRBL terminal responses invalidate controller ownership

**Status:** Accepted | **Date:** 2026-07-13

### Context

GRBL-family `ok` and `error` replies do not identify their sender or command.
KerfDesk can attribute them only while one of its own ledgers owns a response:
an in-flight stream line, a reserved non-stream line, or the shared interactive
command arbiter. The existing autofocus path bypassed those ledgers with a
second line subscription, while the transport ledger reserved an owed ack only
after `write()` resolved. Both created false attribution windows. Conversely, a
bare terminal response with no owner is evidence that a second sender, macro,
or controller-side path may be mutating the same session.

### Decision

- GRBL, grblHAL, and FluidNC classify every terminal response against the
  pre-consumption ownership snapshot. Marlin, Smoothieware, Ruida, and
  nonterminal lines are not included in this first policy.
- Non-stream writes reserve their owed terminal responses synchronously before
  awaiting the transport. Failed writes release the reservation; a reply that
  arrives inside the transport Promise window is therefore still attributable.
- Autofocus uses the single shared command arbiter and write/ack ledger. Its
  composite completion requires a terminal `ok` plus a qualified later Idle or
  an observed active-to-Idle cycle, without installing a private line reader.
- A terminal response with no KerfDesk owner is intercepted before it can
  advance a stream or enter ordinary error routing. The first response is
  latched for the serial session, invalidates trusted-position, work-Z, and
  Verified Frame evidence once, and raises a safety notice.
- Notice dismissal, alarm, and controller banner/reset do not erase the latch.
  Disconnect or a new connection clears it. CNC Start checks the latch before
  its queue fence and again at final live readiness.

### Consequences

KerfDesk detects command-channel contamination that legacy GRBL cannot identify
directly, and it no longer lets autofocus double-consume shared replies. The
detector is intentionally conservative: a reply observed while KerfDesk owns a
different valid command can still be misattributed because the firmware has no
client identity. This is anomaly detection, not an exclusive lease; production
multi-sender machines still require a sole gateway or machine interlock.

---

## ADR-186 - Keep guided device setup machine-relevant and directly repairable

**Status:** Accepted | **Date:** 2026-07-14

### Context

The guided setup reducer was safe and draft-only, but every project traversed the same seven-step
order. Laser users therefore reached a CNC touch-plate page whose only action was to skip it. Picking
a catalog profile required another Next click, and the final readiness checklist identified problems
without returning the operator to the field that could resolve them.

### Decision

The pure setup state machine owns a machine-specific visible step order. Laser setup omits CNC
probing; CNC setup retains it. Choosing a catalog profile applies it to the draft and advances to the
confirmation editor in the same interaction. Every readiness row exposes a direct edit action mapped
to identity, confirmation, or homing/options without bypassing validation or committing early.

### Consequences

- Laser setup contains six relevant steps; CNC setup contains seven.
- Draft-only editing, Cancel semantics, controller facts, and Finish readiness gates are unchanged.
- Hidden machine-irrelevant steps cannot be reached through reducer navigation.
- Every dialog size is viewport-bounded so the wizard footer remains reachable on compact screens.
- Reducer, component, and compact Chromium workflow tests pin both machine paths.

---

## ADR-184 - Probe cycles are exclusive, typed, and settlement-qualified

**Status:** Accepted | **Date:** 2026-07-13

### Decision

The live store accepts probe geometry and mode, never caller-authored G-code. It expands that typed
request with the audited GRBL builders, commands spindle and coolant off, and requires a current
Idle report whose spindle speed is zero. Every probe line owns one response through the shared
controller arbiter. Success requires the complete sequence, a FIFO planner fence, two fresh Idle
reports, and the same connection/transaction identity.

Probe reservation invalidates work-Z evidence; an XYZ-corner cycle also invalidates WCO, Verified
Frame, and XY-origin identity, while a Z-only cycle preserves them. A failure after any possible
motion or coordinate write either enters GRBL alarm handling or sends soft reset and retains an
exclusive recovery lock until the controller's reboot banner and subsequent fresh Idle. A missing
reset/Idle proof stays locked until disconnect; it never falls back to a Start-able state. Realtime
overrides are blocked for the whole transaction.

### Consequences

An arbitrary command list or parser `ok` cannot establish stock-top evidence. A timeout cannot
release Start while buffered probe motion may remain. Probe success is qualified software evidence,
not a claim that the physical plate, wiring, spindle coast-down, or machine geometry was verified.

---

## ADR-185 - Commit XYZ corner-probe offsets in one GRBL block

**Status:** Accepted | **Date:** 2026-07-13

### Decision

The XYZ corner-probe builder performs its Z, X, and Y contacts without changing the selected work
coordinate system. All positioning before the final commit is relative to the measured contacts and
fixed retreats. After all six contacts succeed, one `G10 L20 P0 X... Y... Z...` block writes the
complete corner frame. Only its acknowledged result permits the final absolute park and the normal
settlement proof from ADR-184.

### Consequences

A failed X or Y leg cannot leave GRBL with only Z or X rewritten. This is command-level atomicity,
not a claim that GRBL's EEPROM write is power-loss transactional. Failure after the combined G10 is
still coordinate-uncertain and remains covered by ADR-184's evidence invalidation and reset/recovery
lock. The computed geometry is unit/integration tested but still requires supervised, tool-free
hardware validation for plate dimensions, corner signs, clearances, and repeatability.

This decision depends on the separate G54-selection and G94-feed-normalization changes. Until those
land, `P0` can target a stale active WCS and probe feeds can inherit inverse-time mode. TLO/G92
readback remains a separate fail-closed prerequisite before this workflow is production-qualified.

---

## ADR-187 - Validate every supported laser G-code dialect with one property corpus

**Status:** Accepted | **Date:** 2026-07-14

### Context

GRBL output had broad property coverage for deterministic bytes, laser-off travel, bounds, and power
scaling. Marlin and Smoothieware had focused examples and lifecycle simulators, but their materially
different power encodings did not receive the same generated-job pressure. That left a validation
asymmetry at the exact boundary where firmware interpretation differs.

### Decision

- Generate bounded cut and fill jobs from one shared fixture corpus for GRBL, Marlin inline power,
  Marlin synchronous fan power, and Smoothieware.
- Run 100 generated cases per property for determinism, laser-off travel, in-bed coordinates, and the
  firmware-specific power scale.
- Constrain Marlin fan output to documented `M106 S0..255` / `M107` semantics with no motion-line
  power words, and Smoothieware output to its documented fractional `S0..1` range.
- Route representative Marlin fan and Smoothieware projects through the exact Save/Start composition
  and byte-pin the resulting programs beside the GRBL and CNC corpus.
- Keep physical-machine confidence separate. Software and simulator evidence cannot relabel a
  profile as hardware-verified.

### Consequences

A change to shared planning or to any supported laser dialect now crosses the same generated safety
properties and creates reviewable snapshot churn at the production output boundary. The additional
tests improve confidence without changing emitted machine behavior. Ruida remains an experimental,
file-only encoder and is outside this G-code acceptance claim until independently decoded or tested
on representative hardware.

---

## ADR-188 - Reject unproved XYZ corner-probe plate geometry before controller output

**Status:** Accepted | **Date:** 2026-07-14

### Decision

An XYZ corner-probe request must name the starting cutter-center X and Y offsets, tool kind,
side-contact drop, and outward side clearance. Before generating a line, a pure validator proves:

- the side-contact height remains at least 1 mm above the stock and below the plate top;
- the starting cutter is fully supported over the plate by its radius plus 1 mm margin;
- the outward rapid clears the plate face by the cutter radius plus 1 mm margin; and
- the final park is derived to clear the stock by the cutter radius plus 1 mm margin.

Only cylindrical end mills with a straight side flank are accepted; ball-nose, V-bit, and engraving
tool diameters do not represent the contact radius at an arbitrary flank height. Every dimension is
bounded to 100 mm and must be representable at the emitted 0.001 mm G-code precision; cutter
diameter therefore uses 0.002 mm increments so its derived radius is also representable.

Invalid, missing, non-finite, or non-positive geometry produces no probe program. The live store
returns a preflight reason before reservation, `M5`, `M9`, or any other serial write; an already-busy
machine may report that higher-priority blocker instead of the geometry detail.
The formerly hidden square 15 mm plate-center assumption becomes separate editable X/Y measurements
so rectangular corner plates are modeled without pretending both insets are equal.

### Consequences

Thin plates, tapered/profiled tools, oversized cutters, unrepresentable values, and insufficient
clearance can no longer enter the owned probe transaction. Exact boundary and randomized invariant
tests cover the static model. The entered plate thickness remains a metrology input: its measurement
error shifts the resulting stock Z0 by the same amount, so the UI must not describe it as
self-calibrating.

This decision does not claim a safe machine-travel envelope. Raw GRBL `MPos` cannot yet be compared
honestly with KerfDesk's profile bounds because position units, homing-frame origin, reset epoch, and
firmware build options are not all qualified. XYZ corner probing remains non-production-qualified
until that owned coordinate proof, the pre-G10 planner fence, TLO/G92 readback, and accessory
coast-down safeguards land.
---

## ADR-190 - Make vector power mode explicit per layer without changing defaults

**Status:** Accepted | **Date:** 2026-07-14

### Context

KerfDesk selected constant or dynamic laser power only from the active G-code dialect and operation
kind. That provided sound defaults but no layer-level compatibility control. GRBL documents M4 as
dynamic laser-power scaling when laser mode is enabled, while LightBurn exposes Constant Power as a
per-layer alternative to its variable-power default. Users therefore expect to select M3 or M4 for
an individual vector operation without changing every layer or editing exported G-code.

### Decision

- Add an optional `powerMode` setting with `constant` and `dynamic` values to vector layer settings,
  job groups, material recipes, sublayers, clipboard settings, and project validation.
- Present **Auto (device default)**, **Constant (M3)**, and **Dynamic (M4)** in Line and Fill Cut
  Settings. Auto stores no override and preserves the existing dialect decision byte-for-byte.
- Apply an explicit override only to cut/fill groups. Raster remains group-managed because its
  emitter owns laser-off travel, scan power, and shutdown transitions.
- Keep power mode modal across groups, emitting M5 before an M3-to-M4 change and changing mode before
  the affected group's first burn command.
- Reject unknown persisted values rather than guessing at a machine command.

### Consequences

Existing projects and Auto layers emit unchanged output. Advanced users can choose M3 for firmware
compatibility or full-power vector cutting and M4 for speed-scaled engraving on compatible firmware.
The selection persists with projects and materials, but it does not assert that every firmware build
supports dynamic power; machine documentation and laser mode configuration remain authoritative.

---

## ADR-189 - Bind controller observations and Home proof to controller sessions

**Status:** Accepted | **Date:** 2026-07-14

### Decision

Controller status and settings observations carry a controller-session epoch. Status also carries a
monotonic receive sequence, observation time, and the current trusted-position epoch. A Home command
can create proof only after its owned command, planner marker, and fresh Idle settlement all complete
without changing the write, session, position, or operation identity. Reboot, alarm, Sleep, MPG
takeover, unexpected terminal responses, disconnect, replacement connection, console mutation, and
commanded soft reset invalidate the relevant evidence.

GRBL `$10`, `$13`, and `$27` are retained in the settings snapshot. Pure modules strictly parse the
reported stock-GRBL `[VER:]`/`[OPT:]` response, normalize inch-reported MPos, and derive the firmware
machine-coordinate sign convention from maximum travel, `$23`, and `OPT:Z`. Unsupported build
options and the documented `OPT:P` plus `OPT:Z` incompatibility fail closed.

### Consequences

An old port callback, stale Idle, or reset-era settings dump cannot silently become current Home or
session evidence. This change sends no new controller commands and does not yet qualify machine
coordinates or enable probing. The ordinary settings collector remains advisory; the later safety
path must own `$I` and `$$`, reject duplicate/missing settings, require a fresh direct MPos, and consume
the current Home proof before constructing a probe envelope.

## ADR-191 - CNC 3D result pane is drag-resizable with a persisted width

**Status:** Accepted | **Date:** 2026-07-14

### Decision

The CNC "3D result" pane (`Cnc3DPane`) exposes a drag handle on its left edge — the seam with the
flexible canvas. Dragging it, or focusing it and pressing ArrowLeft/ArrowRight, sets the pane width,
clamped to [200, 560] px. The chosen width persists in localStorage
(`laserforge.cnc-3d-pane-width.v1`), guarded for non-browser contexts, so it survives reloads like the
CNC Basic/Advanced disclosure (ADR-111). The three.js scene handle gains a `resize(w, h)` method, and
a ResizeObserver re-fits the renderer and camera on every width change so the render-on-demand scene
stays crisp instead of scaling a stale buffer.

### Consequences

The operator recovers horizontal room for the adjacent fixed columns (Cuts/Layers, machine rail) by
narrowing the pane, which was clipping their content off the right edge on smaller windows. Pane width
is session-durable UI state, not project data, so it is not in undo or `.lf2`. The pane still collapses
to a 44 px strip via its existing toggle; the resize handle is hidden while collapsed.

## ADR-192 - CNC frame retracts to safe Z, traces, then restores the pre-frame Z

**Status:** Accepted | **Date:** 2026-07-14

### Decision

Framing a CNC job emits, in order: a safe-Z retract (`$J=G90 G21 Z<safeZ>`), the five-leg
XY perimeter, then a restore jog back to the bit's pre-frame work Z. Before this, CNC
framing retracted to safe Z and left the bit parked there — so after an operator set Z0 at
the stock top and pressed Frame, the bit hung at the clearance height with no way back
except a manual jog or a second Zero Z. Pressed at that parked height, Zero Z silently moved
Z0 upward (the air-cut trap addressed in ADR-adjacent probe/Zero-Z work). Frame is a
non-destructive preview, so it must leave the machine at the Z it found.

The retract and restore are gated on a current work-Z zero (`isWorkZZeroEvidenceCurrent`) and a
known pre-frame Work-Z position. The retract targets the WORK frame, so without an established Z0
that height is an arbitrary physical position and the jog could drive the bit into the stock.
An XY-only perimeter is not a safe substitute for CNC: it can drag a cutter through stock or
workholding. CNC Frame therefore refuses before any write when either proof is absent. When the
pre-frame Z already equals safe Z, the redundant restore jog is omitted.

The same evidence rule applies to click/command point moves that prefix XY motion with an absolute
work-frame safe-Z retract. A CNC point move with missing, stale, or wrong-session Work-Z evidence is
refused before the retract or XY jog writes any controller byte. Relative Z-only and ordinary jogs
that do not synthesize an absolute safe-Z target are unchanged.

Line assembly lives in `ui/state/cnc-frame-lines.ts` (`buildCncFrameMotion`), which only
ORDERS lines produced by the driver seam — the XY perimeter and the absolute-Z jog builder
(`buildFrameRetract`, reused for both the retract and the restore) — so ADR-094's "no
protocol bytes outside the driver" boundary holds. The shared work-Z reader
(`currentWorkZMm`) moved to `ui/state/infer-machine-position.ts` as the Z-only dual of
`inferCurrentMachinePosition`, shared with the Zero-Z overwrite guard.

### Consequences

- Fixes the reported "frame lifts the bit even after a Zero Z": the bit returns to its
  pre-frame height (Z0 when it was touching the stock) instead of parking at safe Z.
- The previously unconditional CNC retract (a blind work-frame Z jog with no Z0) is gone;
  framing without current Z evidence or a known pre-frame Z is blocked with an exact message.
- A normal CNC frame gains one queued `$J=` restore line; laser framing is byte-identical.
- WORKFLOW.md F-B4 gains a CNC framing subsection describing retract → trace → restore.
- Not hardware-verified — proven by unit tests over the assembled line list, not by a
  probe→frame on a physical router.
---

## ADR-193 - No-homing placement defaults to guided relative positioning

**Status:** Accepted | **Date:** 2026-07-14

### Context

A machine without homing has two materially different positioning paths. Button jogging preserves the
controller's relative step count, so a one-off job can start from the live head position without first
writing a work offset. Releasing the motors does not preserve position: stock GRBL `$SLP` disables the
steppers, Wake requires soft reset, and the reset clears transient G92 state. The operator must finish
the physical move before the controller can be recovered and a fresh origin established.

The existing controls expose Absolute Coordinates, Current Position, User Origin, Verified Origin,
Set origin, Release motors, Wake, and Unlock as separate concepts. That is controller-honest but makes
the ordinary no-homing path depend on the operator assembling the state machine correctly. It also
defaults a newly opened no-homing project to Absolute Coordinates, even though Current Position is the
simpler relative-placement choice.

### Decision

- A newly created or opened project whose active device profile has homing disabled defaults to
  **Current Position**. Homing-enabled profiles continue to default to Absolute Coordinates. Explicit
  operator placement choices remain available and are not silently rewritten during ordinary use.
- The machine panel shows a **Position job** guide for no-homing profiles. Its primary path presents
  Current Position as the selected **Jog with controls** mode instead of a button that appears to
  capture coordinates. Its hand-position path starts with an explicit **Release motors to move by
  hand** action, then sequences physical move, Wake, explicit safe Unlock when GRBL reports Alarm,
  Set origin, and Verified Origin selection.
- Unlock is never sent merely because the controller reports Alarm. The operator must explicitly
  confirm the head is safely positioned by pressing the guided Unlock action.
- Relative Current Position and User Origin jobs on a no-homing profile do not require a completed
  Frame before Start. Frame remains available for the operator to inspect the perimeter, while the
  existing relative size/envelope preflight remains active. Verified Origin keeps its matching-frame
  requirement. Absolute Coordinates remains available for an operator who deliberately performs
  repeatable manual homing, and its existing safety behavior is unchanged.
- The raw Release motors control remains available for homing-enabled and advanced workflows, but the
  no-homing surface routes it through the guide so Wake and Set-origin ordering cannot be missed.

### Consequences

The common button-jog workflow becomes Jog, optional Frame, Start, with no preliminary capture
action; Set origin is reserved for reusable origins or the guided hand-move path. The hand-move path
still has unavoidable controller recovery steps, but the UI owns their order and never marks the
position ready before controller acknowledgement and a fresh Idle report. Frame verification remains
mandatory only for Verified Origin. Hardware validation remains required because OEM GRBL derivatives
can vary in their `$SLP`, reset, and alarm behavior.

**2026-07-15 maintainer amendment.** The mandatory Frame gate for no-homing Current Position and
User Origin was removed by direct maintainer instruction. The gate could invalidate its own proof:
Frame finishes at the perimeter's lower-left corner, while Current Position resolves the selected
anchor from the live head again at Start, producing different bounds for eight of nine anchors. The
Frame action and relative size/envelope preflight remain available; only the Start refusal was removed.

**2026-07-16 maintainer amendment.** The no-homing placement default moves from Current Position to
**User Origin**, by direct maintainer instruction ("for no homing machines a user should set origin
first by default not current position"). A fresh or newly opened no-homing project now refuses Start
until the operator establishes an origin, so the default flow is position the head, Set origin here,
then Start, instead of silently running head-relative from wherever the head happens to sit. Current
Position remains fully selectable through the Position job guide's "Choose jog positioning" and the
Start from dropdown, and an explicit Current Position choice is still preserved across device edits
and no-homing profile selections. Homing-enabled profiles keep the Absolute Coordinates default.
---

## ADR-194 - Add native Hershey single-line CNC text without a runtime dependency

**Status:** Superseded by ADR-213 | **Date:** 2026-07-14

### Context

Standard TTF/OTF glyphs describe filled outlines. Following those contours with an engraving bit
produces the unwanted inner/outer-line result and cannot recover the authorial center stroke. True
V-carving still needs those closed regions, while shallow labels and technical marks need open
one-tool-pass geometry. The two uses must therefore remain explicit instead of treating every font
as interchangeable geometry.

### Decision

- Bundle the original Hershey Roman Simplex vector data with its required Hershey/Hurt
  acknowledgements and complete redistribution terms.
- Parse the line-oriented JHF data in pure core and render it directly into open polylines plus
  schema-v2 line curves. Add no runtime dependency and copy no GPL Hershey Text extension code.
- Identify single-line behavior through the stable `hershey-simplex` font key; existing `TextObject`
  persistence already stores extensible string font keys, so no schema field or migration is added.
- Fresh CNC layers containing this font default to Engrave/on-path even with a V-bit. Existing layers
  are never rewritten because their operation may intentionally govern other objects.
- Preserve ordinary outline fonts for Fill, Pocket, and V-carve. Unsupported Simplex characters
  render as `?` rather than silently disappearing.

### Consequences

KerfDesk can create editable CNC single-line labels natively while old projects and outline-font
output stay unchanged. Roman Simplex initially covers printable ASCII only; broader stroke-font and
Unicode coverage requires separately licensed font data and a later bounded decision. This decision
does not change the existing offset-ladder V-carve algorithm.
---

## ADR-195 - Make the CNC layer card guided, honest, and narrow-panel safe

**Status:** Accepted | **Date:** 2026-07-14

### Context

The CNC layer card exposed working CAM parameters but did not meet its beginner-facing contract. The
material decision appeared after operation and bit controls, manual defaults looked authoritative,
the exact-stock-depth shortcut called itself a through cut, and feed-preset apply/save controls
overflowed the resizable panel. Basic/Advanced documentation also lagged the shipped choice to keep
the four core machining values visible.

### Decision

- Lead each CNC layer card with Material. Manual mode visibly tells the operator to verify the values;
  calculated values are described as starting points, never universally safe settings.
- Keep Depth per pass, Feed, Plunge, and Spindle visible in Basic. Advanced is an in-card labelled
  section for helpers and specialist controls, not a claim that the core machining values disappear.
- Rename the exact-depth shortcut to **Set to stock thickness**. It adds no hidden overcut; cutting
  below measured stock remains an explicit, setup-specific operator decision.
- Split feed-preset application and creation into separate responsive rows. Empty libraries say so,
  and Save is disabled until a non-blank name exists.
- Shared CNC rows wrap their value area and use shrink-safe controls so the supported 240 px panel
  minimum remains usable instead of clipping actions.

### Consequences

Existing project data and compiled G-code remain unchanged unless the operator edits a value. The
material, bit, preset, and stock-depth actions retain their undo/persistence behavior. The UI no
longer implies that a generic calculation is hardware-proven or that exact nominal thickness always
guarantees physical separation.
---

## ADR-196 - Separate selection movement from ordinary geometry picking

**Status:** Accepted | **Date:** 2026-07-14

### Context

KerfDesk deliberately hit-tests unfilled vector artwork against its paths so a large hollow outline
does not behave like an invisible filled rectangle over smaller nested shapes. The same global hit
test also started move drags, however, so a selected sparse design could only be moved by finding one
of its physical lines. At coincident or crossing lines the topmost direct hit always won and repeated
clicks could not reach the object below. This contradicted WORKFLOW F-A6's promise that the operator
can drag inside the current selection.

### Decision

- Every single or combined selection renders a 14 px four-arrow move handle at its transformed
  bounding-box center. Its screen-space hit target is stable across zoom and is resolved after the
  existing rotate/scale handles but before ordinary scene geometry.
- Dragging that handle moves the full current selection through the existing move-drag transaction,
  snap, undo, and multi-transform paths. Hovering it uses the move cursor.
- Ordinary click retains the existing geometry-first hit test. The rest of a hollow bounding box is
  not made selectable, preserving access to nested artwork.
- Alt+click requests a full local hit stack and selects the candidate after the currently selected
  object, wrapping at the bottom. Shift+Alt+click toggles that candidate. Locked and hidden-layer
  objects never enter the stack.
- The full candidate scan is separate from normal `hitTest`, so ordinary pointer-down keeps its
  early-exit performance. Direct geometry candidates remain topmost-first; enclosing Line interiors
  follow by smallest area, preserving the existing first-choice semantics.

### Consequences

Sparse text, groups, and multi-selections have one visible, reliable place to grab without weakening
precise vector selection. Crossing output layers can be resolved locally without hiding a layer or
selecting every object of its color. This slice does not add global Tab/Shift+Tab object traversal or
an object-tree panel; those remain optional discoverability enhancements rather than prerequisites
for the reported workflow.

---

## ADR-197 - Let operators hide static canvas start markers without hiding live motion

**Status:** Accepted | **Date:** 2026-07-15

### Context

The canvas motion overlay labels the planned frame and job entry points so operators can understand
where motion begins. On dense artwork, the original 92%-opaque white label rectangles obscured too
much geometry. Some operators also need an uncluttered canvas, but a master overlay switch would hide
controller-reported head position, completed motion, and status information that remains valuable
during a run.

### Decision

- Render `FRAME START` and `JOB START` label text at 50% opacity over a 20%-opaque white backdrop.
  Keep the safety-red marker dots and frame-direction arrow fully opaque.
- Add a pressed eye toggle immediately after Snap in the floating canvas controls. The default is on,
  and the preference is stored locally across reloads.
- Turning the toggle off hides only the two static start markers and frame-direction arrow. The
  approach route, live controller head, confirmed-route trail, and status badge remain visible.

### Consequences

Operators can see artwork through the labels or remove the static markers entirely without weakening
live machine feedback. The preference is UI-only: it does not alter the project, generated G-code,
frame verification, job placement, or controller behavior.

---

## ADR-198 - Add a pinned OFL EMS stroke-font family with lazy data loading

**Status:** Superseded by ADR-213 | **Date:** 2026-07-14

### Context

Roman Simplex proves the single-line machining path but offers only one utilitarian appearance.
The curated Evil Mad Scientist SVG Fonts collection contains OFL-licensed single-line derivatives
with calligraphic, handwritten, architectural, and geometric styles. These SVG fonts are data, not
browser-installable TTF faces, and their provenance and open topology must remain auditable.

### Decision

- Bundle EMS Allure, EMS Delight, EMS Tech, and EMS Osmotron from upstream commit
  `8c71f2d9e1a5292047bb88e5595a766241b82cc6`, preserving each SVG's authorship and OFL notice.
- Generate compact TypeScript glyph data with a checked-in script that validates the embedded
  license, font identity, path-command subset, fallback glyph, and source SHA-256.
- Parse the SVG stroke path subset in pure core and emit open schema-v2 paths plus deterministic
  machining polylines. Unsupported characters visibly fall back to `?`.
- Lazy-load the generated EMS data chunk only when an EMS face is rendered. Existing outline and
  Hershey text do not pay the data-transfer or parse cost.
- Reuse the existing single-line machining policy: fresh CNC text uses Engrave/on-path, while
  existing shared layers are never silently rewritten.

### Consequences

The Add Text workflow now offers five genuinely centerline-based CNC styles without a runtime
dependency or project-schema migration. The EMS fonts add Latin-1 coverage and approximately 165 KB
of compact source data in a lazy chunk. Decorative scripts can contain tight turns that are visually
valid but physically unsuitable below a bit- and material-dependent size, so machining suitability
remains an operator choice rather than an invented universal cutoff.

---

## ADR-199 - Fair decorative stroke fonts with the shared trace cubic fitter

**Status:** Superseded by ADR-213 | **Date:** 2026-07-14

### Context

The EMS sources are genuine open centerlines, but many curved glyph strokes are stored as coarse
straight-segment conversions. At engraving scale their bowls and script joins therefore appear
faceted even though their topology is correct. The in-house tracer already contains a deterministic
least-squares G1 cubic fitter designed to average point noise while respecting marked corners.

### Decision

- Promote the trace cubic fitter into shared geometry while retaining the tracer's compatibility
  seam and existing tests.
- At lazy EMS font compilation, fit Allure, Delight, and Tech line-only strokes to cubic Béziers.
  Scale each tolerance from the font's cap height so the result is independent of output text size.
- Preserve endpoints and hard corners, never join separate strokes, and never close an open path.
- Sample every fitted cubic against its source polyline. If it exceeds the bounded deviation guard,
  retry at tighter tolerances, then keep that source stroke unchanged if every fit remains unsafe.
- Keep Osmotron's deliberately angular geometry byte-for-byte; its corners are the design.
- Continue flattening the resulting canonical curves at the existing machine tolerance when
  producing machining polylines.

### Consequences

Decorative bowls and joins render with fair curves while CNC topology, deterministic output, and
the Engrave/on-path policy remain unchanged. Fitting is paid once when an EMS face enters the lazy
font cache. It cannot normalize an intentionally handwritten baseline or redesign awkward source
letterforms; those traits belong to the selected face rather than to polygon faceting.

---

## ADR-200 - CNC recovery is evidence-gated and software Abort is not an E-stop

**Status:** Amended in part by ADR-215 (pass-boundary recovery is the default review; the runway flow is the demoted advanced option; session-continuity evidence may substitute for unconditional requalification) | **Date:** 2026-07-14

### Context

KerfDesk exposed a GRBL Ctrl-X soft reset as **E-STOP**. A host-issued serial command can be lost when
the application, operating system, USB link, controller, relay, or VFD fails, so it cannot represent
a safety-rated physical emergency stop. CNC interruption recovery also cannot be reduced to a G-code
line jump: parser acknowledgements do not prove physical execution, spindle rotation, cutter
clearance, retained coordinates, or unchanged workholding.

### Decision

- Name the host command **ABORT** / **Controller Reset** and state that danger requires the machine's
  physical E-stop or power isolation.
- Keep generic CNC Resume, checkpoint resume, and start-from-line execution disabled.
- Never command automatic motion when the cutter may be embedded and physical spindle rotation,
  position, tool condition, or workholding is unknown.
- Treat accepted-line checkpoints as diagnostic transport evidence, not proof of removed material.
- A future automatic escape requires a controller- or PLC-owned transaction, stable Hold proof,
  exclusive command ownership, retained-position proof, and physical spindle/VFD feedback on a
  hardware-validated machine profile. A desktop process may not promise an escape it cannot finish
  after its own failure.
- A future re-entry is a newly generated native KerfDesk recovery job. It starts clear of material,
  proves the exact job/tool/WCS package, brings the spindle to speed, enters through proven-cleared
  geometry, replays the uncertainty zone, and refuses unsupported or imported G-code.

### Consequences

The first implementation kept current controllers manual-recovery-only while adding incident
evidence, semantic toolpath identity, preview, and refusal-policy foundations without machine
motion. A stationary or possibly broken embedded tool always routes to inspection and supervised
extraction.
Simulator evidence cannot enable a machine profile; controller-specific fault injection and physical
air-cut/scrap validation are required.

The first software foundation assigns stable identities to individual native contour segments,
binds their validated line sidecar into the SHA-256 recovery package, and provides pure contour
review geometry. The package constructor rebuilds the canonical manifest from the exact Job before
hashing. Review geometry requires a straight, same-direction tangent runway into the uncertainty
segment; preceding distance across a corner cannot claim acceleration room. At this foundation
stage, every successful policy or geometry result carried `executable: false`; it emitted no G-code
and had no controller execution path. Opaque proof strings remained review evidence only.

The first UI review is intentionally split into an evidence audit and a hypothetical geometry
preview. Existing checkpoints contain acknowledged-line diagnostics but no emitter-owned semantic
line map, exact SHA-256 recovery package, controller execution fence, physical RPM feedback, or
hardware-qualified runway profile. The wizard reports those proofs as missing and never derives a
physical cut position from acknowledgement count. It may draw an operator-selected native contour
segment using explicitly illustrative acceleration assumptions, but its result carries
`executable: false`; the dialog exposes no stream, spindle, G-code, or controller action.

### 2026-07-15 supervised new-job amendment

Generic CNC Resume, checkpoint line replay, and arbitrary start-from-line remain disabled. A
retained first-attempt checkpoint may now launch a different operation: a supervised generator for a
new native KerfDesk recovery job after the cutter has been physically cleared. This is not an
automatic resume and it never maps acknowledgement count to cut completion.

The operator must explicitly select the first uncertain native contour segment and separately
confirm a physically stopped spindle, clear cutter, re-homed/requalified position, verified G54 XY/
WCS and Z zero, intact installed tool, unchanged secure workholding, completed machining before the
selection, and the entire displayed tangent runway clear. The operator must also enter the record
for the machine-specific air-cut or scrap test that qualified the runway profile. Missing or blank
evidence fails closed; an invalid machine acceleration value cannot fall back to a permissive
default.

The generated job is limited to single-tool native constant-depth contour passes with a straight,
same-direction lead-in. It replays the selected uncertainty segment and remainder, then retains every
later pass and operation in source order. The first segment, cornered or short runway, mixed output,
multi-tool work, and imported/path3d/arc/helical motion remain unsupported. Its emitted order is
safe-Z retract, spindle start and configured dwell, rapid to the confirmed-clear runway start, feed
plunge, tangent re-entry, and remaining work.

Immediately before streaming, KerfDesk uses the capsule's sealed prepared semantic job, manifest,
output scope, resolved origin, and exact emitted source bytes; it does not read or mutate the open
canvas. It creates a SHA-256 package over the exact source and recovery bytes, semantic plan, runway
profile, operator review, completed-prefix proof, and cleared-runway proof. The ordinary CNC Idle/
alarm/controller compatibility/work-zero/override/
accessory/bounds/no-go checks and exact-program setup attestation run again. These software gates do
not sense the physical setup or make the host Abort an E-stop; the operator must supervise re-entry
with the physical E-stop reachable.

The executable path also writes a durable pending-attempt record before entering the controller
Start boundary. After the boundary's asynchronous queue and live-state checks, a final synchronous
comparison binds the same controller session, settings observation, WCO/origin, position, and Work
Z evidence that the operator reviewed. Any drift refuses before recovery-program bytes. If the app
dies while the durable handoff is unresolved, startup conservatively offers the new attempt—not the
older source—as acceptance-unknown recovery.

Opening or cancelling review is read-only. Only **Start supervised recovery** claims the capsule by
run ID, revision, and attempt ID. Failure before controller acceptance releases that claim and leaves
the source retryable. Once transmission may have begun, the attempt receives its own run identity; an
interruption makes that attempt the newest capsule because the source no longer describes current
work. Possible cutter engagement still has no desktop-controlled escape path and always remains
manual intervention.

---

## ADR-201 - Gate CNC Start by protocol capability and exact override acknowledgement

**Status:** Amended by ADR-209; Start-gate portions superseded by ADR-228 (dialect and override findings are Job Review warnings — the reduced-override acknowledgement text lives in the review). | **Date:** 2026-07-15

### Context

CNC Start compared configured, active, and detected controller names exactly. GRBL v1.1, grblHAL,
and FluidNC use the same live job protocol in KerfDesk, so a safe compatible variant could be
refused solely because its label differed. The override gate also required 100/100/100. That
prevented an operator from deliberately starting more slowly, while treating reduced feed and
rapid exactly like a changed spindle command or an increased feed.

### Decision

- Every controller driver declares a Start protocol capability. Start compares that capability,
  not the controller label. GRBL v1.1, grblHAL, and FluidNC share one protocol capability; Marlin,
  Smoothieware, and file-only output remain distinct.
- A changed spindle override, an increased feed/rapid override, an invalid percentage, or missing
  fresh `Ov:` evidence remains a hard CNC Start blocker.
- Positive feed and rapid reductions with spindle at 100% may proceed only after the operator sees
  their exact percentages and confirms the machining warning.
- The acknowledgement is carried with the exact program/setup attestation. After the queue fence,
  fresh live `Ov:` values must exactly match the acknowledged reduction. A changed or newly reduced
  value refuses before any job byte and requires a new review.

### Consequences

Compatible GRBL-family firmware variants no longer create a false profile-name blocker. Reduced
motion can be used deliberately, but it is never inferred as safe: changed chip load and cutting
behavior are named, spindle speed cannot be silently reduced, and the final controller observation
remains authoritative. Cross-protocol controller combinations continue to fail closed.

---

## ADR-202 - Separate burn raster fidelity from bounded preview and stream work

**Status:** Accepted | **Date:** 2026-07-15

### Context

The raster pipeline uses one decoded representation for both interactive preview and machine output,
then materializes large working grids and complete emitted strings. A fixed four-million-pixel guard
limits crashes, but it also rejects work based on one static count and can make preview downsampling
silently become burn downsampling. Raising that number without changing allocation behavior would
only move the failure point.

### Decision

- Preserve a burn-source representation independently from a bounded, asynchronously generated
  preview representation. Preview limits must never reduce emitted burn resolution.
- Compile raster work in row chunks and emit chunks incrementally so decoded source, full working
  grid, and complete raster G-code are not all required in memory at once.
- Replace the fixed pixel refusal with measured source, row-work, and emitted-command budgets.
  Every budget verdict carries its measured estimate; the chunk iterator lets a consumer stop
  between rows without first allocating the remaining raster output.
- Vector fill estimates account for selected strategy, holes, hatch directions, and compiled work;
  static source-point counts remain only cheap early diagnostics, not the final refusal proof.
- Cheap preparation estimates resolve enabled operation sublayers and per-object operation
  overrides before classifying vector, fill, or image work. A base-layer mode is not enough evidence
  to block or allow Start, Preview, or Save when the effective operation differs.

### Consequences

Larger jobs become possible when their measured working set is safe, while pathological jobs still
fail before uncontrolled allocation. Preview remains responsive and may be lower resolution, but
machine output is evaluated from the burn source. Local dithers use deterministic row providers;
error-diffusion algorithms remain materialized because their error state crosses rows. The legacy
string API joins the same byte-identical chunks and is bounded by the compiled-output estimate.

**2026-07-15 implementation amendment.** The compiled-output guard stops requesting raster rows as
soon as either refusal limit is proven instead of scanning the rest of an already-invalid job.
Because that result is a lower bound, its blocker says "at least" rather than presenting a partial
count as the exact total. Reads from materialized raster groups use zero-copy row views; compiled
Job consumers remain read-only and no longer allocate one copied pixel row per guard/preview scan.

---

## ADR-203 - Recover Work-Z only from owned, fresh controller offset readback

**Status:** Amended by ADR-209 | **Date:** 2026-07-15

### Context

KerfDesk correctly blocks CNC Start when its session-local Work-Z evidence is missing, but a
controller can retain a qualified WCS offset across an app reconnect. Simply trusting a status-frame
`WCO` or removing the gate would not prove which coordinate system, tool, setup epoch, or command
owner established that offset.

### Decision

- Recovery uses an app-owned, acknowledged controller-offset query made while no job or competing
  operation owns the line queue. The response must belong to the current controller session and a
  bounded freshness window.
- The readback records the active WCS, its Z offset, controller/setup epochs, and the operator-confirmed
  active tool. Ambiguous, duplicate, missing, unsupported, or changed responses fail closed.
- Recovered evidence is a distinct source and remains subject to the same tool-plan match, plate/tool
  handling, invalidation, and final Start reservation rules as manual Zero Z and probing.
- A status-frame `WCO`, machine position, or prior-session cache alone never creates Work-Z evidence.
- The UI names this read-only action **Use existing controller Z zero** and keeps it under the
  advanced **Reuse existing controller setup** disclosure. It is separate from interrupted-job
  recovery: the owned `$G` → `$#` → `$G` readback does not move, probe, zero, import G-code, or
  restore archived job/controller settings.

### Consequences

Qualified persistent controller setup can be recovered without making the stock-top gate cosmetic.
The workflow adds one explicit recovery transaction and operator review; unsupported firmwares keep
the existing Zero Z/probe path. Hardware qualification remains required before claiming physical
stock-top correctness.

---

## ADR-204 - Refuse project saves that would normalize machine or output semantics

**Status:** Accepted | **Date:** 2026-07-15

### Context

Project Open deliberately sanitizes malformed optional and legacy fields. Reusing that tolerant
normalizer during Save could turn invalid live CNC, controller, tool, layer, or object data into
different valid values on disk, while the unchanged in-memory project was marked clean. The saved
file could therefore reopen with different machine or output behavior than the operator had before
Save.

### Decision

Save and autosave still serialize, deserialize, and reserialize through the normal validation
boundary. Before writing, they compare the persisted machine/output semantics before and after that
normalization. Any drift is refused with the first changed field path; the picker is not opened and
the project is not marked saved. Adding a missing empty scene-group list remains allowed because it
is structural organization metadata and cannot change emitted motion.

### Consequences

Open remains backward-compatible and fail-safe for old files, while Save can no longer silently
repair a live project into different disk semantics. A corrupted runtime project must be reloaded or
explicitly repaired before it can be marked clean. The integrity comparison is pure and covered at
both the project boundary and the file-action boundary.

---

## ADR-205 - Machine Setup is one controller-first atomic workflow

**Status:** Accepted | **Date:** 2026-07-15

### Context

Machine configuration had two conflicting surfaces. The seven-tab Machine Setup dialog edited the
live project immediately, while Device Setup used a draft and different Cancel semantics. The
wizard connected before controller selection, mixed laser-only settings into CNC, omitted CNC
machine parameters, described every controller as GRBL `$$`, and ended with an unproved "ready to
cut" claim. A separate fixed batch could write assumed `$30`, `$32`, `$130`, and `$131` values to
any GRBL-dollar controller.

### Decision

- Expose one seven-step **Machine Setup** flow and route the legacy dialog entry to it.
- Choose Laser/CNC, controller family, baud, dialect, and streaming before opening serial.
- Keep controller identity/readback separate from the draft until an explicit operator action.
  Detected identity never silently replaces a selected catalog/import/manual profile; accepted CNC
  `$30` readback updates the CNC spindle ceiling rather than laser-power fields.
- Draft `DeviceProfile` and `MachineConfig` together. Save device, workspace, machine config, CNC
  cache, job placement, and spindle-ceiling effects as one undoable store transaction.
- Render laser output or CNC spindle/clearance controls according to the draft machine kind; probing
  remains a separate supervised hardware operation.
- Keep one controller guide for GRBL, grblHAL, FluidNC, Marlin, Smoothieware, and Ruida, checked
  against the selected `ControllerDriver` for transport, baud, home, status, streaming, and CNC
  capability.
- Remove the fixed GRBL setup batch. Only GRBL/grblHAL common settings may use the existing
  read/backup/confirm/queue/save/write/re-read/verify path. Cancel sends no firmware command;
  software commits before queued writes execute. Machine-critical travel stays review-only; other
  controller families use their native configuration tools.
- Finish with a software-consistency report and an explicit operator hardware-commissioning list.
  Saving sends no home, jog, probe, beam, spindle, or coolant command. Firmware changes occur only
  when the operator explicitly queued supported common settings after the backup/confirmation gate.

### Consequences

Cancel has one meaning and cannot leave a half-edited machine. Controller selection, connection,
output generation, workspace bounds, origin transforms, homing, framing, power/spindle behavior,
accessories, safety zones, and optional calibration now derive from one reviewed draft. Software
tests can prove this wiring and command policy; physical direction, switches, relays, interlocks,
beam/spindle behavior, clearances, and calibration remain the operator's hardware gate.

---

## ADR-206 - Require explicit maintainer permission for every new guard

**Status:** Superseded in mechanism by ADR-228 — the permission process is replaced by a standing denial: no guard will ever be created again. | **Date:** 2026-07-15

### Context

Guards can prevent damage, but they can also reject valid work, hide controls, rewrite intent, or
stop a laser or CNC job from starting. A guard added from convention or hypothetical risk transfers
control from the operator to the software without the maintainer choosing that tradeoff. Automated
tests can prove that a refusal behaves as written; they cannot prove that the refusal belongs in the
product.

### Decision

- A guard is any new behavior that blocks, refuses, gates, caps, clamps, delays, hides, disables,
  rewrites, or adds confirmation before an otherwise available action, input, output, machine
  command, job start, preview, save, import, export, or G-code emission.
- No guard may be implemented, and no existing guard may be expanded to block more, until the
  maintainer explicitly approves that specific guard in chat. An ADR, tests, review approval, or
  permission for a different guard is not a substitute. The PR must link or quote the necessity
  case and approval.
- Every approval request must first state the concrete failure prevented, current-tree evidence that
  it is real, why existing guards do not cover it, all valid workflows or inputs the guard may block,
  the exact operator-facing message and recovery path, and why a warning, measurement, scalable
  implementation, or other non-blocking alternative is insufficient.
- The required standard is absolute necessity. “Defense in depth,” convention, hypothetical risk,
  or a general preference for fail-closed behavior does not meet it.
- Without explicit approval, work stops at a report of the proposed guard. Narrowing, correcting,
  or removing an existing guard remains ordinary bug-fix work; expanding its refusal surface needs
  fresh permission.

### Consequences

The maintainer owns every new capability-versus-refusal tradeoff. Guard proposals become visible
and reviewable before code exists, and an approval cannot silently spread to other workflows.
Existing machine-safety behavior is not removed or weakened by this policy; it governs additions
and expansions from this decision forward.

---

## ADR-209 - Remove universal CNC expiry, depth, override, and spin-up policies

**Status:** Accepted | **Date:** 2026-07-15

### Context

Four audited CNC policies refused valid machine-specific workflows without measuring a concrete
fault: controller-read Work-Z evidence expired after five minutes even when its session and setup
epochs had not changed; any spindle reduction blocked Start while equivalent feed and rapid
reductions could be acknowledged; stock thickness imposed a universal cut-depth ceiling; and every
spindle was forced to use at least a 0.5-second spin-up delay.

The maintainer explicitly directed that these policies be removed while retaining the idle/alarm
check, active-job exclusion, laser-on-travel detection, non-finite-coordinate checks, CNC
plunged-rapid checks, active spindle/coolant detection, probe-plate removal, and first-tool / Work-Z
matching.

### Decision

- Controller-read Work-Z evidence has no wall-clock expiry. It remains bound to the controller
  session, reference/setup epoch, selected WCS, active tool, compiled first-tool plan, and all
  existing invalidation events. This amends the freshness-window portion of ADR-203.
- A known positive feed, rapid, or spindle override at or below 100% may proceed after one exact
  three-channel acknowledgement. Unknown, zero, invalid, increased, or post-acknowledgement changed
  values still refuse before any job byte. This amends the spindle-reduction portion of ADR-201.
- Remove the stock-thickness-plus-allowance ceiling from CNC layer settings, emitted G-code,
  standalone preflight, relief roughing, and inlay validation. Finite positive configured depth,
  non-finite-coordinate, and plunged-rapid validation remain. The non-blocking through-cut/tab
  advisory remains available.
- Accept every finite non-negative machine spin-up delay. Emit the configured positive value
  exactly; zero emits no `G4` dwell. Negative and non-finite values remain invalid.

### Consequences

GRBL 4040 and other no-homing machines do not lose unchanged Work-Z proof because time passed.
Operators can intentionally reduce spindle speed with the same explicit review used for reduced
motion, select depths appropriate to their stock/spoilboard/setup, and configure the spindle delay
their hardware actually needs. The concrete machine-state and emitted-motion protections named
above remain in force; no new guard is introduced by this decision.

---

## ADR-208 - Remove obstructive 4040 and advisory machine policies

**Status:** Accepted | **Date:** 2026-07-15

### Context

The Neotronics 4040 dialect rewrote every laser-off rapid as a fixed 800 mm/min feed and blocked
zero-overscan Island Fill at preflight. Start also turned every controller warning into a modal
confirmation, while the Console discarded position, homing, origin, frame, and Work-Z evidence
after commands that could not change those facts. These policies delayed or refused valid work,
especially on GRBL 4040 machines that intentionally run without homing.

The maintainer explicitly directed that these audited policies be removed while retaining the
idle/alarm check, active-job exclusion, laser-on-travel detection, non-finite-coordinate checks,
CNC plunged-rapid checks, active spindle/coolant detection, probe-plate removal, and first-tool /
Work-Z matching.

### Decision

- Remove the controlled laser-off travel capability from the dialect and emitter APIs. All laser
  dialects use ordinary `G0` travel with explicit `S0` where the dialect requires it; Island Fill
  overscan runways use the same rapid travel.
- Remove the machine-profile zero-overscan Island Fill preflight refusal. Fine-detail heat analysis,
  its non-blocking warning, and the one-click Scanline recovery action remain available.
- Display general Start readiness warnings as non-blocking warning toasts. ADR-210's explicitly
  approved exception requires one focused acknowledgement when a laser controller's `$32` state
  cannot be verified; a reported `$32=0` remains a hard refusal.
- Classify Console effects by what a command can change. Accessory-only commands, dwell, and
  non-positional setting writes still invalidate their own stale observations, but preserve homing,
  frame, origin, Work-Z, WCO, and trusted-position evidence. Motion, coordinate, tool, reference,
  and axis-calibration commands retain the corresponding invalidation.

### Consequences

GRBL 4040 jobs are no longer slowed by a hidden profile rewrite or stopped for choosing zero
overscan. Informational warnings stay visible without becoming permission prompts, and harmless
Console maintenance no longer forces setup repetition. The explicitly retained safety checks above
remain unchanged; this decision removes only the four audited policies named here.

### Amendment (2026-07-19) - targeted output-quality controls restored by ADR-235

ADR-235 deliberately reverses only ADR-208's first decision bullet for profiles that explicitly
configure controlled laser-off travel. The built-in Neotronics 4040 profile once again emits bounded
laser-off `G1` seeks, while profiles without that capability retain the `G0` byte stream established
here. ADR-234 remains the governing bounded-entry geometry for ordinary Fill; ADR-235 adds the
one-way fallback and a full-where-safe Island policy without restoring a zero-overscan refusal or any
ordinary Start guard.

---

## ADR-207 - One layout-stable live-motion bar owns run controls

**Status:** Amended | **Date:** 2026-07-15 | **Amended:** 2026-07-17

### Context

Active jobs rendered the same software Abort action in three places: a fixed viewport button, the
Numeric Edits bar, and the Machine rail. Pause and Resume were also duplicated. The controls called
the same store actions, so the repetition did not provide independent safety. It obscured hierarchy,
made the most important controls small, and produced overlapping buttons at narrow widths.

### Decision

- A single full-width **Live Motion** bar, directly below the workspace and above the status bar,
  owns Pause, Resume, tool-change Continue, and software Abort while a job or machine operation is
  active. Numeric Edits and the Machine rail do not render duplicate run actions. Anchoring it to the
  workspace's lower edge keeps top-aligned machine controls stationary when a short jog starts and
  settles.
- The bar shows the active state and job progress beside its actions. Its controls use a minimum
  48 px target height; software Abort is at least 144 px wide and is labelled **ABORT JOB** or
  **ABORT MOTION** so its scope is explicit.
- The bar participates in normal layout so it cannot cover unrelated controls, but uses the highest
  app stacking order while active so a dialog cannot hide the software Abort path. It wraps at narrow
  widths rather than shrinking or scrolling the actions away.
- Software Abort remains an immediate controller-specific reset/de-energize request with no
  confirmation dialog. It is not a safety-rated E-stop and the bar directs the operator to physical
  E-stop or power isolation for danger.
- The Machine rail may still show detailed progress, safety explanation, overrides, and setup state.
  It may be collapsed during a run because the canonical controls are independent of rail visibility.
  The `Ctrl+.` shortcut and crash-screen recovery remain independent fallback paths.

### Consequences

There is one obvious action cluster to learn and test, with larger targets. Responsive layouts no
longer stack competing Abort buttons, and transient jog state no longer moves the jog controls under
the operator's pointer. Removing a panel or changing selection tools cannot remove the visible
software Abort path, while the UI remains honest that only physical hardware can provide a
safety-rated emergency stop.

---

## ADR-210 - Enforce explicit machine output capability at every project entry point

**Status:** Accepted | **Date:** 2026-07-15

### Context

Machine Setup already persisted `laser-output` and `cnc-output`, but the rail treated those values as
advisory styling. An unavailable segment still called `setMachineKind`, the store always accepted the
switch, and **New Project** implicitly selected Laser. A Laser-only profile could therefore enter CNC
controls and output, while a CNC-only profile could enter Laser controls and output or silently
change to Laser after **New Project**. The downstream workspace, compiler, emitter, and machine
controls intentionally follow the active `project.machine.kind`, so none of their existing checks
could correct this contradictory state.

The new refusal meets ADR-206's approval requirement. Before implementation, the maintainer asked
for Laser-only machines to have no CNC access, CNC-only machines to have no Laser access, hybrid
machines to allow both, and an explanation when the unavailable mode is pressed. After receiving a
detailed necessity case and implementation plan, the maintainer explicitly directed: **"build"**.

A warning alone is insufficient because it would still enter the mode the selected physical-output
contract excludes. The refusal affects only profiles with exactly one explicit output capability.
Hybrid profiles, legacy profiles with neither capability, the currently supported mode, ordinary
project editing, and all non-mode configuration remain available.

### Decision

- `DeviceProfile.capabilities` is the single capability source. `laser-output` alone permits only
  Laser, `cnc-output` alone permits only CNC, both permit both, and neither preserves legacy access.
- The Laser/CNC segmented control keeps an unavailable mode visible, focusable, muted, and marked
  `aria-disabled`. Mouse or keyboard activation shows: **"CNC mode is unavailable. This machine is
  set to Laser only. Open Machine Setup and choose CNC only or Laser + CNC."** The symmetric Laser
  message names **CNC only** and offers **Laser only or Laser + CNC**. No project or history state is
  mutated.
- The store enforces the same contract in `setMachineKind`; UI styling is not the security boundary.
  The atomic Machine Setup replacement also refuses a profile paired with the opposite active
  machine kind.
- **New Project** resolves the blank project against the configured capability and the previously
  active mode. CNC-only stays CNC; hybrid and legacy machines keep the previously active kind.
- Native project open, LightBurn migration, and autosave recovery resolve a contradictory active
  kind before installing the project. A displaced CNC configuration is cached, the repaired project
  is dirty, and a warning directs the operator to Machine Setup. No incompatible project state is
  silently saved over the source file.

### Consequences

Explicit single-output machine profiles cannot reach the opposite mode through the rail, direct
store calls, **New Project**, file open, autosave recovery, or Machine Setup persistence. Hybrid
machines retain ordinary two-way switching. Older projects remain usable until the operator records
an explicit physical-output choice, while contradictory current files recover visibly without
discarding reusable CNC configuration.

---

## ADR-211 - Artwork binds explicitly to named process operations

**Status:** Accepted | **Date:** 2026-07-15

### Context

The original color-driven layer model made one field do three jobs: artwork appearance, operation
identity, and process settings. Two independent black artworks therefore shared settings
accidentally. Laser-only per-object overrides partly hid that coupling, while CNC still edited the
shared color layer and additional operations lived in a nested Sub-layers box. Selection could not
answer the operator's basic question: “Which settings will this artwork use?”

The product needs artwork-first editing for both laser and CNC: selecting Johann must show Johann's
operation, selecting the surrounding box must show the box operation, and selecting both must offer
an explicit way to use one shared operation. Shared operations must remain useful and visible, not
be inferred from matching source colors.

### Decision

1. `Scene.layers` remains the persisted ordered collection during the staged migration, but every
   row is a named **process operation** with a stable ID and presentation color. Geometry color no
   longer identifies an operation.
2. Project schema v3 adds explicit `operationIds` bindings to whole `SceneObject`s and, when an
   imported vector contains independently assigned paths, to `ColoredPath`s. Multiple IDs bind the
   same artwork to additional operations without duplicating or recoloring its geometry.
3. The v2-to-v3 migration preserves output: legacy color membership becomes explicit operation IDs;
   legacy per-object overrides become named cloned operations; and legacy sub-layers become adjacent
   first-class operations bound to the same artwork. Source artwork colors stay unchanged.
4. Fresh artwork receives its own named operation. New operation presentation colors come from a
   deterministic high-contrast palette so the operation list, canvas selection, and preview remain
   easy to correlate.
5. Selection is the settings context. A single selection shows its operation. If that operation is
   shared, the UI says how many artworks it affects and offers **Make unique**. A mixed multi-selection
   offers **Use one operation**. Grouping remains a separate geometry command.
6. Laser and CNC use the same binding and selection shell. Machine-kind compatibility is advisory
   only in this change; it does not add a new blocking guard under ADR-206.
7. The always-visible Sub-layers editor is retired. **Add operation** creates another ordinary,
   named, reorderable operation bound to the selected artwork.
8. `Scene.artworkOrder` persists machine priority independently of `Scene.objects`, so choosing
   what runs first never changes canvas stacking or hit-testing. Missing IDs fall back
   deterministically to object order for legacy projects and newly inserted artwork.
9. Artwork priority is the top-level Laser sequence; operation order decides processes inside each
   artwork. Artwork intentionally sharing one operation remains one compound machining unit so fill
   holes/overlaps and CNC pocket/inlay geometry stay correct. CNC honors artwork priority only inside
   its existing safety schedule: clearing precedes profiles and tool sections stay contiguous.

### Divergence from LightBurn

LightBurn uses color as the primary cut-layer key. KerfDesk deliberately uses explicit operation IDs
because an artwork-first laser-and-CNC workflow must allow same-colored artwork to have independent
settings without rewriting its design colors. Presentation colors preserve the familiar visual
language, while the binding is explicit and inspectable.

### Consequences

Operation sharing becomes intentional. Recoloring artwork cannot silently change machining
settings, and CNC gains the same per-artwork behavior as laser. Schema v3 projects are not written
by older builds, so serialization, migration, compiler selection, canvas visibility, undo, and
round-trip tests all cover the new binding. Operators can move one selection or a stable
multi-selection first/earlier/later/last without changing visual stacking. Internal `Layer` type
names may remain temporarily to keep the migration small; user-facing copy says Artwork and
Operation.

### Verification

- Select two same-colored artworks and prove their independent operations compile differently in
  both laser and CNC mode.
- Share one operation across a multi-selection, edit it once, and prove both outputs update.
- Make one member unique and prove subsequent edits do not affect the other member.
- Reorder independent artwork, prove Laser and same-phase CNC group order changes, and prove canvas
  stacking does not. Share one operation and prove it stays one compound machining unit.
- Reverse operation priority and run path optimization; prove neither can cross artwork priority.
- Open a schema-v2 fixture containing color layers, an object override, and a sub-layer; prove the
  migrated schema-v3 output is equivalent and survives save/open.

---

## ADR-211 Amendment - Numeric docked artwork run manager with UI-only canvas focus

**Status:** Accepted amendment | **Date:** 2026-07-16

### Context

ADR-211 initially exposed artwork priority as First/Earlier/Later/Last buttons inside the selection
inspector. That interaction does not scale to a production sheet with 50 or more independent jobs,
hides the full queue, and mixes per-artwork settings with top-level sequencing. Operators also
cannot reliably match an abstract position to crowded canvas geometry.

### Decision

1. Top-level sequencing lives in a **Run order** view inside the existing right Artwork / Operations
   rail. The canvas remains on the left; the manager is neither modal nor an additional rail.
2. Run positions are direct one-based numbers with automatic renumbering, search, jump-to-number,
   and fixed-row virtualization. The implementation has no priority-specific item cap.
3. A run unit is derived from ordered artwork. Objects with the same complete operation-ID set are
   one unit; empty or partially shared bindings remain independent. The persisted
   `Scene.artworkOrder` stays a flattened object-ID list, so no schema migration is required.
4. Row focus and canvas focus are bidirectional. The active unit keeps full opacity and receives a
   short, open operation-colour callout beside its `#N` badge; other artwork is dimmed. A closed
   focus outline is intentionally avoided because it can resemble output geometry. This focus is
   ephemeral UI state and never changes geometry, presentation colours, visibility, output,
   preview, or G-code.
5. **Number on canvas** assigns #1, #2, and onward by hit-testing clicks. A session uses one pending
   project snapshot: Done creates one undo entry, Undo last rewinds within the session, and Cancel
   restores the original order.
6. Laser rows show the exact compiled output steps. CNC rows show requested position alongside the
   exact compiled CNC steps; clearing-before-profile and contiguous tool sections remain
   authoritative and visible rather than being weakened to satisfy the requested number.
7. Per-artwork settings stay in the Settings view. Every run row provides **Edit settings**, and the
   existing intentional sharing, Make unique, Add operation, and deterministic colour behavior from
   ADR-211 remains unchanged.

### Consequences

Large queues are inspectable and directly addressable without changing the project model. Canvas
correlation improves without contaminating machine truth. Compiling effective CNC steps when the
manager is open is deliberate: the panel reports the same safety/tool schedule the machine output
uses instead of maintaining a second approximation.

### Verification

- Directly move a run to a numbered position and prove canvas stacking is unchanged and Undo works.
- Render 50 real jobs and a 1,000-row list fixture; prove only a bounded window mounts.
- Click row-to-canvas and canvas-to-row; prove dimming/highlight is display-only.
- Number multiple canvas jobs, Undo last, Cancel, and Done; prove Done contributes one undo entry.
- Prove exact-shared artwork is one unit while partial sharing stays separate.
- Prove laser output steps follow requested order and CNC reports clearing-before-profile effective
  steps when they differ.

---

## ADR-212 - Laser pause, recovery, disconnect, and laser-mode boundaries are fail-dark

**Status:** Accepted | **Date:** 2026-07-15

### Context

A live laser job exposed two independent failures. Pause wrote ordinary GRBL feed hold before
freezing the host stream, and Resume wrote cycle start then immediately refilled G-code without
proving that the controller left Hold. Acknowledgements prove that GRBL parsed buffered commands;
they do not prove physical execution. Separately, unplugging the CH340 USB transport stopped new
bytes but left no channel through which the application could send `M5`, safety door, or reset. The
machine stopped after its buffered motion drained while the laser output remained asserted.

The maintainer explicitly requires Pause and Resume to remain usable, and requires every detected
connection failure to request motion and beam shutdown. Removing either control is not an accepted
containment strategy.

### Decision

- GRBL-family laser Pause freezes host refill before any wire write, sends resumable realtime Safety
  Door (`0x84`), and remains in a `pausing` transition until a fresh report from the same controller
  session proves a settled Door state and controller-commanded spindle/laser output off.
- Resume keeps host refill frozen, sends cycle start (`~`), and remains in a `resuming` transition
  until a fresh post-command `Run` or completed `Idle` report arrives. Only then may the streamer
  advance or write more G-code. Acknowledged-line counts never substitute for this status proof.
- `done` means that every line was acknowledged, not that planner motion physically finished. While
  a fresh controller report still says `Run`, the Live Motion bar keeps laser Pause available; Resume
  returns that exhausted stream to `done` without replaying G-code.
- A connected stream-heartbeat failure or active-job transport-write rejection freezes the sender
  and requests realtime reset before any reconnect or port close. Initial Start, acknowledgement
  refill, and tool-change Continue failures all join this path. Intentional Disconnect and live
  connection replacement synchronously cancel host refill, invalidate stale controller evidence,
  then use the same reset-before-close boundary. A real port-close remains terminal ownership; a
  later rejected write cannot resurrect it as an active stream.
- Recovery re-entry is hard-off: `M5`/`S0` precedes positioning, rapid repositioning is explicitly
  unpowered, and positive power is restored only on the first burn-motion line.
- A laser Start whose controller cannot report `$32` requires one explicit Start-anyway
  acknowledgement. A reported `$32=0` is still refused, and neither Machine Setup nor the confirmed
  Console setting lane may write `$32=0` while the active project is a laser. Ordinary Start,
  start-from-line/recovery, and camera-marker burns all carry the same session-bound evidence to the
  final wire boundary. CNC/router projects retain their required `$32=0` path.
- Physical cable removal remains a controller boundary. A desktop application cannot transmit a
  shutdown byte after the transport disappears. A product claim that cable loss always stops motion
  and beam therefore requires a proven controller heartbeat timeout or fail-safe hardware interlock;
  UI state and sender tests cannot stand in for that evidence.

### Consequences

Pause and Resume stay available; while confirmation is pending, the host remains in its visible
paused state and sends no job refill. A timeout or transport failure leaves the host stream frozen,
preserves the interrupted-job record, and keeps software Abort visible. Simulator coverage models
the Safety Door state separately from ordinary Hold. KerfDesk can contain a degraded-but-live link,
but the Falcon/CH340 cable-yank guarantee remains hardware- or firmware-gated until that independent
shutdown path is installed and verified.

---

## ADR-213 - Remove bundled single-line writing and retain the original four outline fonts

**Status:** Accepted | **Date:** 2026-07-16

### Context

The bundled Hershey, EMS, Forge, and traced-script additions did not meet the requested writing
quality. Keeping them in the picker also made the text workflow harder to judge because the added
single-line geometry behaved differently from the original outline fonts.

### Decision

- Remove every bundled single-line font entry, renderer, preview, generated glyph dataset, source
  font binary, generator, test, and license notice.
- Keep only the original bundled Roboto, Inconsolata, Pacifico, and Dancing Script outline fonts.
- Preserve project-embedded font import and the independent text-to-layer machining controls,
  including V-carve, pocket, profile, and engrave choices.
- Keep historical ADR-194, ADR-198, and ADR-199 as superseded records rather than erasing why the
  removed implementation existed.

### Consequences

New and edited text uses the original outline rendering path. Saved objects retain their materialized
geometry, but a removed bundled font key is treated as unavailable when the operator tries to
regenerate it and must be replaced with an available bundled or embedded font. The application no
longer ships or advertises the removed single-line writing assets.

---

## ADR-214 - Version-stamp pen-drawing fairing instead of re-deriving fitter output

**Status:** Accepted | **Date:** 2026-07-16

### Context

The pen-drawing fairing migration (`upgradeProjectPolylineFairing`, from the #188-#197 series) decides
whether a stored drawing needs re-fairing by re-running `createPolyline` and comparing the result to
the stored curves with `JSON.stringify` byte-for-byte, plus a byte-identical match against a
reproduced legacy-adapter curve. Recognition therefore depends on the fitter producing exactly the
same serialized output it did when the drawing was saved. Any later change to `roundPolylineCurve`,
`fairLineCurvePath`, `fitLegacyCentripetalCubics`, or the fit-tolerance constants silently breaks that
match: an already-migrated drawing stops being recognized and could be re-faired (or a genuinely
legacy one skipped). A claim-verification audit (2026-07-16, finding F5) flagged this as latent
migration fragility - correct today, but a trap for the next fitter change.

### Decision

- Add an optional `fairingVersion?: number` to `ShapeObject`, persisted in `.lf2` like `provenance`
  (structural serialize passthrough plus an `optionalNonNegativeNumber` validator entry). A file from
  a future build carrying a higher version is tolerated, never downgraded.
- `createPolyline` stamps the current version (`CURRENT_POLYLINE_FAIRING_VERSION`, in `core/shapes`)
  on every drawing it produces, so new and re-faired drawings are born marked.
- The migration first checks the stamp: a drawing at or above the current version is recognized by the
  stamp alone and skipped, with no re-derivation. Only unstamped (pre-marker) drawings fall back to the
  existing structural recognition, and when the migration upgrades one it stamps the current version on
  the result.
- Bump `CURRENT_POLYLINE_FAIRING_VERSION` whenever the fairing engine changes in a way that should
  re-fair existing drawings; the version comparison then performs an explicit, deterministic migration
  instead of a fragile output-equality guess.

### Consequences

Recognition of an already-faired drawing no longer depends on reproducing byte-identical fitter output,
so a future fitter or tolerance change is safe: stamped drawings are skipped, and a version bump
re-fairs them deterministically. Pre-ADR-214 drawings carry no stamp and are still recognized
structurally on their first load, gaining a stamp only if the migration upgrades them (unchanged
already-current legacy drawings stay unstamped and are re-evaluated harmlessly each load until edited).
This is a purely additive schema field; older builds ignore the unknown key.

## ADR-215 - CNC recovery rewinds to a pass boundary and re-enters as a new sealed job

**Status:** Accepted | **Date:** 2026-07-16

### Context

Laser interruption recovery (ADR-118 and its 2026-07-15 amendment) resumes automatically from the
first un-acked line with a fail-dark re-entry. CNC kept refusing every executable path: ADR-143
disabled checkpoint/line resume because acknowledgements do not prove physical cuts, and the
ADR-200 supervised runway flow is too narrow for daily use — single-tool native contour segments
only, a straight >= 5 mm tangent runway (a rectangle interrupted just after a corner has none), no
mapping from acked lines to geometry (the operator picks one segment from a flat list of all of
them), and an evidence layer whose policy check is fed all-green literals derived from its own
checkboxes. The maintainer approved the pass-rewind plan on 2026-07-16 ("yes to all four"), with
two standing constraints: the recovery program must live in the same sealed artifact sandbox as
laser recovery so nothing can corrupt the controller, and the laser feature must remain untouched.

### Decision

- CNC recovery generates a NEW ordinary Job that starts at the beginning of a pass and keeps every
  later pass and group in source order (`core/recovery/cnc-pass-resume-job.ts`). A pass boundary is
  a physically safe re-entry point: each stepdown is its own constant-Z pass, so the plunge at
  the boundary is either through already-cut kerf or is exactly the pass's own designed first
  plunge (a boundary pass that never started; a group's first pass into virgin stock) — never a
  mid-material spindle start. The ordinary emitter preamble (safe-Z retract ->
  `M3 S` -> `G4` spin-up dwell -> rapid -> plunge at plunge feed) has the spindle at full speed
  before any material contact. Recutting the already-cut part of one pass is the accepted cost;
  the boundary can never skip uncut material.
- The CNC emitter reports a per-pass raw-line span sidecar (`emitCncJobWithPassSpans`). Recording
  is observation only: the emitted bytes are identical to the ordinary strategy, property-verified.
- `resolveCncResumePoint` maps the checkpoint's acked count onto a default boundary pass with
  honest bounds: a per-controller planner reserve below (acked lines may sit unexecuted in the
  planner when power is lost) and an RX-buffer byte walk above ('char-counted'; a single in-flight
  line for 'ping-pong'). Reserves deliberately overestimate — the safe failure direction is an
  earlier boundary and extra recut time.
- The operator may pick any pass; picking later than the computed default warns and never blocks.
- Position requalification splits by evidence: a session-continuous interruption (no controller
  reboot observed, live WCO matching the archived observation) may be confirmed as retained
  instead of forcibly re-zeroed; a lost-position interruption still requires re-establishing zero.
  This supersedes the unconditional re-home/requalify wording of ADR-200's 2026-07-15 amendment.
- The physical checklist keeps the load-bearing confirmations — cutter physically clear, spindle
  stopped, workholding unchanged, tool intact, position path — and drops the free-text air-cut
  qualification record and the decorative all-green `assessCncRecovery` evidence feed for this
  path. The runway machinery is retained but demoted from the default flow; whether to delete it
  is a separate later decision.
- Sandbox and isolation invariants: the recovery program is staged as a new attempt artifact in
  the ADR-118 repository before any wire byte, uses the durable Start handoff and the final
  wire-boundary drift authorization, and archived controller observations are never replayed to
  firmware. Laser paths are untouched: `buildResumeProgram` continues to refuse CNC, ADR-143's
  refusal of line-based executable CNC resume stands (a pass-boundary job is compiled from the
  sealed semantic Job, never from a G-code line jump), and same-session CNC Resume stays disabled
  (ADR-180).

### Consequences

The first PR is pure core with no UI or flow wiring: the span sidecar, the pass-resume job
builder, and the resume-point mapper. Property coverage: byte-identity over fuzzed jobs, the
plunged-travel invariant on emitted resume programs, byte-identical re-emission of every kept pass
after the boundary, and boundary-never-after-the-first-unacknowledged-line. Later phases add the
artifact span field, the pass-based recovery flow on the existing sealed-capsule streaming
skeleton, and the reworked wizard (interruption narrative, extraction guidance, canvas progress
preview, pass picker, trimmed checklist). Long `path3d` relief passes recut whole for now;
mid-pass re-entry is a future refinement. Multi-tool jobs become recoverable with an explicit
load-tool/re-zero wizard step. Simulator and unit evidence only: physical air-cut/scrap validation
on the real router remains release-acceptance work, and no hardware claim is made here.

---

## ADR-216 - Show CNC pass progress on the live canvas from the ADR-215 span sidecar

**Status:** Accepted | **Date:** 2026-07-16

### Context

The live canvas overlay (planned route, confirmed trail, controller-reported head, status badge) is
machine-agnostic and already reconciles CNC runs in three dimensions. But CNC depth passes retrace
the same XY route, so after the first pass the confirmed trail stops changing visibly - the head dot
is the only remaining sign of motion, and the operator cannot tell which depth pass is cutting or
how many are left. The maintainer asked for the CNC canvas to show job movement like the laser side
and to display the passes remaining. ADR-215 already records, as a byte-neutral emission sidecar,
each pass's raw-line span in the exact emitted program.

### Decision

- At Start-plan build time a CNC plan re-derives the pass spans by re-running the span-recording
  emission of the prepared job and requiring byte-identity with the program actually started, then
  projects each span onto the motion manifest's route distances. Any disagreement (a header, a
  resume rewrite, a span/manifest mismatch, no motion) omits the pass data entirely - a missing
  counter is honest, a wrong one is not.
- The live head label appends `Pass k/N` and the status badge appends `Pass k of N - m remaining`,
  both derived from the same confirmed-route frontier as the trail: the counter advances only with
  route-reconciled motion and freezes whenever the route is uncertain or the run is not advancing.
- Pass ordinals are job-wide (every recorded span counts once, across groups), matching the preview
  scrubber's pass stepper (WORKFLOW F-CNC4) rather than per-layer numbering.
- Resume and recovery programs renumber every line, so `rebuildCanvasPlanForGcode` drops the
  original run's spans instead of letting them describe a different program.

### Consequences

Operators watching a CNC run can see which depth pass is cutting and how many passes remain,
sourced from controller-confirmed progress rather than acknowledged lines, so reporting gaps
resolve conservatively (the counter can briefly lag, never overstate). Pass progress is absent for
programs that are not the plain strategy emission - supervised recovery streams keep their own
ADR-215 presentation until they carry spans of their own. The feature is display-only: it changes
no G-code bytes, no streaming behavior, and no controller commands.

---

## ADR-217 - Show the live controller feed rate on the canvas motion badge

**Status:** Accepted | **Date:** 2026-07-16

### Context

GRBL-family controllers report the current feed rate in the `FS:`/`F:` field of every real-time
status frame, and the parser already surfaces it as `StatusReport.feed`, but nothing displayed it.
During a job the operator could see position, Z, and (for CNC) the pass counter on the canvas motion
badge, but not how fast the machine was actually moving - which is what reveals feed-override effects,
acceleration ramps, and a controller clamping to its max rate.

### Decision

- Thread the reported feed onto `LiveCanvasRun` as `reportedFeedMmPerMin`, captured once per status
  frame in `liveCanvasStatusPatch` exactly like `controllerState` and the reconciled head. It is
  normalized to mm/min by a core helper symmetric with the position normalizer: an inch-configured
  controller (`$13=1`) reports the feed in inch/min, so it is scaled by 25.4 to match the badge's
  mm-committed readouts (Z, position).
- The badge appends `N mm/min` (rounded) after the controller state, but only while the run
  lifecycle is `running`. A held run reports 0 and a stopped/disconnected run's last sample is
  stale, so restricting to `running` keeps the number live and never misleading.
- When the frame carries no feed sample (feed-less `F:` builds, Marlin queued-poll, non-GRBL) the
  readout is omitted rather than guessed.
- Applies to both laser and CNC jobs; unlike the pass counter it is not machine-kind specific.

### Consequences

Operators see the actual controller-reported feed rate while a job runs, alongside the existing
position, Z, and pass readouts, sourced from the same status frame as the rest of the badge. The
change is display-only: no new field is emitted, no G-code, streaming, or controller behavior
changes, and controllers that do not report feed simply omit the number.

---

## ADR-218 - CNC line-art contour side selection (inner / outer / both)

**Status:** Accepted | **Date:** 2026-07-16

> **Numbering note.** ADR-217 (live feed-rate canvas badge) was the last used; **ADR-218** is the next free.

### Context

A boundary trace (the Line Art preset) vectorizes a stroked drawing as rings:
every drawn line arrives as an outer edge plus an inner edge one stroke-width
apart, wound in opposite directions (fill-rule convention). The CNC compiler
machines every closed contour on a layer — correct for filled silhouettes, but
for a traced line drawing it cuts the same groove twice: the inner edge
completes its full depth ladder (freeing the part), then the outer edge starts
a fresh shallow ladder traversed the opposite way. Observed in the field
(job111.gcode, 2026-07-16) as "the job finished, then started a new reversed
job slightly outside the finished path" — with a 3.175 mm bit and a 0.72 mm
gap, the second ladder re-cuts a kerf the first already destroyed, on a freed
workpiece.

### Decision

- New optional per-layer `lineArtContours: 'inner' | 'outer' | 'both'` on
  `CncLayerSettings` (CNC-only UI, shown for the outline cut types plus
  engrave). Absent = 'inner' at compile time (`DEFAULT_LINE_ART_CONTOURS`).
- Selection runs in `passesForLayer` BEFORE tool-radius offsetting, so the
  surviving edge offsets as a lone shape. Band-based cut types (pocket,
  v-carve, inlay-pair, drill, relief) never select — their geometry needs both
  edges of a ring.
- A pair qualifies only under direct containment with per-side bounding-box
  gaps at or below the layer's bit diameter (`selectLineArtContours`,
  `core/cnc/line-art-contours.ts`). Wider nesting (washer walls, real ring
  parts), lone contours, open paths, and crossing geometry always cut.

### Consequences

- 'both' — and any scene without tight double-line pairs — compiles
  byte-identically to the pre-ADR pipeline.
- The default is 'inner' by explicit maintainer decision (2026-07-16):
  existing projects whose artwork contains sub-bit-diameter double lines
  change output on their next compile — they stop double-cutting. That is the
  point; 'both' restores the old behavior per layer.
- The bit-diameter threshold means changing the layer's bit can change whether
  a pair is treated as line art; the field tooltip documents this.
- kerf-offset.ts and profile-ordering.ts still carry local point-in-polygon
  copies; migrating them onto the new shared core/geometry/point-in-polygon.ts
  is deferred tidy-first work.

---

## ADR-219 - Centerline arc-length quadratic fairing (anti-wobble stage)

**Status:** Accepted | **Date:** 2026-07-16

> **Numbering note.** ADR-218 (line-art contour side) was the last used; **ADR-219** is the next free.

### Context

Centerline traces of smooth curved strokes come out visibly wobbly ("not
100% smooth on turns" — maintainer field report, 2026-07-16). Measured on an
ideal-circle stroke fixture (R = 80 px, 4 px stroke): the traced centerline
deviates up to ±0.71 px (rms 0.29 px) from the true center. Root cause: the
chain pipeline's 1-ring Taubin passes are a narrow-band filter — they kill
the adjacent-vertex staircase but pass ripple with wavelengths beyond ~6
vertices essentially unchanged, and the medial axis of a rasterized curve
carries exactly that residue (a lattice beat whose wavelength scales with
sqrt of the curve radius). Douglas-Peucker then anchors its output vertices
on the beat's extremes, baking the wobble into the final polyline and the
fitted display curves.

### Decision

A bounded arc-length quadratic fairing stage
(`core/trace/centerline/arc-fairing.ts`) runs between curvature smoothing and
simplification in `finalizeChains`:

- Windowed weighted least-squares quadratic fit of x(t), y(t) over arc length
  (Savitzky–Golay on a curve). A parabola matches a constant-curvature arc to
  second order, so genuine turns — including small glyph bowls — keep their
  radius (no Laplacian melt; verified by a no-shrink test on an R = 4 px loop).
- Window half-width tracks sqrt(local curve radius) (Menger circumradius over
  ±8 px probes), clamped to [3, 14] px, symmetric, and never crossing a pinned
  vertex (corners / hard turns / open endpoints via the shared
  `classifyAnchors`).
- Two passes; every vertex's TOTAL displacement is capped at 0.45 px from its
  original position — the same sub-pixel scale `SIMPLIFY_EPSILON_PX` already
  treats as noise, so no tolerance contract changes.

### Consequences

- Ideal-circle fixture (4 px stroke): max deviation 0.71 → 0.56 px, and the
  rendered trace loses its visible facets/dents (probe renders under
  `trace-audit-artifacts/`, harness `_centerline-wobble-probe.test.ts`,
  gated on CENTERLINE_PROBE=1).
- Edge Detection shares `assembleStrokePaths`, so its chains are faired the
  same way; the full trace + perceptual suites pass unchanged.
- Residual known defect (out of scope here): a 2 px-wide circle stroke still
  fragments into multiple loops before assembly — thin-stroke thinning gaps,
  unrelated to fairing.
---

## ADR-220 - Show the live spindle RPM on the CNC canvas motion badge

**Status:** Accepted | **Date:** 2026-07-16

### Context

GRBL reports the current spindle speed in the second component of the `FS:` status field, already
parsed as `StatusReport.spindle`. Having added the live feed rate to the canvas motion badge
(ADR-217), the spindle speed is the natural companion readout for a router operator: it confirms the
spindle actually reached and holds commanded RPM during the cut. But the same `FS:` slot carries a
laser's power `S` value, not an RPM, so a naive readout would mislabel laser power as spindle speed.

### Decision

- Thread the reported spindle onto `LiveCanvasRun` as `reportedSpindleRpm`, captured once per status
  frame alongside the feed rate. It is passed through unscaled: unlike feed and position it is an
  RPM/power value, not a unit distance, so `$13` inch reporting must not scale it.
- The badge appends `N rpm` (rounded) after the feed rate, gated on `machineKind === 'cnc'` and,
  like the feed readout, on the run lifecycle being `running`. A laser never shows an RPM: its
  `FS:` spindle slot is a power value, so labeling it rpm would be a fidelity bug.
- When the controller reports no spindle sample the readout is omitted rather than guessed.

### Consequences

Router operators see the live spindle RPM next to the feed rate while a job runs, both sourced from
the same status frame. Laser jobs are unaffected - the RPM readout never appears for them. The
change is display-only: no new field is emitted, and no G-code, streaming, or controller behavior
changes. The `S` value the controller reports depends on the machine's `$30` max-RPM mapping being
configured correctly; the badge faithfully shows what the controller reports, as with feed.

---

## ADR-221 - Show wall-clock elapsed job time on the canvas motion badge

**Status:** Accepted | **Date:** 2026-07-17

### Context

The canvas motion badge shows what the machine is doing (state, feed, RPM, Z, pass progress) but
not for how long. The pre-job ETA exists (the live estimate), yet once a job runs the operator has
no on-canvas answer to "how long has this been cutting?" — the number that matters when deciding
whether a job is worth aborting or a pass count is plausible.

### Decision

- `LiveCanvasRun` gains `startedAtMs` (stamped by `liveCanvasStartPatch` when the run is created;
  0 means unknown, as in hand-built fixtures) and `endedAtMs` (stamped once, at the run's FIRST
  terminal lifecycle transition — stopped, disconnected, errored, or finished — by the status and
  lifecycle patch functions). Both clocks enter through a `now: number = Date.now()` trailing
  default parameter, the repo's existing testability idiom; later report churn can never move a
  frozen end stamp.
- The badge shows `• <elapsed>` right after the machine state, formatted by the same
  `formatDuration` the pre-job ETA uses. Elapsed is wall-clock: holds and tool changes keep
  counting (matching what an operator's watch says), and the readout freezes at the terminal stamp
  so a finished or aborted job displays its final duration.
- Status frames alone can be sparse (settle-only controllers report at motion boundaries), so the
  badge re-renders on a one-second interval — but only while a run with a real start stamp and no
  end stamp is displayed; idle canvases and terminal runs schedule nothing.
- A run without a real start stamp (0) shows no elapsed time: a missing timer is honest, a made-up
  one is not.

### Consequences

Operators see live elapsed time next to the machine state for both laser and CNC jobs, frozen at
its final value when the run ends however it ends. The readout is display-only and wall-clock —
it makes no claim about cutting time vs held time. Fixtures and archived runs without a start
stamp simply omit it.

---

## ADR-222 - Single-artwork scenes select the artwork by default

**Status:** Accepted | **Date:** 2026-07-17

> **Numbering note.** ADR-221 (wall-clock elapsed badge, #247) landed during this PR's CI run;
> this ADR renumbered 219 -> 220 -> 221 -> 222 as the fleet landed.

### Context

The dominant workflow is one design on the bed. A fresh import already selects its artwork
(F-A3), but Open project, undo/redo, and deleting down to the last object could land on
"Nothing selected". The Selected-artwork inspector and per-operation settings hang off the
selection, so the operator had to click the only object to get them back. The first ADR-222
implementation interpreted "selected by default" as "always selected" and immediately
re-marked the artwork after Escape, an empty-canvas click, or a marquee miss. Maintainer
clarification (2026-07-17): mark it from the start, then let the operator unmark it.

### Decision

An App-mounted subscription (`useSingleArtworkSelection`) applies the default at mount and when
the scene enters a new one-selectable-artwork state. It compares the previous and next lone
artwork ids and never reacts to selection-only changes, so an explicit deselect remains
authoritative. Project Open applies the same default in `setProject`, including when two
different projects reuse the same object id. `loneSelectableArtworkId` defines "only artwork":
exactly one scene object that is not the registration jig / captured-board outline (ADR-057 /
ADR-124 placement aids, never counted and never auto-selected). The lone artwork must also be
selectable; locked artwork and artwork on a hidden layer stay unselected.

A stationary right-button release on empty canvas clears selection before opening the empty
workspace context bar. The pointer-event path accepts `pointerup` (as well as legacy `mouseup`),
while a right-button drag beyond the context-click tolerance remains a pan and does not alter
selection.

### Consequences

- Import, Open, undo/redo into a lone-artwork scene, and deleting down to one selectable artwork
  start with that artwork selected.
- Escape, an empty-space left click or marquee miss, and a stationary empty-space right click
  clear the selection and leave it clear until the operator selects artwork or the scene enters
  a different lone-artwork state.
- Default selection changes selection state only: it creates no undo entry and no dirty flag.
---

## ADR-223 - Default CNC laptop layouts to Canvas Focus while preserving explicit 3D choice

**Status:** Accepted | **Date:** 2026-07-17

> **Numbering note.** ADR-222 (single-artwork default selection, #250) was the last merged;
> **ADR-223** is the next free. This PR's ADR started as 221 and was renumbered as the fleet landed.

### Context

At the audited 1366 x 768 laptop viewport, the CNC 3D result pane, Artwork /
Operations rail, and Machine rail opened together and left about 444 px for the
drawing canvas. ADR-191 made the 3D pane resizable and collapsible, but still
required the operator to diagnose and repair the crowded starting layout.

LightBurn's workspace model keeps docked windows user-configurable and provides
one-action side-panel hiding. KerfDesk's persistent CNC 3D result has no direct
LightBurn equivalent, so its responsive default is KerfDesk-specific; preserving
an explicit operator layout choice follows the same customization principle.
The maintainer approved the next ranked audit upgrade with "build the next" on
2026-07-17.

### Decision

- With no saved visibility preference, a CNC viewport matching
  `(max-width: 1439px)` starts in **Canvas Focus**: the 3D result pane collapses
  to a named 44 px vertical restore strip. Wider viewports start with 3D open.
- Clicking the existing 3D collapse/expand control records `collapsed` or
  `expanded` in `laserforge.cnc-3d-pane-visibility.v1`. That explicit choice
  overrides responsive defaults across later breakpoint changes and reloads.
- The persisted width from ADR-191 remains independent. Restoring 3D uses that
  width, and the drag/keyboard resizing contract is unchanged.
- Canvas Focus changes UI layout only. It does not change project data, undo,
  compilation, G-code, controller state, or any machine-safety gate.

### Consequences

- In the audited 1366 px layout, the measured drawing surface grows from about
  444 px to 677 px while both operational rails remain available.
- The full-height named strip keeps 3D restoration one click away and keyboard
  accessible through the same semantic button and `aria-expanded` state.
- Because the existing removal-grid hook receives the collapsed state, the live
  3D simulation is not recomputed while Canvas Focus is active.
- Users who prefer the split view are not repeatedly overridden by viewport
  changes; their explicit choice wins until they toggle it again.

---

## ADR-224 - Pre-start Job Review dialog consolidates the Start confirmations

**Status:** Accepted | **Date:** 2026-07-17

### Context

Starting a job fired up to two native `window.confirm` dialogs (the unverified-`$32` laser
acknowledgement and the CNC setup attestation) while the prepared program's warnings flashed past in
a toast. The operator had no single place to check what was about to run — power/speed/passes per
operation, placement and the resolved origin, controller facts ($32, $30 vs profile, travel,
overrides, WCS), machine/stock setup, estimated time, or the size of the exact G-code — before
committing material. The maintainer asked for a professional pre-start review window ("a final
review that can visually help you check all settings in one pop up window … when you press confirm
it starts", chat request of 2026-07-17). That request is recorded here as the ADR-206 /
non-negotiable #21 approval for this confirmation gate.

### Decision

- Every Start that goes through the shared flow (`runStartJobFlow`: toolbar button,
  Cmd/Ctrl+Return, Run again, confirmed checkpoint replacement) opens the Job Review dialog after
  `prepareCurrentStartJob` succeeds and streams only after the review's **Start job** button.
  Recovery flows (supervised recovery, start-from-line, checkpoint resume) keep their own review
  surfaces and native confirms, unchanged.
- The dialog absorbs the two former native confirms with their exact prompt text; the single
  Confirm click produces the same `LaserModeStartEvidence` / `CncSetupAttestation` objects the
  transmission layer already consumed. Net refusal surface is unchanged — prompts that used to
  appear as `window.confirm` now render as sections of one window (consolidation, not expansion),
  and the warnings strip is display-only and never disables Confirm.
- The review is live and editable: the operations table and placement controls commit through the
  existing store actions (`setLayerParam`, `updateLayerSubLayer`, `setJobPlacement`,
  `setOutputScopeSettings`), and a flow-owned gate re-runs the full prepare pipeline (debounced)
  after any project/placement/scope change, swapping the shown model in place. A refused re-prepare
  surfaces the exact readiness messages as an in-dialog blocker — the same edit would refuse Start
  today — and editing further recovers in place. Cancel/Escape is side-effect-free: recovery
  staging and handoff arming still happen only after Confirm.
- Architecture: a promise-signal store (`useJobReviewStore`, the ConfirmSave precedent) holds the
  pending request; a flow-owned loop (`runJobReviewGate`, in `src/ui/laser/job-review/`) owns
  re-preparing and returns the exact reviewed bundle. Only that bundle reaches authorization and
  streaming, and the unchanged start-authorization gates (execution-signature re-check plus the
  wire-boundary assertion) backstop any residual staleness between the last shown program and the
  streamed bytes.

### Alternatives rejected

- A read-only summary — the maintainer explicitly chose inline editing of the core numbers.
- Stacking the review dialog on top of the existing native confirms — two dialogs for one decision.
- A store-held `rebuild()` closure instead of the flow-owned loop — it duplicates flow logic inside
  the state layer and makes the streamed-equals-shown invariant unprovable.

### Consequences

- Operators get one consistent pre-burn checkpoint: exact-program stats (estimate, bounds/motion
  envelope, operations/cutters, G-code size), editable core numbers, placement with the resolved
  origin, live controller/machine fact sections, warnings that no longer vanish with a toast, and
  the safety acknowledgement, in a single `xl` dialog.
- The Start-path warnings toast is gone (the in-dialog strip replaces it). E2E flows confirm the
  review after each Start click. Existing flow tests answer the review through a test seam
  (`installAutoJobReview`); `captureJobReviewModels` lets tests assert exactly what the operator
  was shown.
- The dialog reuses `JobPlacementControls` wholesale, so placement UX cannot drift between the job
  panel and the review.

### Revision - v2 (2026-07-17, same day)

Maintainer feedback after using the shipped dialog: make it more visually attractive, drop the
placement section, show all artwork and material settings per profile, and collapse the warnings
into a dropdown. Changes, none touching the gate contract:

- **Job placement section removed.** Placement stays editable on the machine rail. The review
  keeps two read-only echoes: an Origin stat tile and the `Runs from ...` fact in the footer.
- **Operations became "Artwork settings".** Every row gains a muted detail line with the
  mode-specific settings (laser: kerf/tabs/pass-through, hatch, dither; CNC: computed passes,
  stepover, direction, tabs, entry strategy, finish allowance) and the bound material preset as
  a chip resolved from the material library.
- **New CNC "Material & stock" card** - project material (chipload key), stock footprint, stock
  origin offset, safe Z.
- **Warnings render as a collapsed amber dropdown** whose summary always shows the count.
  Identical warnings are grouped at the source: `detectUncalibratedJobWarnings` now emits one
  message naming the affected operations by *name* (it previously printed raw layer ids, one
  line per layer - ten imports produced ten near-identical paragraphs).
- **Visual pass:** accent-tinted hero estimated-time tile, uppercase micro-labels, mode chips,
  chevroned fact sections with counts, sticky Cancel/Start footer with a play glyph.
- **Guard surface unchanged:** still one affirmative click, warnings still never block, and
  in-dialog blockers still only re-surface refusals the readiness pipeline already issues.
> **Numbering note.** Drafted as ADR-221, but the fleet landed ADR-221 (elapsed-time badge),
> ADR-222 (single-artwork selection), and ADR-223 (Canvas Focus layout) on main mid-flight - so
> this entry is **ADR-224**. Re-verify the tail and open-PR claims before merge.



## ADR-225 - Machine-rail control order, go-green actions, and origin coaching

**Date:** 2026-07-17
**Status:** Accepted

**Context.** The machine-rail job cluster predated the ADR-047 design system: bare
browser-default buttons in ragged wrapping rows, an unlabeled 3x3 anchor grid, a
double-bordered "Position job" card with a redundant jog-method chooser, and no
visual cue that a no-homing job needs an origin before Start. The maintainer
directed a redesign in review (2026-07-17 session; originally PRs #248/#255,
re-landed after a merge race via #261).

**Decision.**

1. Rail order is placement -> origin -> job actions -> hand-positioning guide.
   The Start from dropdown and job-origin anchor grid sit directly above the
   Origin buttons, Start/Frame/Home/auto-focus follow under a JOB caption, and
   the no-homing "Position job" card renders last as the fallback path. This is
   a deliberate, maintainer-directed divergence from LightBurn's Start-first
   Laser window, matching the no-homing workflow (jog, set origin, then start).
   Locked by JobControls.layout.test.tsx; the ux-shell e2e asserts Frame/Start
   are scroll-reachable inside the rail rather than above the 720p fold.
2. Machine-motion "go" actions (Start job, Frame) wear `.lf-btn--go`, a light
   success-tinted fill (`--lf-tint-success`) with AA-contrast success text,
   matching LightBurn's green-means-run convention. Every control in the
   cluster rides the ADR-047 classes (`.lf-btn`/`.lf-select`/`.lf-checkbox`).
3. `.lf-btn--attention` plus the `lf-attention-pulse` keyframes are the standard
   coaching affordance for "the one next required step". First and currently
   only use: "Set origin here" pulses when homing is disabled, the rail is
   connected and idle, Start from = User Origin, and no work origin is active.
   Flat colors only per the tokens.css performance note; prefers-reduced-motion
   gets a static tint. It is a cue, not a guard - nothing is gated (ADR-206).
4. The "Choose jog positioning" button and its "Jog with controls" method card
   are removed from the guide: they duplicated selecting Current Position in
   the Start from dropdown and read as a mystery step. The card reduces to
   plain-language hand-positioning copy plus "Release motors to move by hand";
   the release -> wake -> unlock -> set-origin wizard behind it is unchanged.

**Amendment (2026-07-17, same day).** Placement moves below the job actions: the placement block above the cluster pushed Start/Frame under the 720p fold, and the maintainer requires the go-actions visible without scrolling. Final rail order: origin -> job actions -> placement -> hand-positioning guide. Placement stays a set-once compile setting and is re-presented in the pre-start Job Review dialog (ADR-224), so nothing is lost at Start time. The ux-shell e2e restores the hard above-the-fold assertion for Start job and Frame at laptop height.

---

## ADR-226 - Add four reviewed OFL native-stroke fonts for CNC writing

**Status:** Accepted | **Date:** 2026-07-17

> **Numbering note.** ADR-222 through ADR-225 landed while this work was in
> progress; **ADR-226** is the next free number.

### Context

ADR-213 removed an earlier Hershey/EMS/Forge/traced-script bundle because its
writing quality did not meet the maintainer's request. CNC writing still needs
native centerline letters: tracing an ordinary TTF outline produces edge
contours rather than a path down the middle of each stroke. Four initial BGI
candidates looked suitable, but an asset-level provenance audit found retained
Borland copyright strings and no authoritative license grant for those binary
font files. They must not ship as MIT.

A second rendered review selected Relief SingleLine, EMS Nixish, EMS Decorous
Script, and EMS Casual Hand. Their actual source files identify or accompany
SIL Open Font License 1.1 terms, and the maintainer explicitly approved the
four rendered styles.

### Decision

- Bundle Relief SingleLine from `isdat-type/Relief-SingleLine` commit
  `01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d`, plus EMS Nixish, EMS Decorous
  Script, and EMS Casual Hand from `oskay/svg-fonts` commit
  `8c71f2d9e1a5292047bb88e5595a766241b82cc6`.
- Pin the canonical remote-byte SHA-256 for every source SVG and both source
  license files. The generator refuses a changed hash, a missing OFL marker,
  changed font identity metadata, unsupported path commands, or missing space
  and fallback glyphs.
- Generate compact checked-in glyph data. A pure TypeScript parser supports the
  absolute and relative line/cubic SVG commands used by the reviewed sources
  and materializes only open geometry. Load the data lazily when a stroke font
  is first previewed or rendered.
- Reuse the existing text object's persisted string font key and materialized
  path contract; no project migration or runtime package is added.
- Draw each stroke face from its real machining paths in the font picker.
  Label it single-line and show operation guidance beside the selected font.
- Fresh CNC layers using a stroke font default to Engrave even with a V-bit.
  Engrave and Profile on path are compatible; V-carve, Pocket, Fill, and
  inside/outside profiles require closed outline text.
- Preserve each source's Latin/extended character coverage. Unsupported
  Unicode renders the visible `?` fallback instead of silently dropping
  content.

### Consequences

KerfDesk gains four distinct CNC writing styles that generate one toolpath per
authored stroke, while the rejected ADR-213 bundle and the unverified BGI
candidates stay out of the product. Relief retains native Bézier curves; the
EMS faces retain their authored centerline segments. Outline-font behavior and
saved materialized geometry remain unchanged. The sources are reproducible
from pinned hashes, OFL notices and attribution ship in web and desktop
distributions, and tests prove all four outputs remain finite and open. The
fonts are also usable for single-pass laser line engraving, but their product
labeling and default machining policy remain CNC-oriented.

---

## ADR-227 - Status-bar Update button replaces the PWA update popup

**Date:** 2026-07-17
**Status:** Accepted

### Context

ADR-060's update UX was a fixed bottom-center Reload/Later banner (`PwaUpdatePrompt`). With a
deploy landing on nearly every merge and workbox-window re-firing `waiting` on every page load,
the banner behaved as a permanent interruption: each new deploy legitimately re-armed it (a
strictly-newer SW must not stay swallowed by a persisted "Later"), and before the 2026-07-17
uncontrolled-page fix its Reload could also be a silent no-op, leaving the same "new version"
message standing after the user acted — which reads as "there is no update, stop asking." The
maintainer asked for the popup to be removed entirely in favor of a prominent control the
operator clicks whenever they choose.

### Decision

1. **No popup, banner, or dialog for update availability - ever.** `PwaUpdateWatcher` (replacing
   `PwaUpdatePrompt`) is headless: it registers the service worker exactly as before (ADR-060
   items 1, 3, 4 unchanged, still web-only via `PwaUpdateWatcherGate`) and publishes readiness to
   a dedicated Zustand slice, `pwa-update-store`
   (`{ kind: 'none' } | { kind: 'ready'; applyUpdate }`).
2. **The status bar hosts the update control.** `PwaUpdateButton` renders a right-aligned
   primary **Update** button whenever availability is `ready`. Clicking it runs the staged
   callback - the unchanged `applyPromptedReload` path (skip-wait, then a guaranteed reload in
   every service-worker state). The update still applies only on a user click; ADR-060's
   "never auto-reload" rule stands.
3. **The old banner's machine suppression carries over verbatim as presentation.** The button is
   hidden - not disabled - while a job is active or a safety notice / motion operation /
   controller operation is pending; readiness persists in the store, so the button reappears
   once the machine clears. This preserves ADR-060's "a reload can abort motion" intent with no
   new guard surface (ADR-206: same predicate, same effect, nothing newly blocked).
4. **The "Later" dismissal machinery is deleted** (`pwa-update-dismissal.ts` and the
   `updatefound` re-arm). It existed only to stop the popup from re-nagging; a passive button
   does not nag, so workbox re-firing `waiting` on every load is now harmless. The orphaned
   `kerfdesk.pwa.dismissedUpdateVersion.v1` localStorage key is simply ignored.

### Alternatives rejected

- A popup with longer/persistent dismissal - any popup re-surfaces on the next deploy, and this
  project deploys on nearly every merge; the nag was structural, not a timing bug.
- An always-visible "Check for updates" control - permanent chrome for a state that is almost
  always empty; update discovery still happens on page load exactly as before.
- Disabling instead of hiding during jobs - a visible disabled control invites mid-burn clicks
  and enlarges the existing suppression surface; hiding preserves it exactly.
- A toolbar placement - the status bar is the app's persistent low-attention strip (VS
  Code-style update affordance) and the maintainer asked for a "task bar" location.

### Consequences

- Operators are never interrupted about updates. LightBurn (desktop) shows a startup update
  dialog; the maintainer explicitly chose no-popup here, so this is a deliberate, recorded
  divergence from LightBurn behavior. (Amended 2026-07-17, rolling audit #22 P3-3,
  maintainer-approved: `PwaUpdateButton` also mounts a visually-hidden `role="status"` live
  region that politely announces readiness to screen-reader users — the deleted banner was
  `role="alert"`, so the passive button was silent for them. Audio-only, no visual popup;
  the suppression predicate is unchanged.)
- On Electron nothing changes: the watcher never mounts, the store stays `none`, the status bar
  never shows the button, and desktop updates remain electron-updater's (ADR-024/ADR-135).
- Files: `src/ui/app/PwaUpdateWatcher(.test).tsx`, `src/ui/app/PwaUpdateWatcherGate(.test).tsx`,
  `src/ui/state/pwa-update-store.ts`, `src/ui/common/PwaUpdateButton(.test).tsx`, StatusBar
  hosting + tests; `PwaUpdatePrompt*`, `pwa-update-dismissal.ts` deleted.

## ADR-228 - Frame-first Start gate: Frame is the sole guard

**Date:** 2026-07-17
**Status:** Accepted (maintainer directive, verbatim: "FRAME IS SOURCE OF TRUTH... when a frame
completes. start can start with no blocks or guards or checks at all. no alarm. frame is good
start is open... no guard will ever be created again.")

### Decision

A completed Frame for the exact current job is the ONLY Start policy gate, on both laser and CNC
and for every placement mode. `requiredFrameIssueFromPrepared` compares the compiled job's bounds
signature and origin identity (WCO + custom-origin flag) against the recorded
`FrameVerification`; every successful Frame dispatch records it. Any drift - edited artwork,
moved origin, a different head position baked into a current-position compile - invalidates the
record and requires a fresh watched trace. The blocked-Start dialog offers to run the Frame in
place. After the Frame, the Job Review dialog (ADR-224) is the single confirmation popup; its
warnings list is the one surface for everything the deleted guards used to refuse.

### Deleted or demoted by this ADR

- Absolute-home gate (`absolute-placement-safety.ts`) - DELETED (module removed; Start button and
  Frame no longer pre-disabled or refused for homing state).
- Camera-placement Start gates (absolute-mode requirement, home/position-epoch proof, geometry) -
  removed from Start and Frame paths; the camera panel keeps its own in-panel confirmation UI.
- Controller-readiness errors at Start ($30 mismatch, $32=0 on laser, $32=1 on CNC, spindle scale
  mismatch, absent settings on CNC) - demoted to Job Review warnings. The $32 acknowledgement
  banner now also covers a reported $32=0.
- $32=0 wire-boundary refusal in `laser-mode-start-evidence` - deleted.
- Ordinary-Start controller-qualification gate (`normalStartQualificationBlockMessage`) - deleted
  for BOTH machine kinds. Supervised recovery keeps strict qualification.
- Out-of-bed, no-go-zone, laser-on-travel, long-blank-feed, plunged-travel and all other emit
  preflight findings except unstreamable bytes - demoted to Job Review warnings.
- Placement-bounds and no-go origin checks (`placementBoundsIssueFromPrepared`) - demoted.
- CNC Start policy gates: dialect (`CNC_REQUIRES_GRBL`), override values/acknowledgement,
  accessory state (spindle/coolant/secondary/encoder/tool-change latches), missing Work-Z and
  tool/Z identity, fresh Ov:/A: observation requirement - demoted to Job Review warnings; the
  wire-level CNC assert now checks only transport state (connection, alarm, status, Idle, MPG).
- Blocked-Start fix offers for gates that no longer block (Zero-Z, probe-plate, override reset,
  absolute-home, apply-$30) - removed with their gates. Alarm Unlock/Home offers, the Frame
  offer, and the origin compile-input offers remain.

### Kept - these are not guards

- Transport preconditions: disconnected, no status report yet, controller Alarm/not-Idle, active
  job/jog/frame/controller operation/autofocus, MPG active, pending console write, RX-oversized
  line, double-Start race. The serial channel factually cannot accept the stream; Frame itself
  cannot run in these states either. Alarm offers Unlock/Home in place.
- Compile integrity: compile failures and unstreamable bytes (`non-finite-coordinate`,
  `empty-output`, `relief-needs-cnc`, `no-output-layer`).
- Handoff consistency: evidence-changed re-prepare, execution-signature and external-environment
  match, CNC setup attestation binding, start reservation epochs, checkpoint/receipt/fingerprint
  resume integrity, and the supervised-recovery flows.
- Placement compile inputs: a placement mode without its required origin/position cannot compile;
  these refusals offer Set origin / Reset origin in place.

### Hard rule

No guard will ever be created again. CLAUDE.md collaboration rule 7 carries the enforcement
text: new guards, re-added guards, widened refusal surfaces, and warnings promoted to blocks are
all prohibited; operator-relevant findings go into the Job Review warnings list. Frame is the
source of truth.
### Amendment (2026-07-18) — proof records at trace COMPLETION; Abort clears it directly

Maintainer approval in chat: "fix both", accepting the post-merge soundness audit's two findings.

1. The FrameVerification payload now rides the frame motion operation itself (armed at dispatch
   by the store's frame action) and is promoted into `frameVerification` only when the trace
   settles status-driven with an empty perimeter queue — matching the directive's wording
   "when a frame completes". Every forced exit (cancel, alarm, error line, disconnect, MPG
   takeover) clears the operation and discards the armed proof with it; a dispatched-then-
   interrupted trace earns nothing.
2. `runStopJob` (Abort) now sets `frameVerification: null` explicitly instead of relying on the
   reset side effects.

Both changes narrow WHEN the one guard's proof exists; the guard surface itself is unchanged.

## ADR-229 - Super console: expanded diagnostics and guarded command dialog

**Date:** 2026-07-18
**Status:** Accepted (maintainer request in chat: "Can we upgrade the console to auto read
settings etc. make it a super console? maybe press a button and a new big console opens up
with in detail view etc."; phased scope approved with "go")

### Context
The docked Console (F-B13) renders the last 150 of 500 transcript entries in a small rail
panel and omits each line's source and time. During the 2026-07-18 Neotronics 4040
regression audit, inspecting controller settings and traffic was cumbersome enough that the
browser's on-disk storage was easier to read than the in-app surfaces.

### Decision
Add a Super console: a Dialog (size xl) opened by a "Super console" button that lives
beside the docked ConsolePanel in the Console rail section (ConsolePanel is at its
file-size limit and keeps its single docked-console responsibility). Version 1 established
the inspection surface:

- the full 500-entry transcript (no 150-entry display cap) with time, direction, source,
  kind, raw, and decoded columns;
- group filters (Errors / Commands / Replies / Status / Stream) with a precedence rule so
  each entry belongs to exactly one group;
- case-insensitive search over raw and decoded text; Copy visible.

Versions 2 and 3 compose the existing settings-read and console-command paths into the same
dialog. They do not introduce a second transport path or direct serial writes.

### Phasing
- v1: transcript inspection, above.
- v2: the machine-settings pane reuses a settings snapshot already read in the current session;
  otherwise it waits until the shared machineSettingsReadBlockReason is null, auto-dispatches
  the existing readMachineSettings ($$) once, and renders named settings plus read-only
  motion/output diagnostics. Profile motion values are labelled as software references, not
  desired firmware truth. Versioned snapshot export and
  neutral A/B import comparison support machine-to-machine investigation without writes.
- v3: a shared ConsoleCommandDeck, extracted from ConsolePanel, provides the same driver parsing,
  confirmation, machine-state gates, safe store dispatch, quick commands, and success-only
  Up/Down history in both the docked and expanded surfaces.
- transcript polish: the expanded transcript uses semantic column headings, searches every
  displayed column, follows new traffic on request, and copies timestamped escaped TSV.

### Guard posture (rule 7 / ADR-228)
No new refusal surface. The passive auto-read checks the shared readiness policy before calling
the store, while the store rechecks it authoritatively. Commands use the existing
sendConsoleCommand -> safeWrite path and its existing confirmations/refusals; UI availability is
advisory and a raced state change still fails closed at the store. Snapshot import/export and
diagnostics are read-only and never call writeGrblSetting. No automatic EEPROM writes are added.

---

## ADR-230 - Exact-artifact Frame authorization and one-use Start permit

**Date:** 2026-07-19
**Status:** Accepted (explicit maintainer ruling in chat on 2026-07-19)

### Context

ADR-228 made a completed Frame the sole ordinary-Start guard, and its 2026-07-18 amendment made
completion rather than dispatch the moment proof exists. The ordinary flow still prepared and
reviewed the job after Frame, however, so the physical trace and the bytes later offered to Start
were not one immutable artifact. Current Position could also resolve from the post-Frame head
position, and an interrupted multi-leg trace could not safely authorize anything.

This decision records the exact-artifact sequencing and the maintainer's rulings without rewriting
the accepted text of ADR-224, ADR-228, or the merged ADR-228 amendment. Where their ordinary fresh
Start sequencing or Frame construction-input classification differs, this ADR supersedes those
portions. Specialized recovery and replay flows retain their separately controlled contracts except
where stated below.

### Decision

1. **Job Review precedes Frame and owns one exact artifact.** Ordinary **Set up & Frame** and
   **Frame job** resolve placement, compile the executable program, compute its generated motion
   envelope, and show that exact candidate in Job Review. The operator acknowledges warnings with
   **Accept & Frame**. Re-review after an edit produces a new candidate; the accepted candidate's
   bytes, fingerprint, placement, controller evidence, and origin evidence stay bound together
   through Frame.
2. **G54 normalization is an owned, acknowledged serial-controller Frame preparation step.** When
   preparation for any serial-controller Frame begins with G55-G59 active, KerfDesk selects G54
   through its owned controller-operation path and waits for the command acknowledgement and fresh
   position evidence before finalizing the candidate.
   The durable Job Review warning names the original G55-G59 selection and states both facts: the
   active selection changed, and the stored G55-G59 offsets were not erased. Cancel or Escape sends
   no Frame/job bytes and issues no permit, but it does not restore the prior selection; G54 remains
   active, exactly as the warning says.
3. **Only clean physical completion authorizes Start.** Frame establishes the driver-produced
   tool-off state, traces the exact generated motion envelope, and returns to the exact
   preparation-time work position. Dispatch is never success. Every owned command must receive its
   terminal acknowledgement, the perimeter queue must drain, controller/origin/settings evidence
   must remain unchanged, and the controller must report a fresh clean final Idle. Cancel, error,
   Alarm, interruption, disconnect, MPG takeover, evidence drift, or an incomplete return discards
   the candidate and earns no permit.
4. **CNC safe-Z construction inputs are required.** Current-session stock-top Work-Z, a known
   return position, and a driver safe-Z Frame builder are coordinate/command inputs needed to
   construct the physical retract, XY trace, exact return, and Z restore. There is no XY-only CNC
   fallback. Dialect, tool identity, probe-plate state, settings, accessories, overrides, bounds,
   and no-go findings remain Job Review warnings rather than ordinary Start policy gates.
5. **The permit is exact and one-use.** Clean completion issues a `FramedRunPermit` for the exact
   accepted bytes and evidence. **Start framed job** atomically claims that permit and streams its
   cached bytes without recompiling, reopening Job Review, or rerunning policy gates. Relevant
   fingerprint/evidence changes invalidate it, and Jog or Home explicitly invalidates it. Live
   transport facts and exact-handoff consistency remain unavoidable at the wire boundary.
6. **Run again is the controlled repeat path.** It does not reuse the consumed permit. It performs
   a fresh compile, fingerprint comparison, and Job Review, and uses the retained compatibility
   `FrameVerification` proof to authorize the deliberate repeat only while that proof and the new
   artifact still satisfy the repeat contract. This keeps batch burns available without turning a
   one-use permit into an unbounded replay token.
7. **Raster-budget fallback cannot authorize Start.** A `raster-too-large` candidate cannot produce
   the executable artifact whose real motion envelope must be framed, so it cannot earn an
   authorizing Frame permit. Any future outline-only positioning feature must be a separately named
   non-authorizing action; it may not mint, retain, or refresh Start authorization.

### Consequences

- One review now owns the warnings, acknowledgements, exact bytes, and physical trace. Ordinary
  Start is reduced to claiming the completed permit plus live transport and exact-handoff facts.
- Selecting G54 is intentionally not rolled back on review cancellation. The durable warning makes
  the persistent active-WCS change and preservation of all stored G55-G59 offsets explicit before
  the operator chooses whether to continue.
- A Frame that merely dispatched, partially moved, failed to return, or never reached fresh clean
  Idle cannot authorize Start. Code and simulator coverage do not replace tool-off hardware
  qualification on supported controller, rotary, and CNC safe-Z configurations.

---

## ADR-231 - A valid Frame proves physically safe motion and the live output contract

**Date:** 2026-07-19
**Status:** Superseded in part by ADR-232 — pre-wire calculated bounds/no-go and `$30`/`$32`
refusals are deleted; unit conversion, cancel settlement, honest profile metadata, and clean
completion requirements remain accepted.

### Context

ADR-228 made Frame the sole ordinary-Start guard and ADR-230 bound one reviewed artifact to one
completion-issued permit. The exact implementation could still command an off-bed/no-go perimeter,
authorize a job whose known interior path crossed a fixture, restore CNC Z below stock-top zero,
interpret `$13=1` inches as millimetres, miss GRBL jog cancellation during the Idle-to-Jog race,
and mint a permit with known-wrong `$30/$32`. A tool-off rectangle cannot prove those facts.

The maintainer cannot perform this qualification physically and asked for the strongest correction
supported by public information for the RNT/PRT-class 4040. Public sources identify the machine as
the Neotronics 4040 Max class and the laser as LASER TREE LT-4LDS-V2, but do not publish the exact
controller board, firmware/settings dump, homing corner, feed limits, selector interlock, or air
relay wiring. The profile must distinguish documented specifications from assumptions.

### Decision

1. **Unsafe motion is not a valid Frame.** Immediately before wire dispatch, the exact reviewed
   motion envelope must fit known travel and its perimeter must clear enabled no-go zones. The exact
   prepared G-code is also rescanned so a known interior/approach-path collision cannot earn a
   permit. Failure sends no Frame motion. Where physical placement is unknowable on an unhomed
   machine, the app does not invent machine coordinates; enabled no-go zones fail closed.
2. **Output semantics are Frame authorization inputs, not Start gates.** Known live `$30/$32`
   conflicts refuse Frame preparation. GRBL CNC also requires those values to be read because an
   unknown spindle scale or laser-mode inversion changes plunge/spindle behavior. Unknown laser
   values remain prominent Job Review warnings. The accepted snapshot is already frozen into the
   candidate and must remain unchanged through completion. Start itself remains a one-use permit
   claim with only transport and exact-handoff facts.
3. **CNC Frame is unit- and stock-safe.** `$13=1` position reports are converted to millimetres
   before G21 commands are built. Frame retracts to safe Z; it restores only a zero or positive
   pre-Frame Work-Z, never a negative position inside stock. XY feed is capped by live `$110/$111`
   and Z independently by `$112` when those settings are available.
4. **Cancel must cross GRBL's state race.** Cancel intent immediately prevents later legs/permits.
   After the current write/ack handoff, the app queries controller state; a fresh `Jog` proves the
   first `0x85` may have arrived too early, so it sends `0x85` again and re-queries. It waits for
   fresh `Idle` before the queued settlement marker, then requires the existing post-marker Idle.
5. **The 4040 profile is a public-spec hybrid starter.** It explicitly supports laser and CNC,
   records the documented 400 x 400 x 75 mm envelope, default 500 W / 12,000 RPM spindle contract,
   and LT-4LDS-V2 optical metadata. It removes unproved verified-origin, rotary, and low-power-fire
   capabilities. The integrated nozzle is modeled as external/manual air with no M-code; setup
   never guesses M7, and an air-requesting exact job warns that no relay command will be emitted.
6. **No online-only hardware claim.** GRBL version, `$` values, homing/origin, feed ceilings,
   spindle variant, selector/interlock, PSU headroom, and M7/M8 wiring remain unverified until read
   or tested on the actual unit. The profile status is `public-spec-starter`, never hardware-verified.

Primary public references: Neotronics 4040 Max product page
(`https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct`), LASER TREE
LT-4LDS-V2 product/manual (`https://lasertree.com/products/20w-optical-power-laser-cutting-module`),
and upstream GRBL settings/jogging contracts
(`https://github.com/gnea/grbl/tree/master/doc/markdown`).

### Consequences

- "Frame is the source of truth" now means a physically valid, cleanly completed Frame of the
  exact artifact; dispatching a known unsafe command can never manufacture proof.
- Start remains simpler than before ADR-228: it neither recompiles nor reruns policy gates.
- Public documentation plus tests can make defaults honest and protocol behavior defensible, but
  cannot certify the machine's wiring or mechanics. Hardware qualification remains explicitly open.

---

## ADR-232 - Physical Frame completion is the spatial source of truth

**Date:** 2026-07-19
**Status:** Accepted (explicit maintainer directive in chat: remove the calculated blocker;
"frame is the source of truth")

### Context

ADR-231 reintroduced policy refusals immediately before Frame dispatch for calculated bed
overhang, configured no-go zones, and known `$30`/`$32` disagreement. That made profile math and
software configuration authoritative over the physical Frame, despite ADR-228's standing rule that
Frame is the only guard. The resulting Start surface could report `Cannot frame: design ...
overhangs the bed` without attempting the trace the operator explicitly chose as the proof.

### Decision

1. **The actual Frame decides spatial validity.** KerfDesk computes the exact reviewed motion
   rectangle only to build the Frame command. Calculated bed overhang and configured no-go findings
   may appear in Job Review, but they never refuse Frame or Start.
2. **Controller-setting policy is advisory.** Known or unknown `$30`/`$32` findings stay in Job
   Review and do not prevent Frame dispatch. A policy warning cannot be renamed an output-contract
   construction failure.
3. **Only clean completion creates proof.** The controller must accept and complete the exact trace,
   return to the captured position, and report clean Idle. Alarm, error, cancel, disconnect,
   interruption, or incomplete return creates no permit. This physical outcome, not calculated
   placement math, is the source of truth.
4. **Factual inability still stops the action.** Disconnected/busy transport, empty or
   unstreamable output, non-finite coordinates, CNC motion that cannot be constructed without the
   required Z/position inputs, and exact-artifact/evidence drift remain refusals because there is no
   valid command or matching handoff to perform.
5. **Delete the misleading refusal machinery.** The dedicated `frame-preflight` bounds/no-go guard
   and Frame controller-settings guard are removed. Ruida export likewise no longer treats profile
   bed math as an export veto. Regression coverage must assert that out-of-bed, no-go, and settings
   findings reach review while a completed Frame can authorize the job.

### Consequences

- The red `Cannot frame: design ... overhangs the bed` Start blocker no longer exists.
- The operator reviews advisories, watches the tool-off Frame, and can Abort; a failed or
  interrupted Frame never authorizes Start.
- ADR-231 remains authoritative for report-unit conversion, cancel-race settlement, honest device
  metadata, and the requirement for clean completion, but its pre-wire spatial/settings refusals are
  superseded.
---

## ADR-233 - Revisioned machine-aware CNC starters initialize new operations without rewriting jobs

**Date:** 2026-07-19
**Status:** Accepted (maintainer request for automatic per-machine feed and plunge settings, followed
by explicit implementation approval and "go")

### Context

The global CNC layer fallback (`1000` mm/min feed, `300` mm/min plunge, `1.5` mm/pass) was shared by
every machine. It was not a useful first operation for the heavier Neotronics 4040, while the public
machine sources establish only its envelope and default 500 W / 12,000 RPM spindle; they do not
publish a material-and-cutter recipe. Calling any unqualified number "best" would overstate the
evidence. Loading a project or reading controller settings also cannot be allowed to reinterpret
operator-authored machining values.

### Decision

1. Add a revisioned CNC machine-starter catalog resolved by exact device profile id and then machine
   family. The Neotronics 4040 engineering starter uses the explicit `em-3175` 3.175 mm two-flute
   end mill with `600` mm/min feed, `120` mm/min plunge, `12000` RPM, and `0.75` mm/pass. It is
   labelled an engineering starter, not a vendor recipe or hardware-qualified optimum. Seeding
   requires that exact end-mill id and diameter to exist in the active machine library; KerfDesk
   never stamps a dangling or identity-reused 3.175 mm override that would compile through a
   different cutter. The layer card and Job Review explicitly repeat the engineering status and
   two-flute cutter assumption so catalog provenance cannot be mistaken for hardware qualification.
2. Resolve the starter only at a boundary that proves an operation is new, or when the operator
   explicitly converts a laser scene to CNC. Project open, autosave recovery, ordinary profile
   replacement, controller observation, duplicate/paste, and derived-operation cloning never seed
   or infer settings for existing operations.
3. An operator-saved per-color or all-color layer default has highest initialization precedence and
   is copied byte-for-byte. Otherwise, an explicitly selected project or layer material remains the
   higher-precedence automatic source.
   On a machine with a catalog starter, chipload-derived feed, plunge, spindle, and depth/pass values
   may be lowered to that starter's conservative envelope. Other profiles retain the existing generic
   chipload calculation.
4. A completed live GRBL settings observation is transient input for future automatic values only.
   The slower of `$110/$111` may lower feed and `$112` may lower plunge. `$30` may lower a spindle
   suggestion only when the same observation reports `$32=0`; a hybrid controller in laser mode
   commonly uses `$30=1000` as a PWM scale, not a 1000 RPM spindle limit. No controller setting is
   written automatically.
5. Persist optional display-only provenance on automatic settings: a revisioned machine-starter id
   or a material recipe plus flute count. Absence means manual or legacy/unscoped. Editing feed,
   plunge, spindle, or depth/pass clears automatic provenance and any stale material label; changing
   a machine-starter tool does the same while preserving its numbers. A material-recipe tool change
   instead recalculates for the new cutter and retains recipe provenance so the displayed bit and
   automatic values cannot disagree.
6. This feature adds no guard. Automatic values are editable suggestions, do not refuse or constrain
   manual input, do not change compilation authority, and do not participate in Start authorization.
   Frame remains the sole ordinary-Start guard under ADR-228, ADR-230, and ADR-232.

### Consequences

- A new 4040 CNC operation starts with a shallow, explainable machine-specific setup instead of the
  global fallback. Selecting a material recalculates within the same conservative machine envelope.
- Loaded and manual jobs retain their exact numeric settings. Reconnecting or receiving a new `$$`
  dump cannot mutate the scene.
- Adding another machine requires a reviewed catalog entry and tests; an unidentified machine keeps
  existing behavior rather than borrowing the 4040 starter.
- The starter still requires operator tuning for the installed cutter, material, workholding, tool
  condition, spindle variant, and machine rigidity. Public research and green tests do not make it a
  hardware-qualified cutting recipe.

---

## ADR-234 - Bounded feed-matched fill entries for the 4040-safe profile

**Date:** 2026-07-19
**Status:** Accepted, hardware verification pending

### Context

A fill that burned cleanly on the Falcon produced uneven script letters on the 4040. The attached
4040 job was 112.013 x 111.8 mm; the clean Falcon job was 62.472 x 62.4 mm. At the larger scale,
letter gaps crossed ADR-035's fixed 5 mm sweep-split threshold. The script area rose from 2.88 to
6.88 sweeps per row, and 75.6% of those sweeps had no runway under ADR-033's short-sweep rule.

The exact J row entered a standalone 2.352 mm sweep immediately after a 9.605 mm G0. The exact C
rows had equivalent 6.683 and 7.048 mm boundaries. A second defect existed nearby: symmetric
runways on both sides of split sweeps overlapped at 60 boundaries, creating 120 collinear
180-degree reversals, 194.643 mm of reverse excursion, and 389.286 mm of excess commanded path.

Globally raising the 5 mm split threshold would reconnect the J/C rows, but it would weaken the
hardware-motivated blank-feed cap from ADR-035. Giving every fragment two full runways would create
more overlap and backtracking. Row-outer-only runways would leave the internal J/C G0-to-burn
transitions untouched, especially on alternating reverse rows.

### Decision

1. Ordinary scanline Fill compiled for the `neotronics-4040-safe` dialect carries a
   `feed-matched-entry` runway policy. Default/Falcon-compatible motion bodies remain
   byte-compatible; exported metadata intentionally advances to the new emitter revision. Offset
   Fill and Island Fill keep their existing policies.
2. ADR-035's 5 mm split threshold remains unchanged. At every internal split, the preceding sweep
   owns no trailing runway. The next sweep starts with G0/S0 over the gap remainder, followed by up
   to `min(configured overscan, 5 mm)` of monotonic `G1 F<fill feed> S0` before laser-on motion.
3. The first sweep on a scanline receives the same feed-matched entry. Only the final sweep receives
   a feed-matched exit. Short sweeps do not lose these bounded runways under ADR-033.
4. Emission, duration planning, preview geometry, and motion bounds consume one shared sweep plan.
   Export provenance advances to `adr-234-4040-fill-entry-v1`.

### Consequences

- J 9.605 mm becomes G0 for 4.605 mm, then G1/S0 for 5 mm before burn. C 6.683 and 7.048 mm become
  G0 for 1.683 and 2.048 mm, then the same 5 mm feed entry.
- Internal runways are monotonic and cannot overlap or reverse. Every blank G1 remains at or below
  the existing 5 mm preflight threshold; wider gaps still contain a hard-off G0 portion.
- The bad file's motion audit estimates roughly three additional ideal minutes versus all-rapid
  split entries. This is a deliberate quality trade for the 4040 profile, not a global fill change.
- Software tests cannot prove the physical burn. A same-material 4040 A/B coupon is still required
  to assess the J/C edge quality and to separate motion effects from scan offset, belt/backlash,
  focus, optics, and material variation.

### Verification

- Exact J and C fixtures assert the G0 remainder, 5 mm G1/S0 entry, unchanged powered coordinates,
  no long blank feed, and laser-off rapid invariants.
- A property test covers arbitrary split gaps and proves monotonic non-overlapping entry geometry.
- Generic/Falcon emitter tests remain byte-identical, while planner, preview, and motion-bounds
  tests assert parity with the emitted 4040 runway geometry.

---

## ADR-235 - New laser traces default to materialized Raster/Image output

**Date:** 2026-07-19
**Status:** Accepted, hardware verification pending

### Context

The same 4040 produced a clean direct-photo engraving but uneven lettering after the photo was
traced. These are different output paths: an imported photo is a `RasterImage` compiled into image
scan rows, while Trace historically committed a `TracedImage` compiled as vector Fill or Line.
Changing only a traced object's layer mode to Image is not a solution: the vector compiler skips
Image layers and the raster compiler accepts only real `RasterImage` objects, so that combination
would emit no artwork.

The raster emitter can still split long white gaps, but every active span receives its normal
laser-off feed runway. That is the motion property wanted for sparse traced lettering. Rasterizing
a trace cannot restore grayscale or detail the trace algorithm already discarded; it preserves the
selected silhouette, centerline, or edge result and changes its downstream engraving pipeline.

A second correctness issue existed at this boundary. Burn imports may retain a larger pixel grid
than Trace's bounded working grid. Trace placement used the burn bitmap dimensions as the divisor,
so a large source traced on the smaller grid could be committed at the wrong physical size.

### Decision

1. The laser Trace dialog exposes an explicit output choice. **Raster scan** is the default and
   recommended engraving output; **Vector paths** preserves the editable Fill/Line workflow. CNC
   remains vector-only because the CNC compiler has no raster-image machining contract.
2. Raster output materializes a real `RasterImage` during trace acceptance by reusing the existing
   bounded Convert-to-Bitmap worker and luma/PNG assembly. Filled-contour traces use Fill All;
   centerline and edge traces use Outlines. Trace ink is black on white. Resolution uses the
   highest density required by every active bound Image operation, and those complete operation
   bindings are snapshotted and revalidated across the asynchronous conversion.
3. The actual trace working width and height travel with every worker, inline, region, preview, and
   prepared result. Placement maps that grid through the live source bounds and transform before
   vector-to-bitmap conversion bakes rotation, mirroring, scale, and translation into the output
   pixels. Boundary selections are remapped from the retained burn grid to the capped trace grid.
   The live source and complete Image-operation set are revalidated after conversion.
4. Commit is atomic and records one undo entry. The original image is either retained as the
   excluded `trace-source` backing or removed by the existing delete toggle; re-trace replaces the
   prior result in place so stacking, artwork order, and group references remain stable. Raster
   trace provenance round-trips so **Re-trace Original** still works while the backing source
   exists. Budget or conversion failure makes no scene change.
5. No compiler or G-code-emitter special case is added. Once committed, the result follows the
   ordinary Raster/Image Preview, Estimate, Save, Frame, Start, preflight, and emission paths.
   Existing saved vector traces are not migrated silently; imported SVG, Text, Shape, ordinary
   Line/Fill, and direct-photo jobs keep their established behavior.
6. Binary trace appearance takes precedence over a source photo's Negative Image setting: the
   derived result forces `negativeImage: false` so black preview ink burns and white stays off.
   Pass Through uses the trace working-grid density; if preserving that grid would exceed the
   supported 25 lines/mm conversion ceiling, acceptance fails without mutation and directs the
   operator to disable Pass Through, resize, or choose Editable vectors.

### Consequences

- New laser traces use raster scan motion by default across all letters and traced artwork, rather
  than applying a glyph-specific J/C workaround.
- Direct photographs remain the highest-fidelity choice for tonal images. A rasterized trace is
  still binary silhouette/line art and must not be described as restored photographic grayscale.
- The same Image settings that produced a good direct-photo burn carry into the derived trace
  output except Negative Image, which is neutralized for trace-preview parity. Material, focus,
  mechanics, and the physical 4040 result still require a controlled scrap qualification.

### Verification

- Trace-result tests pin the real working grid through worker, inline, crop, enhance, preview, and
  prepared-result reuse.
- Registration tests cover a burn source larger than the trace grid, high-resolution crop/enhance
  boundaries, and rotated/mirrored/non-uniformly-scaled sources.
- State tests cover retained/deleted backing images, replacement, provenance, layer settings, and
  one-step undo, stable Re-trace ordering, Negative Image neutralization, and active sublayers.
- Workflow tests cover laser Raster default, Vector escape, centerline/edge outline rendering, CNC
  exclusion, Pass Through refusal, and one-dimensional outline rasterization. A 4040-profile
  acceptance test proves raster-only compilation and `M4 S0` -> feed-speed `S0` runway -> powered
  burn ordering.

## ADR-236 - Profile-scoped 4040 scan quality hardening

**Date:** 2026-07-19
**Status:** Accepted, hardware verification pending (controller-setting policy remains governed by
ADR-232)

### Context

Falcon output remained clean while physical Neotronics 4040 burns regressed, but source inspection
cannot prove which electrical, optical, mechanical, material, firmware, or motion interaction caused
the observed marks. The code did expose avoidable output-quality risks for the built-in 4040 profile:
requested bidirectional scanning could run without a measured reverse-line offset, and laser-off
repositioning used unbounded `G0` after ADR-208 removed the earlier profile-specific feed move.
ADR-234 separately established the bounded, non-overlapping entry-runway geometry for ordinary
4040 scanline Fill; this ADR retains that geometry. A final artifact audit also found that
vector points distinct in memory could collapse to one coordinate at three-decimal GRBL precision,
leaving stationary positive-power `G1` commands. The maintainer explicitly directed a profile-scoped
quality policy while preserving generic/Falcon output.

### Decision

- Resolve the effective scan direction during compilation. Scanline Fill and Image operations
  requested as bidirectional compile one-way on the built-in `neotronics-4040-safe` profile when its
  scanning-offset table is empty. A populated calibration table enables bidirectional output, and a
  persisted per-operation expert override may knowingly bypass that fallback. Sensitive 4040 Island
  Fill remains one-way regardless of calibration or expert override; its existing motion invariant is
  stronger than the new normal-scan allowance. Calibration coupons may set the override and an
  explicit test offset so the reverse direction can be measured outside sensitive Island Fill.
- Record the effective direction and its reason on compiled Fill/Raster groups. Job Review exposes
  that fact so an operator can distinguish a requested one-way operation, calibrated
  bidirectional output, expert override, and an uncalibrated 4040 fallback.
- Keep ADR-234's `feed-matched-entry` policy and shared sweep planner as the sole authority for
  ordinary 4040 scanline Fill. Sensitive Island Fill uses a distinct full-feed policy: exterior
  runways receive the configured length, internal split sweeps omit the preceding exit and clamp the
  next entry to the available gap so motion cannot reverse over the previous sweep. Raster duration
  modeling retains its distinct two-sided full-runway mode because it mirrors executable raster
  bytes. Bounds, path optimization, toolpath preview, duration planning, emission, and heat/runway
  analysis all consume the same planned geometry.
- Emit feed-matched 4040 Fill/Island runways as laser-off `G1 S0` motion at the burn feed. Report
  exact pass-weighted full, partial, skipped, and explicitly-disabled entry-runway coverage plus
  requested values in Job Review.
- Add an optional profile capability, `controlledLaserOffTravelFeedMmPerMin`. The built-in 4040 sets
  it to 800 mm/min, so vector and raster laser-off seeks emit explicit `G1 ... F800 S0`; profiles
  that omit it continue to emit their existing `G0` seeks. Raster restores the burn feed after each
  controlled seek, and duration planning prices these moves at the configured feed. Any positive
  sub-1 programmatic value serializes as the controller's minimum integral `F1` instead of rounding
  to invalid `F0`; the original value remains visible as a Job Review policy warning.
- For the 4040 only, the controlled seek supersedes ADR-208's global `G0` transport and ADR-234's
  historical `G0` wording without changing ADR-234's split geometry: the blank-gap remainder runs at
  F800/S0 and the bounded entry runs at the fill feed/S0. Other profiles retain `G0` behavior.
- At the shared GRBL vector-emitter boundary, compare formatted three-decimal coordinates and omit
  any target that does not move the machine. If an entire segment collapses, omit its laser-off seek
  too; if only a prefix collapses, attach feed and power to the first real move. This matches the
  existing Fill/CNC guards and prevents stationary positive-power vector commands on every profile.
- Mark generated controlled seeks/runways for diagnostics, but do not trust the comment alone.
  Preflight recognizes a marked laser-off `G1` only when its explicit feed matches the active
  profile's controlled-seek feed or its distance fits the job's configured overscan envelope. A
  forged marker on arbitrary blank-feed motion remains reportable. Under ADR-228 this is review
  evidence, not a new Start refusal.
- Treat finite per-operation scan offsets beyond the profile's conservative magnitude cap, and
  finite controlled-seek feeds outside the profile range, as post-emit Job Review warnings. They
  remain loadable and compilable so the exact physical Frame stays authoritative. Non-finite scan
  offsets and non-finite or non-positive controlled feeds remain pre-emit failures because no valid
  controller program can be constructed. Device calibration tables keep their stricter input-time
  validation; this warning policy applies to job operation overrides, not claimed calibration data.
- Keep current `$30` and `$32` findings as Job Review advisories under governing ADR-232; known,
  unknown, stale, or unavailable values never refuse Frame or Start. When the exact executable
  program contains `M7` and a current stock-GRBL `$I` response proves option `M` is absent, refuse
  laser or CNC preparation as factual command incompatibility: that controller cannot execute the
  reviewed program. Re-evaluate that exact command against current build evidence after queue
  fencing; observation or session drift alone is not incompatibility. Missing, stale, unavailable,
  or non-stock `$I` evidence remains a Job Review acknowledgement, and no unrelated ADR-228 warning
  becomes a refusal.
- Compute Print-and-Cut/registration warnings from the prepared output-scoped project, not the
  unscoped source scene. Selecting only artwork or only the registration box therefore cannot inherit
  a false warning that both will burn in the same pass.
- Export provenance advances to `adr-235-4040-quality-controlled-v2` because the combined controller
  program differs from ADR-234 even though its non-overlapping split geometry remains governing.

### Consequences

The 4040 now favors repeatable motion and aligned scan direction over minimum runtime. Bounded
scanline entries and full-where-safe Island runways increase travel for fragmented art, and one-way
scanning can approach twice the scan time; those costs are intentional and visible in the same
planner used for ETA. Generic and Falcon profiles retain legacy direction, runway, and `G0` behavior
unless explicitly configured otherwise.
Their ordinary vector bytes also remain unchanged; only paths with points equal at controller
precision lose non-moving commands.

This change establishes code-level output semantics and regression coverage only. It does not prove
the cause of an existing bad burn, certify 4040 hardware, or establish that the resulting physical
mark is acceptable. Material coupons and controlled A/B burns are still required to distinguish
software improvement from focus, optics, mechanics, power delivery, firmware, and material effects.

## ADR-237 - Job Review runs at Start; plain Frame is dialog-free

**Date:** 2026-07-21
**Status:** Accepted (amends ADR-230's review sequencing; the frame-first contract of ADR-228/ADR-232 is unchanged)

### Context

ADR-230 placed the single Job Review before the physical Frame: Frame prepared the exact artifact,
opened the review dialog ("Accept & Frame"), traced only after confirmation, and Start later
claimed the permit without any dialog. In practice the operator frequently frames just to see the
physical envelope — and the maintainer directed (2026-07-21, in chat) that the full pre-check
dialog must not interrupt an ordinary Frame: "It should only be at the main button."

### Decision

- A plain Frame (Frame button, or Start pressed with no live permit) runs dialog-free:
  prepare → owned G54 selection → physical trace → **review-pending permit**. The candidate
  carries the exact prepared artifact, the preparation warnings, and the durable G54
  normalization disclosure, but no review evidence.
- Pressing **Start** on a review-pending permit opens the one Job Review (purpose `start`,
  confirm button **Start job**) built from the permit's exact artifact plus live controller
  state. Confirming produces the same review evidence and acknowledgement/attestation objects
  as before, then claims the permit and streams. Cancelling streams nothing and keeps the
  permit armed.
- Exact-artifact backstops: if the permit dies while the review is open (any ADR-230/232
  invalidation), Start streams nothing and says so; if an in-review edit re-prepares to a
  different execution signature, the permit is voided and the operator Frames again.
- Transient camera-marker Frames keep their review-before-dispatch shape: their candidates are
  born with review evidence and stream without reopening the dialog.

### Consequences

- The operator sees exactly one dialog per burn, at the moment of commitment (Start), matching
  the maintainer's model of Frame as a lightweight physical check.
- Policy findings (bed bounds, no-go zones, controller settings) surface at Start instead of
  before the trace. The tool-off Frame trace itself therefore runs without a prior warning
  surface — the physical trace is the disclosure, per ADR-232's source-of-truth ruling.
- Evidence binding is tighter, not looser: acknowledgements and attestations are produced
  seconds before streaming instead of before the trace.
- The Job Review `frame` purpose ("Accept & Frame" copy) has no production caller after this
  change; it is retained for now and may be removed in a follow-up.

---

## ADR-238 - Laser trace output defaults to editable vectors; raster scan remains selectable

**Date:** 2026-07-21
**Status:** Accepted

### Context

ADR-235 made **Raster scan** the default laser trace output because the 4040's traced-lettering
burn was uneven through the vector Fill pipeline while direct photo engraving was clean. A full
code audit of that incident (2026-07-21) confirmed the mechanism at the byte level: the pre-#299
fill emitter gave 75.6% of the bad job's sweeps no runway at all (ADR-033 skips overscan on burns
shorter than 2x the setting), so hundreds of powered sweeps started from rest after a `G0`, while
every raster ink entry always received an unconditional 5 mm feed-matched `S0` runway.

That vector-side hole has since been closed for the machine that exhibited it: ADR-234's
`feed-matched-entry` policy gives every 4040-safe fill sweep a bounded `G1 F<feed> S0` entry
runway with no short-run skip on that path, and ADR-236 adds controlled laser-off seeks and the
uncalibrated one-way scan fallback. With the motion defect addressed at its source, the default
can return to the reference behavior: LightBurn's Trace Image produces editable vector paths.
Editable vectors are also the more capable result (node editing, fill-style choice, resolution
independence at any later density).

The maintainer directed this default on 2026-07-21.

### Decision

1. The laser Trace dialog defaults to **Editable vectors**. **Raster scan** remains selectable
   and unchanged; the option list orders the default first and drops the "(recommended)" tag.
2. This supersedes only ADR-235 decision 1's choice of default. Everything else in ADR-235
   remains governing: the raster materialization machinery, registration through the trace
   working grid, Image-operation binding and revalidation, Pass Through handling, provenance,
   atomic commit, and CNC remaining vector-only.
3. The defensive select parser falls back to `vector`, matching the commit layer's existing
   `traceOutput ?? 'vector'` fallback, so an omitted or unrecognized value now degrades to the
   default rather than to the opposite pipeline.

### Consequences

- New laser traces commit as editable Fill/Line vectors by default, matching LightBurn. On the
  4040-safe dialect they engrave through ADR-234's feed-matched entry runways; that geometry is
  structurally pinned by tests but its physical burn quality remains hardware-verification
  pending, exactly as ADR-234 states.
- Profiles that are not on the 4040-safe dialect keep ADR-234's deliberately-preserved legacy
  fill motion (including the ADR-033 short-run overscan skip). The existing conditional
  advisories for a suspected 4040 on a generic profile are the sanctioned mitigation; this ADR
  does not widen any policy or add any guard.
- Operators who prefer the photo-parity scan motion — the pipeline the maintainer physically
  verified as clean — pick Raster scan in the dialog; nothing about that path changes.

### Verification

- Workflow tests updated: laser default is `vector` with the raster escape present; Fill Style
  appears immediately for filled-contour presets under the vector default and hides under
  Raster scan; CNC tracing remains vector-only with no output picker.
- No compiler, emitter, or G-code change: the diff is dialog state, option labels/order, the
  select parser fallback, and these tests.

## ADR-239 - Machine Setup: capability-first six-step wizard with a searchable catalog

**Date:** 2026-07-21 (amended same day after the maintainer reviewed the built wizard in chat)
**Status:** Accepted (amends ADR-205's step composition and ADR-186's step enumeration; ADR-092's
guided-steps and draft-commit decisions, ADR-210's capability contract, and the firmware write
policy are unchanged)

### Context

Maintainer direction (2026-07-21, in chat, with screenshots): Machine Setup is still too
complicated — finding the machine profile is hard, and the settings are scattered across steps and
collapsible menus. Redesign it so all necessary settings are chosen without hunting, and lose no
settings.

The audit of the current surface found the structural causes:

- Seven steps, but only about ten of the ~70 controls are required to save; the rest are optional
  calibrations spread across four steps.
- The profile catalog — which fills nearly every later field in one click — is a **collapsed**
  `<details>` on step 1, rendered *below* controller/baud/dialect fields, with no search.
- The suggester's computed `reasons`/`warnings` strings are never rendered, so even a
  detection-matched card explains nothing; on a first run (no prior connection) every card shows
  "Manual choice" with no way to tell the profiles apart beyond their names.
- Optional calibrations are nested `<details>` (planner estimator tuning sits two collapse levels
  deep) with no visible state, so the operator must open each one to learn whether it needs
  attention.

### Decision

1. **Capability first, profile second** (maintainer-ordered, 2026-07-21 review). Step 1 asks only
   what the machine is — Laser / CNC / Laser + CNC and, for hybrids, the active mode. Step 2 holds
   the reviewed-profile catalog for laser-capable machines, always-open at the top with a text
   filter (name, controller, bed size) — a CNC-only capability sees the built-in CNC preset
   instead — followed by the CNC preset, controller/baud/dialect, advanced streaming, and
   import/export. Picking a card still applies the whole profile verbatim through `apply-preset`.
2. **Visible suggestions.** Cards render the suggester's `reasons` and `warnings` (previously
   computed and dropped), so a detection match says why it matches, and detection-matched profiles
   keep sorting first. The `suggested` tier stays unreachable **by design**: generic `$$` values
   must not claim hardware identity (pinned by `profile-suggestions.test.ts`); the tier remains
   reserved for future distinctive evidence. Detection still never applies anything by itself
   (ADR-205 unchanged).
3. **Six steps.** `capability` (Machine type) → `identify` (Choose your machine) → `connect`
   (Connect & detect — the connect/read/use-detected surface on its own page, per the maintainer)
   → `confirm` (Confirm settings: name/bed/feeds/origin/homing plus laser and/or CNC output,
   stacked flat on one scrollable page) → `options` (Options & calibration) → `review` (firmware
   compare/queue followed by the review cards and hardware handoff). The step components
   themselves are reused; the wizard stacks them.
4. **Options as closed status rows.** Every optional group — no-go zones, Z axis and probe,
   planner/ETA, plus the laser-only scan offset + controlled seek, auto-focus, rotary, and camera
   groups (hidden for CNC-only machines, as before) — is **collapsed by default** (maintainer
   direction) and shows a live one-line status in its always-visible summary row, and no group
   nests another collapsible. The operator reads the whole machine state without opening anything.
5. **Gates move, none widen.** Next gates on the same `machineSetupValidationIssues` only on the
   pages that host fields (`identify`, `confirm`, `options`); `capability` and `connect` always
   advance so Next never strands the operator away from a fix. Firmware queueing keeps its read +
   backup + per-setting confirm + transport preconditions; Save remains the single atomic commit
   followed by verified queued writes. No new confirmation, block, or refusal is introduced
   (rule 7 / ADR-228 untouched).
6. The auto-focus deep-link from Job Controls targets the `options` step and explicitly opens the
   auto-focus section (an `highlight` open-request field), since no section opens by default.
7. **The connected-4040 fill-policy rail banner is removed** (maintainer direction, 2026-07-21).
   The rail keeps only the neutral "This machine isn't set up yet" nudge; 4040 fill-policy
   selection remains available through the catalog, and the Job Review warning path is untouched.

### Consequences

- Step ids `machine`, `safety`, and `firmware` disappear from `DeviceSetupStep`; `capability`,
  `options` are added and `confirm` is the merged coordinates+output page. The only production
  deep-link (auto-focus) moves to `options` + `highlight`.
- The Machine Setup rail button loses its 4040-advisory primary emphasis; only the unconfigured
  nudge still promotes it.
- WORKFLOW.md F-C7 is rewritten to the six-step enumeration; ADR-186's laser/CNC visible-step
  variance was already dead in code (fixed seven-step order) and is superseded by this shape.
- e2e and component tests pinning the seven-step layout, the collapsed-catalog summary text, and
  step-title strings are updated in the same change; the stale
  `production-workflows.spec.ts` locators ("Optional: start from a tested machine profile", the
  removed "Firmware mismatch" card state) are corrected as part of this work.
- The CNC rail's live duplicates (Material & Bit machine params, detected-settings Apply) and the
  dead standalone editors (`DeviceSettings.tsx` and siblings) are out of scope here; folding or
  deleting them stays a separate refactor decision.
