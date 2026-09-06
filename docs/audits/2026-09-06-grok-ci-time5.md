# Grok pipelines-CI and TIME5 audit, 2026-09-06

Grok's supplied baseline is `5918ef53fd91f6b33a4cd0766f2a3b7ba6991acc`. This audit and
initial remediation use main `c07cea275149832909d46f21c4dd7ec74d634f4a` on the isolated
branch `codex/grok-ci-time5-20260906`. The intervening change is the CNC spindle-review
correction in PR #751; it does not resolve these timing or pipeline findings.

The supplied pack contains 20 distinct findings. Pipeline identifiers below mean the
Wave 1 `pipelines-CI-*` findings, not the August merge-state finding with the same old ID.
Timing identifiers are `KD-TIME5-*`. Rotation and other wave names appear only in handoff
chatter: no additional findings were supplied for those topics.

This records local implementation evidence for fix commit `8a7794c10`. For integration, the branch
now also contains the earlier Grok pack from `97f3f1832` / PR #752, preserving its fix commit `5edcd78c4`.
The user subsequently authorized merging both PRs after verification. Frame remains the sole
ordinary Start policy gate; no machine operation or controller-setting write was added.

## Timing findings

| Finding | Adjudication and code evidence | Result |
|---|---|---|
| KD-TIME5-01 | Confirmed for controlled vector and Fill seeks. `planner.ts` passed the configured seek feed to `appendTravel`, which marked the block rapid; `grbl-strategy.ts::laserOffSeekLine` emits G1 for that configuration. `junction.ts` stops at rapid/feed boundaries. Raster already handled controlled seeks as feed. | Use the emitted seek motion kind, retain real spindle/coolant/re-arm stops, and keep CNC seeks rapid. |
| KD-TIME5-02 | Confirmed. `estimate-duration.ts` used the two saved time scales; `canvas-job-timing-plan.ts` passed only acceleration, junction deviation, and maximum feed into the emitted-program clock. | Carry calibrated cut/travel motion time through segment, line, route, live badge, Start, resume, and recovery timing. Deterministic dwell is unscaled. |
| KD-TIME5-03 | Confirmed rounding defect. `formatDuration` split the unrounded value, then rounded the seconds remainder. | Round once before decomposition, so carries work across minutes and hours. |
| KD-TIME5-04 | Confirmed. `cnc-grbl-transitions.ts::appendSpindleStart` emits a represented G4 duration; the old job estimate added only motion and analytic Z terms. | Count initial starts, RPM restarts, and tool-change restarts using the same transition decision as output. Add a separate unscaled dwell subtotal and preserve the corresponding motion stops. |
| KD-TIME5-05 | True, but previously an intentional compact display, not a missing modeled duration. The same formatter also displays elapsed time. | Retain seconds after an hour as a small useful display improvement. |
| KD-TIME5-06 | Confirmed category error. The old `cncPlungeSeconds` added both plunge and rapid retract time into the cut subtotal, applying the cut factor to both. | Keep plunge in cut and retract in rapid travel, with the respective factors. CNC Job Review labels the cut subtotal “Cut + plunge”; spindle dwell is separate. |
| KD-TIME5-07 | Partly false as phrased. `PlannerFields` invokes profile callbacks, not a controller writer, but acceleration also informs reviewed CNC recovery runways through `cnc-supervised-recovery-flow.ts`. Its old tooltips described physical cornering/shake as though editing them changed controller settings. | Clarify local profile references and the recovery-runway use. Do not introduce firmware writes or claim these values affect estimates only. |
| KD-TIME5-08 | The stated G0 approximation is real and documented: `motion-limits.ts` and `segment-blocks.ts` use one configured scalar maximum feed. This is not evidence of a particular controller's actual axis rates. | Retain the documented approximation. No invented $110/$111 values or hardware-calibration claims. |

Independent reproductions at the unchanged baseline:

- Ten short, collinear controlled laser seeks/cuts: **4.000000 s** from the old job estimator,
  **2.100000 s** from the emitted program. This is a deliberately sensitive fixture, not a
  claim that every job has a 90% error.
- A 100 mm laser cut with 10 mm outbound and 110 mm return travel, cut factor 2 and travel
  factor 3: **24.219999995 s** before Start versus **11.410000280 s** in the old live
  handoff. The live result was identical to its uncalibrated result; emitted bytes were unchanged.
- Changing CNC spin-up from zero to 3.4567 emits `G4 P3.457`. Parsed program time gains
  **3.457 s**; the old pre-run estimate gains **0 s**.
- Formatter regressions produced `60s`, `1m 60s`, `59m 60s`, and hour values without
  their remaining seconds. Six regression cases failed before the formatter correction.

The old formatter's order made the carry defect visible directly:

```ts
const hours = Math.floor(safe / 3600);
const minutes = Math.floor((safe % 3600) / 60);
const seconds = Math.round(safe % 60);
if (hours > 0) return `${hours}h ${minutes}m`;
```

The corrected formatter rounds `safe` first and includes seconds in every branch.

### Where to review the timing fixes in code

- [Seek classification in planner.ts:127](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/core/job/planner.ts:127)
  now selects feed or rapid motion. Previously, the configured seek feed still went through
  `appendTravel`, whose block had `motion: 'rapid'`. The
  [emitted-program regression:55](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/core/job/planner-emitted-seek-parity.test.ts:55)
  compares the generated G1 program with the independently calculated 2.1-second result.
- [Live timing handoff:78](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/ui/state/canvas-job-timing-plan.ts:78)
  now passes `timeCalibration` and the job's machine kind. Previously, its options contained
  only `maxSegments`. [Motion clock scaling:81](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/core/gcode-time/program-time.ts:81)
  applies the factors, and the [badge handoff regression:80](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/ui/laser/LiveJobTimeBadge.calibration.test.tsx:80)
  checks that calibration survives the switch from pre-run to live timing without changing G-code.
- [Duration accounting:70](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/core/job/estimate-duration.ts:70)
  separates plunge, retract, and dwell. [CNC overhead:13](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/core/job/cnc-duration-overhead.ts:13)
  uses the shared spindle-transition decision and the same decimal representation as emitted G4.
  [Job Review:204](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/ui/laser/job-review/job-review-model.ts:204)
  and [Preview:136](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/ui/workspace/preview-overlays.tsx:136)
  expose the resulting categories.
- [Duration formatter:295](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/core/job/estimate-duration.ts:295)
  fixes the rounding order shown above. [Planner field explanations:58](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/src/ui/laser/PlannerAdvanced.tsx:58)
  describe the existing local-profile behavior and CNC recovery use accurately.

### Additional timing defects found during verification

`TIME5-08a` is our finding, not a confirmation of Grok's rapid-speed complaint.
`segment-blocks.ts::feedMmPerSec` imposed `Math.max(1, ...)` on already parsed feed words,
although output preserves positive feeds below 1 mm/min. Actual emitted F0.5 and F1
programs both received **6001.400000051 s** from the old countdown in the probe, while the
F0.5 pre-run estimate was **12001.400008331 s**. Remove that false minimum for valid positive
feeds, retaining the existing missing-feed fallback and configured maximum model.

Calibration tests also distinguish laser-off G1 from powered cuts. The viewer's geometric
“cut” classification alone is insufficient for this purpose. Known laser/CNC job identity
travels with the timing request, so an S0 laser seek receives travel calibration while a
CNC plunge retains cut calibration. Physical kinematics remain unchanged; partial route
progress scales its elapsed segment time, rather than changing velocity or acceleration.

Independent review also caught motion blending across a CNC RPM restart. With two collinear
1 mm cuts, F6000, acceleration 100 mm/s², zero Z travel, and two 3-second spindle dwells,
the intermediate estimate was **6.282842712 s** versus **6.4 s** from the emitted program.
The restart now also terminates the preceding motion block, giving **6.4 s**. A same-RPM
control retains continuity; an empty group carrying a real spindle transition still carries
the stop. This corrects the estimate, without changing emitted spindle commands.

## Pipeline findings

The [detailed pipeline audit](2026-09-06-grok-pipelines-audit.md) gives the code lines,
before/after reproducers, policy evidence, and result for every pipeline claim.

| Finding | Verdict and result |
|---|---|
| pipelines-CI-01 | Correct operational caveat: source does not prove stable activation. Current protected-environment/secrets state was not inspected. No activation or source change. |
| pipelines-CI-02 | Intentional obsolete-candidate no-op, with an explicit existing summary. An early skip lacks a readiness artifact; a green workflow alone does not prove publication. No new failure or stale-candidate code execution. |
| pipelines-CI-03 | Narrow repair: preserve observed `skipped`/`cancelled` outcomes and explicitly label the report as this workflow's evidence, not an aggregate verdict for its SHA. |
| pipelines-CI-04 | Fix the reproduced scanner-error defect, including stable's existing audit check. Keep ADR-254's intentional advisory-triage policy. |
| pipelines-CI-05 | Production-shaped metadata inside a labelled, unsigned dry-run artifact is intentional; `--publish never` and the absence of a provider step matter. No change. |
| pipelines-CI-06 | The local package command is unqualified development output. Missing metadata defaults updater trust to false. No proven trust bypass; no change. |
| pipelines-CI-07 | Clarify generated evidence as Windows x64 unsigned Preview `--dir` launch/import/save only. It does not qualify installation, signing, or updater delivery. |
| pipelines-CI-08 | Preview advisory triage and stable's extra runtime check are different documented policies. No invented Preview gate. |
| pipelines-CI-09 | Browser cancellation on main and deploy's independence are explicit choices. Starvation or false browser-success reporting was not demonstrated. No new deployment gate. |
| pipelines-CI-10 | Fix the larger reproduced defect: pnpm's keyed dependency nodes were omitted. Include actual dependency identities, Electron, and known declared licenses; keep unknown legal conclusions as `NOASSERTION`. |
| pipelines-CI-11 | `&&` is fail-fast: a failure makes the command fail and later checks remain unrun. No false pass was demonstrated; no change. |
| pipelines-CI-12 | Unsupported: final verification downloads published assets into a separate directory and checks their own published manifest/attestations. It does not compare a fresh rebuild against old immutable binary bytes. No change. |

The two substantive pipeline reproductions are independently observable:

- pnpm's real failed-scanner payload `{"error":{"code":"pnpm","message":"fetch failed"}}`
  was converted into zero advisories by `advisories ?? {}`. It now creates invalid evidence,
  retains unknown counts, fails the reporting command, and cannot close the standing issue as clean.
- The real full-depth pnpm inventory contained the project plus 58 production identities, but
  the old stable SBOM contained only the project. The corrected output has **60 packages**,
  including Electron, and **60 declared license facts**. This is npm/runtime inventory evidence,
  not a file-level inventory of every Chromium/native component.

## Verification and limits

Fresh full-repository `pnpm test` on the frozen timing-pack source at `8a7794c10` passed **12,348 tests**, with
**22 skipped** and **zero failures**, across **1,929 passed files / 14 skipped files**.
The skipped cases are the existing opt-in perceptual audit/probe fixtures.

The final affected-area run passed **1,044 tests across 162 files**. It covered the job
planner, G-code clocks, motion planner, output emitters, Job Review, Preview statistics,
live badge handoff, and timing state. This run includes the final CNC restart-stop correction.
SHA-256 hashes of all 44 timing-pack source/test/workflow files were unchanged through that run.
The same source hashes remained unchanged through the fresh full run. An earlier aggregate
run overlapped the CNC restart correction and observed its two failing regression cases;
`full-tests.log` retains that result. The successful frozen-source rerun is recorded separately
in `full-tests-final.log`, and is the full-suite result reported here.

Other completed checks:

- Release-integrity scripts: **49/49 tests**. The **13** directly affected script tests are
  included in that count, not additional tests.
- Stable and Preview workflow contracts: **29/29 tests** across two files.
- `pnpm lint`, TypeScript compilation through `pnpm build:web`, `pnpm typecheck:e2e`, and
  the web production build passed. Vite retained its large-chunk warning.
- Whole-repository formatting passed before the final review adjustments; a focused check
  of all seven subsequent source/test changes also passed. Markdown is intentionally ignored
  by this repository's Prettier configuration. `git diff --check` passed.
- File-size policy, index-export limits, and GitHub action pins passed.
- The Chrome project-open/calibration/Preview/save flow passed **1/1 test**, with no collected page or
  console errors and no serial-operation events. This browser run preceded the final CNC
  restart correction and Preview's reuse of the shared duration formatter; the final
  affected-area tests cover those subsequent changes. The saved screenshot was inspected.

Detailed local logs and probe results are in
`C:/Users/Asus/.codex/audits/grok-ci-time5-20260906`. At the preservation checkpoint, the
original checkout's HEAD, status, and 15 fingerprinted source/instruction files were unchanged.
The previous fix worktree was clean at `5edcd78c4a0efe07c75de6b344306274f63285d6` before the
later repository-wide request to publish completed work. That earlier pack has
[PR #752](https://github.com/cisgz3a-hub/KerfDesk/pull/752), preserving the fix commit and
integrating main at `97f3f183296e332f2b67cb5e003356ccf22c2291`. It is now the integration base for PR #755.
Live `origin/main` was still `c07cea275149832909d46f21c4dd7ec74d634f4a` at the remote check.

Software ETA parity does not qualify controller acceleration, per-axis rapid limits, buffering, overrides, manual
tool-change time, spindle-at-speed behavior, or material results. CNC Z overhead retains
the existing analytic distance model; this patch corrects its categories and dwell accounting.
Preview route playback remains a motion animation and discloses the separate spindle dwell.

Hosted PR checks are recorded on the pull request separately from this local verification.
No deployment, installer, signing, updater, reference-CAM, or hardware run was performed.
Building or testing the release evidence scripts does not activate the stable desktop release channel.

## Combined integration for main

PR #755 is prepared after PR #752, combining timing fix `8a7794c10` with the earlier pack at
`97f3f1832`. The only manual merge conflict was the audit ledger; both entries were retained.
WORKFLOW.md and the production browser test file merged automatically. An independent review
confirmed that every other application/source blob remained identical to its owning fix pack,
including power-mode resolution, emitted timing boundaries, and MPG pause/settlement behavior.

The combined checkout passed **82 tests across eight suites** for artwork overrides and
save/load, settings approval, emitted-seek parity, live timing, MPG recovery and cancellation.
It also passed **2/2 Chrome flows**: project-open/calibration/Preview/save and actual bitmap
import/tracing through the production worker. E2E typechecking and formatting of the combined
test file passed. The full-suite numbers above describe the standalone timing commit; hosted
checks on the combined PR head provide the aggregate integration result. The user authorized
merging both PRs after verification; PR and main check records establish the final merge state.
