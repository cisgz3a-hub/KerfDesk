# Rule-7 refusal inventory — `src/core/preflight/` and the controller-setting write path

**Date:** 2026-07-27 · **Scope:** every refusal in `src/core/preflight/`, every consumer that turns a
preflight result into a refusal, and the whole `$`-setting write path.
**Disposition: report only.** No refusal was added, removed, or narrowed by this audit.

---

## Headline

**Violations on the Frame/Start surface: 0.**
**Violations elsewhere: 3 sites — all on the Save/export and recovery-preview paths.**
**Refusals that meet rule 7's literal guard definition but are recorded as known-and-accepted in
`docs/audits/2026-07-18-guard-inventory-frame-first.md` §5 (non-Start console/settings): 11 sites.**

**The single most important decision for the maintainer:**

> `src/ui/app/confirm-controller-readiness.ts:21-25` gates **Save / export G-code** behind a
> `$30`/`$32` confirmation dialog. This is the last live remnant of the controller-setting policy
> that ADR-228 removed from Start. Decide whether the frame-first rule extends to the Save path —
> rule 7's guard definition names "save … export … G-code emission" explicitly, so on the text of
> the rule it does. This file predates ADR-228 (last touched `085e90fa`, 2026-07-11) and the
> 2026-07-18 inventory never listed it, so it was never consciously kept — it was simply missed.

### The premise in the brief is false for Start — verified

The brief states that `src/core/preflight/controller-readiness.ts` **blocks Start** on controller
settings. **It does not, and has not since 2026-07-19.** Traced end to end:

| Step | Location | What happens |
|---|---|---|
| 1 | `src/ui/laser/start-job-readiness.ts:306` | `runControllerReadiness(...)` runs on the Start path |
| 2 | `src/ui/laser/start-job-controller-policy.ts:28` | `...controller.errors.map((issue) => issue.message)` → **`advisories`** |
| 3 | `src/ui/laser/start-job-readiness.ts:334` | `...controllerPolicy.advisories` joins the `warnings` array |
| 4 | `src/ui/laser/job-review/job-review-model.ts:76` | `...args.prepared.warnings` → `model.warnings` |
| 5 | `src/ui/laser/job-review/JobReviewDialog.tsx:59` | `<JobReviewWarnings warnings={model.warnings} />` |

`finalizeStartPreparation` (`start-job-readiness.ts:269-351`) never returns `ok:false` from the
`controller` result. A reported `$32=0` on a laser, `$32=1` on a CNC, a `$30` mismatch and
`controller-settings-unknown` **all reach Job Review as warnings and Start proceeds.** That is
exactly the disposition rows 11/12/13/47 of the 2026-07-18 inventory recorded as DEMOTED.

The demotion was implemented **at the consumer**, not by deleting the errors. `runControllerReadiness`
still returns them in `errors[]`; the Start path deliberately ignores the severity label and reads
them as advisory text.

### The comments the brief quotes are stale — verified by blame

Both comment blocks predate the demotion and were accurate when written:

| Comment | `file:line` | Commit | Date |
|---|---|---|---|
| "a mismatch or a provably wrong `$32` blocks either way" | `controller-readiness.ts:86-88` | `49e938c4` | 2026-07-07 |
| "preserving proven hazard blocks" / "dead Start button" | `controller-readiness.ts:98-100` | `f13110e39` (#284) | 2026-07-17 |
| **the demotion that made both false** | `start-job-controller-policy.ts:28` | `a08f8416` (#291) | **2026-07-19** |

So these are a **documentation defect, not a guard**. They describe the world two days before #291
landed. They are also actively misleading: an agent reading `controller-readiness.ts` in isolation
concludes there is a Start guard where none exists — which is what prompted this audit.

---

## The structural finding: `PreflightResult.ok` is a booby-trap

Nothing in `src/core/preflight/` refuses anything. Every module returns
`PreflightResult = { ok, issues }` (`preflight.ts:85-88`) or a message union. **The refusal decision
lives entirely in the consumers.**

The trap is that `ok` is computed as `issues.length === 0` (`preflight.ts:157`, `pre-emit.ts:26`,
`cnc-preflight.ts:110`, `standalone-cnc-preflight.ts:34`, `compiled-work.ts:94`). It is **not** an
integrity predicate — it is false whenever *any* advisory exists. `PreflightCode` has 30 members
(`preflight.ts:42-78`); only 5 are compile integrity (`blocking-codes.ts:24-32`). So any consumer
reading `.ok` raw refuses on all 30, including `out-of-bed` and `no-go-zone-collision` — the two
things rule 7 names by name as never permitted to refuse.

Eight consumers were deliberately converted to partition against `COMPILE_INTEGRITY_PREFLIGHT_CODES`.
**Two were not.** Both remaining `.ok` readers are the violations below.

| Consumer | `file:line` | Reads | Status |
|---|---|---|---|
| `prepareOutput` | `io/gcode/prepare-output.ts:96-99` | partition | ✅ migrated |
| `partitionEmitPreflight` (Start) | `ui/laser/start-job-readiness-policy.ts:75` | partition | ✅ migrated |
| `partitionSavePreflight` (Save) | `ui/app/save-preflight-policy.ts:22` | partition | ✅ migrated |
| `emitTileFiles` | `ui/app/tile-emission.ts:51-53` | partition | ✅ migrated (comment cites the trap) |
| CNC pass recovery | `ui/laser/cnc-pass-recovery-flow.ts:145` | partition | ✅ migrated (comment cites the trap) |
| CNC supervised recovery | `ui/laser/cnc-supervised-recovery-flow.ts:176` | partition | ✅ migrated (comment cites the trap) |
| **Surfacing save** | **`ui/machine/SurfacingPanel.tsx:121`** | **`!emitted.preflight.ok`** | ❌ **VIOLATION** |
| **Legacy CNC recovery preview** | **`ui/laser/cnc-recovery-preview-model.ts:183`** | **`!emitted.preflight.ok`** | ❌ **VIOLATION (narrow)** |

---

## Full inventory

### 1 · `src/core/preflight/` — zero refusals

| Module | Issue codes produced | Refuses? |
|---|---|---|
| `preflight.ts` | 30-code `PreflightCode` union (`:42-78`) | **NOT-A-REFUSAL** — returns `{ok, issues}` |
| `pre-emit.ts` | `speed-out-of-range`, scan-offset (`:23-25`) | NOT-A-REFUSAL |
| `cnc-preflight.ts` | `no-output-layer`, `cnc-settings-invalid`, `cnc-layer-empty`, `cnc-helix-entry-invalid`, `cnc-rest-machining-invalid`, `cnc-adaptive-clearing-invalid`, `cnc-inlay-invalid`, `out-of-bed`, `non-finite-coordinate`, `no-go-zone-collision`, `plunged-travel`, `empty-output` | NOT-A-REFUSAL |
| `standalone-cnc-preflight.ts` | `cnc-settings-invalid`, `out-of-bed`, `no-go-zone-collision`, `non-finite-coordinate`, `plunged-travel`, `spindle-start-before-clearance`, `empty-output` | NOT-A-REFUSAL *(but see §3.2 — its only consumer refuses on all of them)* |
| `no-go-zones.ts` | collision list; `firstZoneCrossedBySegment` (`:35-45`) feeds the **jog** guard | NOT-A-REFUSAL here; jog surface is inventory §5 UNCHANGED |
| `controller-readiness.ts` | `errors[]` / `warnings[]` (`:37-41`) | NOT-A-REFUSAL — severity label only; see §3.1 for the one consumer that acts on it |
| `layer-mode-preflight.ts`, `scan-offset-policy.ts`, `laser-off-motion-policy.ts`, `relative-motion-envelope.ts`, `cnc-motion-bounds-preflight.ts`, `m7-air-assist-readiness.ts`, `compiled-work.ts` | advisory codes / message unions | NOT-A-REFUSAL |
| `blocking-codes.ts` | the canonical 5 (`:24-32`) | The allowlist itself — correctly scoped |

### 2 · Start / Frame path — all compliant

| # | `file:line` | Condition | Refuses | Class |
|---|---|---|---|---|
| 1 | `start-job-readiness.ts:419-442` | active streamer / motion op / controller op / autofocus / `alarmCode !== null` / no status / not `Idle` | Start | **(a) TRANSPORT** |
| 2 | `start-job-readiness.ts:165,217` | `!placement.ok` — User Origin unset, WCO unknown, no live position | Start | **see note below** |
| 3 | `start-job-readiness.ts:292-294` | `emitSplit.blocking.length > 0`, keyed on the canonical 5 | Start | **(b) COMPILE** |
| 4 | `start-job-readiness.ts:367-369` | no line passes `isSendableGcodeLine` | Start | **(b) COMPILE** |
| 5 | `start-job-readiness.ts:370-375` | `findOversizedLine(gcode, rxBufferBytes)` | Start | **(a) TRANSPORT** — rule 7 names the RX-buffer case verbatim |
| 6 | `start-job-readiness.ts:301-304` → `required-frame-readiness.ts:45` | frame bounds signature / WCO / origin identity mismatch | Start | **THE ONE GUARD** |
| 7 | `start-job-readiness.ts:403-405` | `!prepared.ok` from `prepareOutput` | Start | **(b) COMPILE** — partitioned at `prepare-output.ts:96-99` |
| 8 | `laser-mode-start-evidence.ts:78-87` | evidence absent / M7 shape changed / unverified-unacknowledged | wire boundary | **(c) HANDOFF** — doc-comment at `:70-73` confirms live `$30`/`$32` are advisory |
| 9 | `job-review-gate.ts:198-206` | replay signature / checkpoint fingerprint mismatch | Start | **(c) HANDOFF** |
| 10 | **`start-job-readiness.ts:306-307`** | **controller readiness** | **nothing — `errors` → advisories** | **compliant** |

> **Note on #2 (placement).** "User Origin has no origin set", "WCO unknown", "Absolute with a custom
> origin active", "Current Position without live position" are **not** literally (a), (b) or (c). The
> 2026-07-18 inventory rows 20-23 classify them as **KEPT (input)** — a fourth category the
> maintainer accepted, on the grounds that a placement mode literally lacks the coordinate it
> compiles from, and each refusal offers its one-click fix (Set origin / Reset origin). Flagging it
> only because rule 7's text lists three categories, not four. **No action implied.**

### 3 · Violations

#### 3.1 — `src/ui/app/confirm-controller-readiness.ts:21-25` — **VIOLATION**

```ts
const readiness = runControllerReadiness(project, controllerSettings);
if (readiness.ok) return true;
const lines = readiness.errors.map((e) => `• ${e.message}`).join('\n');
return jobAwareConfirm(
  `The exported file may not run safely on the connected controller:\n\n${lines}\n\nSave anyway?`,
);
```

- **Refuses:** Save / export G-code. Three call sites, all abort on `false`:
  `file-actions.ts:184`, `save-tiled-gcode.ts:59`, `SurfacingPanel.tsx:126`.
- **Condition:** any `runControllerReadiness` error — `$32=0` on laser, `$32=1` on CNC,
  `$30` mismatch, `controller-settings-unknown`.
- **Class: VIOLATION.** Pure controller-setting policy. Rule 7's guard definition names
  "adds confirmation before an otherwise available action … save … export … G-code emission".
  It is not transport (no stream involved — this writes a file), not compile (the program is
  already built; `file-actions.ts:178-183` has already cleared compile integrity separately),
  not handoff (nothing is being streamed).
- **Job Review equivalent: YES, on Start.** Identical strings reach Job Review via
  `start-job-controller-policy.ts:28`. But a Save is not a Start — an operator who only exports to
  SD card never sees Job Review, so on this path the confirm is currently the only signal.
- **Two aggravating defects, both independent of the rule-7 question:**
  1. **Fails closed during a job.** `job-aware-dialogs.ts:33-39`: while a job is active
     `jobAwareConfirm` returns `false` without asking, toasting
     `'A job is running — stop it before discarding or replacing work.'` So saving G-code during a
     job is silently refused, with a message about *discarding work* that does not describe what
     happened.
  2. **Start and Save disagree about the same controller.** `confirm-controller-readiness.ts:20`
     omits the third argument, so `settingsCapability` defaults to `'grbl-dollar'`
     (`controller-readiness.ts:46`). Start passes the real capability
     (`start-job-readiness.ts:384-386`). On FluidNC (`readonly-dump`) an absent `$30`/`$32` is a
     *warning* on Start and an *error* on Save.

#### 3.2 — `src/ui/machine/SurfacingPanel.tsx:121` — **VIOLATION**

```ts
if (!emitted.preflight.ok) {
  const reasons = emitted.preflight.issues.map((issue) => issue.message).join(' ');
  pushToast(`Could not save the surfacing program: ${reasons}`, 'error');
  return;
}
```

- **Refuses:** Save of the spoilboard surfacing program.
- **Condition:** *any* issue from `runStandaloneCncPreflight`, which emits `out-of-bed`,
  `no-go-zone-collision`, `cnc-settings-invalid`, `plunged-travel`,
  `spindle-start-before-clearance` alongside the integrity codes.
- **Class: VIOLATION.** `out-of-bed` is "calculated bed bounds" and `no-go-zone-collision` is
  "configured no-go zones" — the two examples rule 7 names as things that "may warn in Job Review,
  but must never refuse". `standalone-cnc-preflight.ts:80-90` states the intent in the source:
  `// Passing zero to the collision scanner would falsely claim the chosen work` /
  `// origin is machine zero, so fail closed instead.` **Fail-closed on a no-go zone is precisely
  the pattern rule 7 forbids.** In practice: enabling *any* no-go zone makes the surfacing wizard
  permanently unable to save, because `appendNoGoZoneUncertainty` pushes that issue
  unconditionally (`standalone-cnc-preflight.ts:81`).
- **Job Review equivalent: NO.** Surfacing never goes through Job Review; it emits and saves
  directly. Demoting this to a warning needs a toast/advisory to carry the text, or the operator
  loses the signal entirely.
- **The fix already exists in-tree.** `tile-emission.ts:34-39` is the same situation, already
  migrated, and its comment describes this exact bug class.

#### 3.3 — `src/ui/laser/cnc-recovery-preview-model.ts:183` — **VIOLATION (narrow)**

```ts
if (!emitted.preflight.ok) {
  return unavailable(base, 'The current project fails CNC preflight.', parameters);
}
```

- **Refuses:** recovery of a *legacy* interrupted-job record (marks it unavailable).
- **Class: VIOLATION (narrow).** The 2026-07-18 inventory §4 keeps recovery gates, but on the
  stated rationale that they "prove a re-entry matches physical reality and exact bytes". Refusing
  recovery because a layer's feed is out of range is a policy judgement, not that. Its two sibling
  flows — `cnc-pass-recovery-flow.ts:145` and `cnc-supervised-recovery-flow.ts:176` — were both
  explicitly migrated, and both comments say the un-migrated form "stranded a partially-cut
  workpiece". This is the third sibling, left behind.
- **Job Review equivalent: NO.** The message is a generic "fails CNC preflight" with no detail.

### 4 · Controller-setting write path — 11 refusals, all known-and-accepted

All predate ADR-228 (file last touched `581fdd89`, 2026-07-15) and all are covered by
2026-07-18 inventory §5: *"Console/settings: busy/Idle/ownership gates, non-GRBL `$`-write refusal,
machine-kind `$` mismatch, persistent-write confirm, settings-backup-before-write, value
validation"* — **UNCHANGED (non-Start)**, explicitly inventoried and deliberately not modified.

| # | `file:line` | Condition | Refuses | Class |
|---|---|---|---|---|
| 1 | `grbl-setting-write.ts:29-31` | `row === undefined` | `$`-write | evidence precondition — accepted |
| 2 | `grbl-setting-write.ts:32-34` | `!input.backupFresh` | `$`-write | **policy guard** — accepted (§5 "settings-backup-before-write") |
| 3 | `grbl-setting-write.ts:35-37` | `!row.known \|\| writeRisk` `'unknown'`/`'read-only'` | `$`-write | accepted (§5 "value validation") |
| 4 | `grbl-setting-write.ts:38-40` | `!isValidGrblSettingValue(...)` | `$`-write | accepted |
| 5 | **`grbl-setting-write.ts:41-42` → `:65-72`** | `machineKind === 'laser' && id === 32 && value !== '1'` | `$`-write | **policy guard** — accepted (§5 "machine-kind `$` mismatch") |
| 6 | `grbl-setting-write.ts:45-49` | `commonSettingChecked !== true` for `$30/$31/$32` | `$`-write | **confirmation guard** — accepted (§5 "persistent-write confirm") |
| 7 | `grbl-setting-write.ts:50-54` | `typedCommand !== command` for machine-critical | `$`-write | accepted |
| 8 | `grbl-setting-write.ts:56` | fallthrough "not writable by the guarded writer" | `$`-write | accepted |
| 9 | `grbl-settings-actions.ts:347-349` | `statusReport?.state !== 'Idle'` | `$`-write | **(a) TRANSPORT** |
| 10 | `grbl-settings-actions.ts:350-358` | no backup / unknown row / machine-kind `$32` | `$`-write | accepted (duplicates #2, #3, #5 in the UI lane) |
| 11 | `laser-console-actions.ts:209-219` | `grblSettingCommandMachineKindIssue(...)`; non-`grbl-dollar` driver | console `$`-write | accepted (§5, both items) |

**The `$32` rule covers both lanes.** A laser project cannot write `$32=0` from Machine Settings
(`grbl-settings-actions.ts:357`) *or* from the Console (`laser-console-actions.ts:209-212`).
`$32=1` is explicitly allowed (`grbl-setting-write.ts:71`), so **the remedy direction is open and
only the hazard direction is refused** — a materially better design than a symmetric block.

---

## Known-and-accepted vs. re-added drift

This is the distinction the brief asked for. Answer, by `git log`/`git blame` run this session:

| Family | Verdict | Evidence |
|---|---|---|
| `controller-readiness.ts` errors on **Start** | **NOT A GUARD AT ALL** — correctly demoted | `a08f8416` (#291, 2026-07-19) routes `controller.errors` → advisories; no Start refusal exists |
| `controller-readiness.ts` comments | **stale documentation** | `49e938c4` (2026-07-07) and `f13110e39` (#284, 2026-07-17) both predate `a08f8416` |
| `grbl-setting-write.ts` (all 8) | **KNOWN AND ACCEPTED** | last touched `581fdd89` 2026-07-15, i.e. pre-ADR-228; recorded in inventory §5 |
| `confirm-controller-readiness.ts` | **PRE-EXISTING, NEVER INVENTORIED** | `085e90fa` 2026-07-11 — predates ADR-228 (2026-07-17); absent from every section of the 2026-07-18 doc |
| `SurfacingPanel.tsx:121` | **PRE-EXISTING, NEVER INVENTORIED** | `8b04ab10` (#85, 2026-07-13) — predates ADR-228; absent from the 2026-07-18 doc |
| `cnc-recovery-preview-model.ts:183` | **PRE-EXISTING, NEVER MIGRATED** | siblings migrated, this one left |

**No re-added drift was found.** Nothing in the audited surface is a guard that was deleted and
crept back. The three violations are all **pre-existing refusals on surfaces the 2026-07-18
inventory never enumerated** — it covered Start, resume/recovery and the non-Start machine
surfaces, but **not the Save/export path**. That is the gap, and it is the gap that let three
policy refusals survive ADR-228 untouched.

---

## Where removing a block would remove the operator's only signal

Stated plainly, per the brief:

| Refusal | If demoted to a warning, does the operator still get told? |
|---|---|
| `confirm-controller-readiness.ts` (Save) | **Only if a replacement advisory is added.** The identical text reaches Job Review on Start, but a save-to-SD-card operator never opens Job Review. `file-actions.ts` already has an advisory-toast channel (`partitionSavePreflight` advisories) that could carry it. |
| `SurfacingPanel.tsx:121` (Save) | **No — the signal disappears entirely.** Surfacing bypasses Job Review. A replacement toast is required, not optional. |
| `cnc-recovery-preview-model.ts:183` | **No detail is carried today anyway** ("The current project fails CNC preflight"). A demotion that surfaced the actual issues would be strictly *more* informative. |
| `grbl-setting-write.ts:72` (`$32=0`) | **Yes on Start, and the block is not what protects the machine.** See below. |

### On the `$32` safety history specifically

The brief is right that `$32=0` on a laser is genuinely dangerous — laser output is not gated by
motion. It is worth being precise about what the write-refusal actually buys:

- **It prevents KerfDesk from being the tool that creates the hazard.** That is real.
- **It does not prevent the hazard state.** `$32=0` is reachable by another sender, by a firmware
  reset, or by a latched setting — and the project's own history records the firing incident as a
  **latched `$32=0`**, i.e. a state KerfDesk did not write.
- **Start already proceeds in that state**, with a Job Review warning
  (`controller-readiness.ts:226-232` → advisories → Job Review). So the block and the warning
  already coexist, applied to different actions, and the *dangerous* action (starting a job with
  `$32=0`) is the one that only warns.

That asymmetry is a coherent position — refuse to *create* the hazard, warn when you *find* it —
but it is a policy judgement, and rule 7 as written does not carve out an exception for it. It
survives today only because the 2026-07-18 inventory placed the console/settings surface outside
ADR-228's scope. **It is the maintainer's call, and this audit changes nothing about it.**

---

## Secondary observations (no action implied)

1. **Two refusal codes bypass the canonical allowlist.** `selected-output-empty`
   (`prepare-output.ts:68-79`) and `print-and-cut-registration-invalid` /
   `variable-evaluation-failed` (`prepare-output-snapshot.ts:67, 209, 214`) return `ok:false`
   directly without consulting `COMPILE_INTEGRITY_PREFLIGHT_CODES`. All three are honestly
   **(b) COMPILE** — the program factually cannot be produced — so this is a consistency risk in a
   file that claims to be "the single canonical set" (`blocking-codes.ts:1`), not a rule-7 breach.
2. **`rotary-raster-unsupported`** (`preflight.ts:76-77`, "ADR-127: image engraves are refused while
   the rotary is enabled") is not in the canonical set, so on Start and Save it is now an advisory
   despite the comment saying "refused". Another stale comment; the `.rd` encoder still refuses it
   separately (`emit-rd.ts:32-36`).
3. **`no-go-zones.ts` is clean.** `firstZoneCrossedBySegment` (`:35-45`) feeds only the jog guard —
   a non-Start surface the 2026-07-18 inventory §5 records as UNCHANGED.
4. **A non-finite scan offset only warns.** `pre-emit.ts:25` collects scan-offset issues with
   `{ nonFiniteOnly: true }`, so the only code it can raise there is `scan-offset-out-of-range`
   (`scan-offset-policy.ts:49-50`) — and that code is **not** in
   `COMPILE_INTEGRITY_PREFLIGHT_CODES`, so `prepare-output.ts:96-102` files it as an *advisory*,
   not a refusal. A NaN/Infinity scan offset is arguably as unstreamable as a NaN coordinate, so
   this is a **narrower** refusal surface than rule 7 would permit. Narrowing is explicitly normal
   work under rule 7, so **this is not a violation and needs no action** — it is recorded only so
   the next reader does not mistake it for an oversight. **Not verified:** whether such an offset
   later materialises as a NaN coordinate in the emitted body and is caught by the blocking
   `non-finite-coordinate` check at `preflight.ts:431`. That causal chain was not traced.

---

## What was NOT verified

- **No perceptual or live-app verification.** Nothing was rendered, no dev server was run, no
  machine was connected. This is a static read of the current tree plus `git log`/`git blame`.
- **No test/lint/typecheck signal is claimed as evidence for any finding** — this audit adds no
  code, and green tests would not prove any of it either way (rule 2).
- **The FluidNC `readonly-dump` Start-vs-Save divergence (§3.1 defect 2) was verified by reading
  the call signatures, not by executing either path.**
- **The claim that a surfacing save is permanently blocked when any no-go zone is enabled** is read
  from `standalone-cnc-preflight.ts:80-90` + `SurfacingPanel.tsx:121`; it was **not** reproduced in
  the running app.
- No PR was audited; no GitHub state was consulted.
