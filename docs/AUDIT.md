# LaserForge — Master Audit Prompt

**Version:** 1.0
**Status:** Active master prompt for full-codebase audit passes.
**Supersedes:** `docs/AUDIT-PROMPT.md` (the prior sector walkthrough).
**Output format:** every audit pass produces a dated findings ledger at `docs/AUDIT-<YYYY-MM-DD>.md`, following the shape of `docs/AUDIT-2026-05-11.md`.

This file is the master prompt. An auditor — human reviewer or AI agent — reads this top-to-bottom and follows it phase by phase. The audit's deliverable is the dated findings ledger; this prompt is the procedure.

If you are an AI agent reading this: do not skip phases, do not skim. Each phase has exit criteria. Read the phase, do the work, write the findings, then advance.

---

## Section 1 — Audit charter

### 1.1 Why this audit exists

LaserForge drives a **Class 4 diode laser** (Falcon A1 Pro) and the motion system that positions it. An undetected defect anywhere in the path from a user's SVG to a g-code byte on the wire can:

- **Ignite material in an unsafe location** — wrong WCS, wrong bounds, wrong laser power, stuck `M3` without a matching `M5`.
- **Damage the machine** — drive into a limit switch, skip preflight, crash through a soft bound.
- **Lose user work** — corrupt an autosave envelope, lose a job log, drop a recovery state.
- **Compromise the user's machine or network** — Falcon WiFi bridge, update channel, supply-chain dependency, malicious project file.

The audit is **a safety review first and a software-quality review second.** Findings in the laser-output path are weighted heavier than findings of equivalent CWE class elsewhere.

### 1.2 The three non-negotiables

This audit is unusual in three ways. The auditor commits to all three before the first finding is recorded.

1. **No skipping.** Every exported symbol in `src/` and `electron/` is reviewed and recorded in the function-level checklist (Section 5). A symbol marked "audit: no findings, reviewed `<date>`" is acceptable; a symbol absent from the table is **not done.**

2. **No hallucinations.** Every claim in the findings ledger is verified at the moment it is written. Line numbers, symbol names, shipped-status hashes, test source-pin regexes, and external claims ("the comment says X" / "the prior audit found Y") all get a local-verification step. **Phase 9** is the explicit drift-detection module; it runs *before* the executive summary is written.

3. **By the book.** This audit is grounded in published software-audit, secure-coding, and safety-engineering literature. Section 2 lists the references; Section 4 maps each phase to the specific reference that justifies it. Findings cite CWE where applicable and ISO/IEC 25010 quality characteristics always.

### 1.3 Auditor persona

The auditor is not a generalist code reviewer. The persona is:

> **Senior staff engineer**, 10+ years in embedded / safety-critical / control firmware. Has shipped CDRH Class 3B+ laser products through regulatory review. Reads schematics, RTOS source, and protocol reference manuals as comfortably as TypeScript. Has a copy of "The Art of Software Security Assessment" within arm's reach.

An AI agent acting as the auditor must adopt this persona. A finding written in the tone of "this looks weird, you might want to look at it" fails the bar. Findings are precise, cite evidence, name the affected quality characteristic, and end with a concrete recommendation.

### 1.4 What this audit is not

- **Not a refactor.** The audit produces findings; it does not change code. Fixes are filed as tickets and shipped per the repo's coupled-triple discipline (`CLAUDE.md`).
- **Not a feature review.** Whether a feature should exist is a product question. The audit asks whether the feature, as implemented, is correct and safe.
- **Not a one-shot.** A pass produces a dated ledger. The next pass starts fresh; prior ledgers remain as historical evidence.

---

## Section 2 — Methodological references

Every phase in Section 4 derives its checklist from one or more of these. The auditor reads the relevant reference before opening the first file of that phase.

### 2.1 IEEE 1028-2008 — Software Reviews and Audits

The canonical standard for the vocabulary used throughout this prompt. Distinguishes **management review**, **technical review**, **inspection**, **walkthrough**, and **audit** — each with distinct roles and entry / exit criteria. This document specifies an **audit** in the IEEE 1028 sense: an independent examination of the software against defined criteria, by an auditor with no authoring stake.

Roles per IEEE 1028 (applied here):

- **Lead auditor** — owns the findings ledger, decides on severity.
- **Recorder** — captures evidence (same person as lead in solo-dev mode; tooling captures literal output).
- **Initiator** — repo owner; receives the report and decides which findings ship.

Entry criteria for any audit pass: clean working tree, baseline TS errors = 0, prior ledger committed, this prompt re-read.
Exit criteria: every phase's exit checklist green, executive summary written, ledger committed.

### 2.2 ISO/IEC 25010 — Software product quality model

Eight quality characteristics that every finding gets tagged against:

1. **Functional suitability** — completeness, correctness, appropriateness.
2. **Performance efficiency** — time behaviour, resource utilisation, capacity.
3. **Compatibility** — co-existence, interoperability.
4. **Usability** — appropriateness recognisability, learnability, operability, user error protection, UI aesthetics, accessibility.
5. **Reliability** — maturity, availability, fault tolerance, recoverability.
6. **Security** — confidentiality, integrity, non-repudiation, accountability, authenticity.
7. **Maintainability** — modularity, reusability, analysability, modifiability, testability.
8. **Portability** — adaptability, installability, replaceability.

Findings in Section 6's template require **at least one** ISO/IEC 25010 tag; safety findings typically tag **Reliability + Security + Functional suitability** simultaneously.

### 2.3 NIST SP 800-218 — Secure Software Development Framework (SSDF v1.1)

Four practice groups: **PO** (prepare the organisation), **PS** (protect the software), **PW** (produce well-secured software), **RV** (respond to vulnerabilities). Phase 2 (static analysis sweep) derives its tool checklist from PW.6, PW.7, PW.8. Phase 9 (drift detection) corresponds to RV.1 (identify and confirm) applied internally.

### 2.4 OWASP Code Review Guide v2 + OWASP ASVS L1–L3

OWASP CRG provides concrete check patterns for input handling, authentication, session management, cryptographic stores, and error handling. ASVS L1 is the absolute minimum; L2 is the target for a desktop application handling user files; L3 is aspirational for the Falcon WiFi bridge once that surface lands.

For each ASVS L2 requirement, the audit either confirms compliance or files a finding. The full L2 checklist is appended to the audit ledger as an appendix.

### 2.5 CWE Top 25 (2024) + CWE-1003 (weaknesses in safety-critical software)

CWE Top 25 covers the high-frequency / high-impact weaknesses in modern software. CWE-1003 is a view restricted to weaknesses applicable to safety-critical systems — relevant here because of the laser. Every finding cites the matching CWE-NNN entry where one applies.

Particularly relevant CWE entries (not exhaustive):

- CWE-362 (Race condition) — operation mutex, deadman, connect/disconnect.
- CWE-401 (Missing release of resource) — listeners, ports, lease tokens.
- CWE-754 (Improper check for unusual or exceptional conditions) — failure modes.
- CWE-755 (Improper handling of exceptional conditions) — error paths.
- CWE-820 (Missing synchronisation) — controller state shared across handlers.
- CWE-1247 (Improper protection against voltage / power-loss anomalies) — relevant for disconnect-during-job.
- CWE-1357 (Use of components with known vulnerabilities) — `npm audit`.

### 2.6 *The Art of Software Security Assessment* — Dowd, McDonald, Schuh

The authoritative textbook on code-level security review. Phase 4 (function-by-function) uses this book's framework directly: **control-flow analysis**, **data-flow analysis**, **taint analysis**, and **trust-boundary analysis** as the four lenses each function is examined under.

For a function `foo(input)`, the auditor asks:

- **Control flow** — every path from entry to every exit, including thrown exceptions.
- **Data flow** — every read and write of every variable, including transitive object mutation.
- **Taint** — every byte that originated from an untrusted source (user file, network, registry).
- **Trust boundary** — does this function cross a boundary (UI → service, service → controller, controller → wire)?

### 2.7 CERT Secure Coding + MISRA-C:2012 (adapted for TypeScript)

CERT C is the gold standard for secure coding rules at the line-by-line level. MISRA-C is the safety-critical equivalent (automotive / industrial). Both translate well to TypeScript with caveats:

- CERT C rules on integer overflow / signedness → adapted: TS `number` is float64; the audit checks for `Number.isInteger` / `Math.floor` discipline in any context where integer semantics are assumed (e.g. byte counters, line numbers, indices).
- MISRA-C "no use of `goto`" → TS equivalent: no `break label` / `continue label` constructs in safety-critical paths.
- MISRA-C "every `switch` has a `default`" → directly applicable.
- MISRA-C "no shadowing of outer-scope identifiers" → ESLint enforced.

The function-level checklist's "inputs validated" column comes directly from CERT INT (integers), STR (strings), FIO (file I/O), and MEM (memory) families.

### 2.8 IEC 60825-1:2014 — Laser product safety

The international standard for laser product classification, hazard labelling, and interlocks. Directly applicable: LaserForge controls a Class 4 laser, the highest hazard class.

Audit checks driven by IEC 60825-1:

- **Section 4.7 (Beam access)** — every laser-on emission (`M3 S>0`, `M4 S>0`) must be matched by a `M5` on every error path including thrown exceptions.
- **Section 4.7.3 (Remote interlock)** — emergency-stop must reliably interrupt beam emission. The audit verifies the e-stop path emits a safety-off sequence and updates the laser-output state.
- **Section 4.7.4 (Key control / emission delay)** — the audit checks that a fresh connect does not auto-start emission (auto-M5-on-connect is correct; auto-M3 would be a Critical finding).
- **Section 5 (Labelling)** — out of scope (firmware concern, but the UI's "laser on" indicator is the equivalent software signal; audit verifies it cannot lie).

### 2.9 ISO 13849-1:2015 — Safety of machinery, safety-related parts of control systems

Categorises safety-related control systems by **performance level** (PL a–e). The audit checks the operation mutex (T1-222 lease tokens), the emergency-stop chain, the recovery state machine, and the disconnect-while-running handler against PL c / PL d expectations (single-fault tolerance, fault-detection within the control cycle).

### 2.10 STPA — System-Theoretic Process Analysis (Leveson) + FMEA

STPA enumerates **unsafe control actions** by analysing the control structure rather than component failures. For LaserForge:

- The controller is a control entity; commands it issues to the GRBL firmware are control actions.
- Unsafe control actions are enumerated per the STPA template: (a) action not provided when needed, (b) action provided when not needed, (c) action provided too early / too late, (d) action stopped too soon / applied too long.

FMEA (Failure Modes and Effects Analysis) is the component-level complement: for each component (each module, each long-lived object), enumerate failure modes and the user-visible effect. Phase 5 runs both.

### 2.11 Engineering culture — Carmack, Google practices, "How Big Things Get Done"

Tone and reviewer professionalism. The auditor writes findings in the tone of a constructive senior engineer: precise, evidence-bound, never accusatory, never speculative. Carmack's discipline ("read the code, all of it, before forming a hypothesis") is the working norm.

This prompt's hard rule — "Do not ship a fix for a bug not yet diagnosed. 'Probably this' is not a diagnosis." — comes from `CLAUDE.md` and is itself a Carmack-style discipline.

---

## Section 3 — Auditor operating rules

These rules apply to every phase. Violating one is itself a defect in the audit and must be corrected before the ledger is committed.

### 3.1 Verify before judging

Every finding cites `file.ts:line` and quotes the offending code. The auditor reads the cited line *at the moment of writing the finding*, not from memory and not from a prior phase's notes. Lines drift; rebases happen; a stale citation is itself a defect.

The repo's master rule (`CLAUDE.md`):

> Verify external claims against actual code before patching. When ChatGPT, Cursor, an audit doc, or a previous session asserts a line number, symbol name, or behavior, grep/read the live tree first.

This rule applies recursively: an audit cannot cite a prior audit's claim without re-verifying it.

### 3.2 No external claim accepted without local verification

Findings must not contain phrases like:

- "the previous audit found X"
- "ChatGPT diagnosed Y"
- "the comment claims Z"
- "the spec says W"

…without an immediately following local-verification step. T1-97 / T1-98 in this repo's history are the cautionary tale: a fix shipped against an external (ChatGPT) diagnosis that was wrong about the line number it claimed. The drift pass (Phase 9 sub-pass 9) makes external-claim verification the auditor's first reflex.

### 3.3 Citation hygiene

Every line-number citation in a finding is verified at the moment of writing. Findings recorded with a drifted line number are themselves a defect. The Phase 9 line-number-drift scan (sub-pass 1) is applied to the audit doc itself before the audit doc is committed.

### 3.4 No fixes during the audit

The audit produces findings; it does not change `src/` or `electron/`. Fixes are filed as tickets and shipped per the repo's coupled-triple commit pattern. The audit pass is a read-mostly operation: read `src/`, read `tests/`, read `docs/`, write `docs/AUDIT-<date>.md`.

### 3.5 One commit per phase

The audit doc lands incrementally. Each phase is one commit with a message of the shape:

```
docs(audit): AUDIT-<date> Phase <N> — <phase name>

<N findings landed: X critical, Y high, Z medium, ...>

Verification: ledger TS-clean; line-number citations verified.
```

Partial progress is recoverable. If the audit is abandoned mid-phase, the prior phases remain useful evidence.

### 3.6 Audit doc passes its own drift check

Before the executive summary is written, Phase 9 sub-passes 1, 2, and 3 are re-run with the audit doc itself as the target. The audit doc cites line numbers and symbol names; if it has drifted between the time of writing and the time of committing, the drift is corrected before commit.

---

## Section 4 — Audit phase order

Ten phases. Run in order. Each phase has explicit **entry criteria**, a **task list**, and **exit criteria**. Don't advance until exit criteria are green.

### Phase 0 — Pre-audit inventory

**Entry criteria:** Working tree clean; baseline `npx tsc --noEmit --pretty false` returns 0 errors; prior audit ledger (if any) committed; this prompt re-read end-to-end.

**Tasks:**

1. **File inventory.** `git ls-files src/ electron/ tests/ scripts/ docs/` piped through `wc -l` per directory. Record file count and total LOC.
2. **Hot-file list.** Top-20 most-modified files since the prior audit (or since repo inception on a first pass): `git log --since=<prior-audit-date> --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20`.
3. **Largest files.** Top-15 by LOC. God components are pre-flagged for special attention.
4. **Module dependency graph.** Either `npx madge --image dependency-graph.svg src/` or `npx dependency-cruiser --output-type dot src | dot -Tsvg`. Either is acceptable. Save the SVG into the audit ledger appendix.
5. **Trust-boundary diagram.** A short prose enumeration of the trust boundaries crossed by data in this app:
    - Filesystem → renderer (project file load)
    - Network → main process (Falcon WiFi)
    - User input → scene → job → plan → wire
    - Update channel → installer
    - npm registry → installed dependencies
6. **Build-artifact inventory.** `npm run build` produces what? Record exact paths.

**Exit criteria:**

- Inventory recorded in the audit ledger's Phase 0 section.
- Dependency graph saved.
- Trust boundaries listed.
- Phase 0 commit: `docs(audit): AUDIT-<date> Phase 0 — inventory`.

### Phase 1 — Threat model

**Entry criteria:** Phase 0 complete.

**Tasks:**

1. **Asset inventory.** Enumerate what needs protecting:
    - Laser hardware (Class 4 diode).
    - Motion hardware (stepper-driven gantry).
    - User material on the bed.
    - User project files (`.laserforge.json` envelopes).
    - User identity (entitlements, device profiles, materials).
    - Local filesystem (autosave, job log, replay).
    - Network surfaces (Falcon WiFi, update channel).
2. **Adversaries.** For each asset, the realistic threats:
    - Malicious g-code injected via project file.
    - Hostile SVG with crafted geometry (denial-of-service in import).
    - Update channel compromise (typosquatted dependency, hijacked release).
    - Network attacker on the local segment (Falcon WiFi traffic).
    - Supply-chain attack (a transitive npm dependency).
    - The user themselves (operator error → safety interlocks must hold).
3. **STRIDE per trust boundary.** For each boundary identified in Phase 0:
    - **S**poofing — can a process pretend to be another?
    - **T**ampering — can data in transit / at rest be modified?
    - **R**epudiation — can an action be performed without audit trail?
    - **I**nformation disclosure — can confidential data leak?
    - **D**enial of service — can the program be made to hang or crash?
    - **E**levation of privilege — can a low-privilege actor gain higher privilege?
4. **Attack tree.** Rooted at the worst outcome: **"Ignite material in an unsafe location."** Decompose into:
    - Wrong WCS → motion to unintended coordinate.
    - Wrong bounds → motion past soft limits.
    - Wrong laser power → over-burn.
    - Stuck `M3` without `M5` → continuous emission outside the path.
    - Disconnect mid-job without safe stop → ambiguous state on reconnect.
    - Each leaf is a code path; mark which file(s) own it.

**Exit criteria:**

- Asset list, adversary list, STRIDE matrix, attack tree all in the ledger.
- Attack-tree leaves mapped to file paths (these become the high-priority paths for Phase 4 / 5).
- Phase 1 commit.

### Phase 2 — Static analysis sweep

**Entry criteria:** Phase 1 complete.

**Tasks:** Run each tool, record output verbatim in the ledger, file findings for non-zero results.

1. **TS strict.** `npx tsc --noEmit --pretty false`. Expected: 0 errors. Any non-zero is a baseline-regression finding.
2. **ESLint at error.** `npx eslint . --max-warnings 0`. Each surviving warning escalates to a Low finding minimum.
3. **Cyclic dependency scan.** `npx madge --circular src/`. Each cycle is a finding (Medium for cycles crossing the pipeline boundary, Low otherwise).
4. **Dead-export scan.** `npx ts-prune` or `npx knip`. Each dead export is a Low (unless intentionally public — note the exception).
5. **`any` / `as unknown` / `@ts-ignore` / `!` inventory.** Grep with line context:
    - `grep -rn ': any' src/ electron/`
    - `grep -rn 'as unknown' src/ electron/`
    - `grep -rn '@ts-ignore\|@ts-expect-error' src/ electron/`
    - `grep -rn '\.[a-zA-Z_]\!' src/ electron/`
    - Each occurrence in a safety path (`src/controllers/`, `src/communication/`, `src/app/MachineService.ts`, `src/app/ExecutionCoordinator.ts`, `src/core/preflight/`, `src/core/output/`, `electron/serial.ts`, `electron/falcon-wifi/`) escalates to Medium minimum.
6. **Magic numbers / hardcoded delays.** Grep for `setTimeout(.*[0-9]{3,}` (delays ≥ 100ms), inspect each call site.
7. **`console.*` inventory.** `grep -rn 'console\.\(log\|error\|warn\)' src/ electron/`. Production code should route through `appendLogEvent` / `console.warn` only for last-resort warnings.
8. **npm audit.** `npm audit --json | jq '.vulnerabilities'`. Each high/critical is a Critical or High finding (Critical if exploitable in this app's usage; High otherwise).
9. **License check.** `npm run license-check`. Already enforced in `prepare`; the audit re-runs and records the output.
10. **Optional: Semgrep / CodeQL on safety paths.** If wired (separate ticket), record the SARIF output.

**Exit criteria:**

- Each tool's output captured in the ledger.
- Each non-clean result either has a corresponding finding or an explicit "intentional, see <ticket>" note.
- Phase 2 commit.

### Phase 3 — Architectural review

**Entry criteria:** Phase 2 complete.

**Tasks:**

1. **Pipeline boundary discipline.** Verify the dependency direction rule from `CLAUDE.md`:
    - `scene/` cannot import `job/`, `plan/`, `output/`.
    - `job/` cannot import `plan/`, `output/`.
    - `plan/` cannot import `scene/`, `output/`.
    - `output/` cannot import `scene/`.
    Use `grep -rn 'from .*\(scene\|job\|plan\|output\)' src/core/<lower-tier>/` to confirm. Any violation is High.
2. **Controllers → app layering.** `src/controllers/` must not import from `src/app/`. Use grep. T1-202 was the canonical fix for this; verify no regression.
3. **State ownership / single-writer.** Identify every long-lived piece of state (controller state, MachineService state, RecoveryState, MachineEventLedger, autosave state, scene history). For each, identify the single writer. Multiple writers to the same state = Medium minimum.
4. **Effectful vs pure boundary.** `src/core/` should be predominantly pure (deterministic input → deterministic output). Any `Date.now()`, `Math.random()`, `fetch()`, file I/O in `src/core/` is a finding (Low if test-only-affecting, Medium otherwise).
5. **Failure propagation map.** For each safety surface (start-job, frame, jog, test-fire, autoFocus, emergency-stop), trace every throw point and every catch site. Build a `throws → caught at` table. Each uncaught throw escalates to High; each catch that swallows without logging escalates to Medium.

**Exit criteria:**

- Dependency-direction matrix in the ledger (8 cells, one per tier pair).
- State-ownership table.
- Failure-propagation map.
- Phase 3 commit.

### Phase 4 — Function-by-function review (the "no-skip" pass)

**Entry criteria:** Phase 3 complete. This is the longest phase. Plan for it.

**Tasks:** For every exported symbol in every `src/` + `electron/` file, fill one row in the function-level checklist (Section 5). The four lenses from Dowd et al. (Section 2.6) apply to every function:

- **Control flow** — every path from entry to every exit, including thrown exceptions.
- **Data flow** — every read/write of every variable, including transitive object mutation.
- **Taint** — every byte from untrusted sources tracked through every use.
- **Trust boundary** — does this function cross UI → service, service → controller, controller → wire?

**Per function, record:**

| Field | What to check |
|---|---|
| Inputs validated | Types, ranges, null/undefined, NaN/Infinity, integer vs float, units (mm vs px), domain valid. CERT INT / STR rules apply. |
| Failure modes enumerated | Every throw point named in JSDoc; every reject path documented. |
| Side effects docced | If non-pure, JSDoc declares the effects. |
| Resource lifecycle | Acquired resources (handles, listeners, ports, leases, timers) released on every exit path including throw. |
| Re-entrant / concurrency | Can two callers interleave? If yes, is the function safe? |
| Determinism | Pure / deterministic / non-deterministic-justified. |
| Pre/post-conditions | Stated in JSDoc? |
| Unit test | At least one unit test exercises the function. |
| Integration test | T1-120 wired-into-product gate: a test exercises the LIVE production path that calls this function. |
| Notes | Short prose; findings if any. |

**Practical advice:**

- Work file-by-file. Open the file, list all exports, fill one row per export. A file with 30 exports takes ~1 hour at audit pace.
- Use a markdown table per file; concatenate into the ledger's Phase 4 section.
- The four lenses are mental scaffolding; the table captures the conclusions.
- **A function not in the table is not audited.** "I didn't get to that one" is an exit-criteria failure.

**Priority order within Phase 4:** Attack-tree-leaf files first (from Phase 1), then safety-critical files (from `CLAUDE.md` list), then everything else.

**Exit criteria:**

- Every exported symbol in `src/` and `electron/` is a row in the table.
- Per-file findings count summarised at the bottom of the file's table.
- Phase 4 commit (likely several — one per sector is reasonable).

### Phase 5 — Safety-critical deep review (STPA + FMEA)

**Entry criteria:** Phase 4 complete.

**Tasks:**

1. **STPA — Unsafe control actions for laser emission:**
    - Action **not provided when needed:** `M5` not emitted on error path. → Audit every throw in every method that emits `M3` / `M4`.
    - Action **provided when not needed:** `M3` emitted while in alarm / hold. → Audit GRBL state-gate logic.
    - Action **too early / too late:** `M5` after the gantry has already moved past the safe zone. → Audit emergencyLaserOff timing.
    - Action **stopped too soon / applied too long:** Deadman fails; `M3` continues past expected duration. → T1-18, T1-216, T1-222 are prior history; verify still correct.
2. **STPA — Unsafe control actions for motion:**
    - Jog issued in alarm state.
    - Frame issued while job streaming.
    - Set-origin issued while testFire is held.
    - Operation-mutex T1-222 lease tokens cover this — verify the lease guard is honoured at every entry.
3. **FMEA — Per component:**
    - GrblController: transport drop, malformed status line, alarm code without ack, settings query timeout.
    - MachineService: pause/resume race, recovery state stuck, lease leak.
    - MachineEventLedger: write failure, full disk, concurrent append.
    - SerialPort / MockSerialPort: critical-write failure, queue overflow, close during write.
    - Falcon WiFi bridge: TLS handshake failure, message-shape change, disconnect during file upload.
4. **WCS uncertainty handling:** Verify `placementUncertain` paths fail-closed. T1-117 / T1-174 / T1-203 are prior history.
5. **Recovery state machine completeness:** Every transition declared, every state has an exit, no transition is unreachable.

**Exit criteria:**

- STPA table (action × condition) in the ledger.
- FMEA table (component × failure mode × effect).
- Findings filed for any UCA without a defending guard.
- Phase 5 commit.

### Phase 6 — Concurrency audit

**Entry criteria:** Phase 5 complete.

**Tasks:**

1. **Listener leaks.** Grep for `addEventListener`, `on*`, subscribe patterns. Each subscription must have a matching unsubscribe on every disconnect / unmount path. T1-171 was the canonical leak.
2. **Stale closure captures.** Grep for `setTimeout` / `setInterval` callbacks. For each, identify what closed-over state matters and whether it can change between the schedule and the fire. T1-97 was the canonical bug.
3. **Race conditions.** For each shared mutable state identified in Phase 3, enumerate the readers and writers. Two writers without a serialisation discipline = High. T1-222 was the canonical race.
4. **Unhandled promise rejection.** `grep -rn 'void [a-zA-Z]*Async\|\.catch(' src/ electron/`. Every `void promise` and every catch must be motivated.
5. **AbortSignal threading.** For every long-running async (connect, sendJob, frame, autoFocus), verify an AbortSignal is accepted and honoured at every await.
6. **Microtask / setTimeout ordering.** On the critical paths (M5 emission, e-stop, deadman), verify the ordering is deterministic — no relying on "the microtask queue empties first."

**Exit criteria:**

- Listener subscribe/unsubscribe table.
- Closure-capture table.
- Race table.
- Phase 6 commit.

### Phase 7 — Determinism & reproducibility

**Entry criteria:** Phase 6 complete.

**Tasks:**

1. **`LASERFORGE_DETERMINISTIC_IDS` coverage.** Grep for the env var; verify every ID-generation site honours it. Sites that don't = Low.
2. **`Date.now()` audit.** Grep `Date.now()`. Each occurrence in `src/core/` is a defect (Medium); in `src/app/` it's reviewed for whether the timestamp leaks into determinism-relevant output (g-code, hash, job log).
3. **`Math.random()` audit.** Grep `Math.random`. **Any occurrence in `src/core/plan/` or `src/core/output/` is a Critical defect** (non-deterministic g-code).
4. **Map/Set iteration order.** Grep for `for (const ... of <Map|Set>)`. Iteration order of `Map` / `Set` is insertion order in V8, but tests should not rely on it for `Set` membership equality; verify.
5. **Float-format determinism.** G-code emitter must format floats deterministically across platforms (locale-independent `.` decimal, fixed digit count).

**Exit criteria:**

- Determinism table (source × env-var-honoured × test-coverage).
- Phase 7 commit.

### Phase 8 — Test integrity

**Entry criteria:** Phase 7 complete.

**Tasks:**

1. **Per-file coverage map.** For each `src/` file, identify the test(s) that exercise it. A file with no test is Low minimum; a safety file with no integration test is Medium minimum.
2. **Mock realism.** For each test that mocks a `LaserController` / `MachineService` / port, compare the mock's surface to the real interface. A mock that exposes a stale method (renamed in the real interface, still mocked) is a defect — the test passes against a fiction.
3. **T1-120 wired-into-product gate compliance.** For each ticket marked "Shipped" in `ROADMAP.md`, verify:
    - At least one non-test file under `src/` or `electron/` imports / calls the new code.
    - At least one test file mounts the live production path (not mock-only).
    - This is the same check Phase 9 sub-pass 4 enforces against the shipped-status field; the test-integrity pass cross-references.
4. **Source-pin assertions.** Each test that does `readFileSync(...)` and runs a regex is a drift detector. Re-evaluate the regex at audit time against current source; if it now matches a different line than at test-authoring time, the source has drifted in a way the test still tolerates (defect: test is too loose) or the test would now fail (defect: test is failing in CI and being ignored).
5. **Mutation-testing candidates.** Identify safety-critical functions with shallow test coverage (single happy-path test, no failure-mode coverage). These are candidates for follow-up mutation testing (out of scope for this audit; file as Info).
6. **Skipped tests / KNOWN_FAILURES.** Grep `test.skip\|describe.skip\|@known-failure`. Each is a Low minimum; a skipped test on a safety path is High.
7. **Test process leak detection.** The runner spawns a process per file specifically to catch leaked timers. Any test that defeats this (e.g. with `process.exit` in a `finally`) is a defect.

**Exit criteria:**

- Coverage map.
- Mock-vs-real diff table.
- T1-120 compliance table.
- Phase 8 commit.

### Phase 9 — Hallucination & drift detection

**Entry criteria:** Phase 8 complete. **This phase is the user's explicit ask.** It runs before Phase 10 (executive summary) so the summary is written against a verified ledger.

**Tasks:** Nine sub-passes. Each has a concrete command and a clear pass/fail criterion.

#### 9.1 Line-number drift

Every `file.ts:NNN` citation in `src/` comments, `tests/` comments, `docs/`, and the in-progress audit ledger gets verified.

Command (Node-based, cross-platform):

```bash
node scripts/audit-drift-sample.mjs --pass line-numbers --root src/
node scripts/audit-drift-sample.mjs --pass line-numbers --root docs/
```

(See `scripts/audit-drift-sample.mjs` — the worked example committed alongside this prompt. It extracts `[a-zA-Z_/.\-]+\.(ts|tsx|mjs|md):[0-9]+` from comments, reads the cited line, and emits a JSON report of matches/mismatches.)

Pass criterion: every citation either resolves to a line that contains content related to the comment's claim, or the citation is filed as a Phase 9 finding.

#### 9.2 Symbol references

Every `{@link X}`, `see foo()`, `calls bar()` style reference in JSDoc is grep'd against `src/` + `electron/`. Dangling references (symbol no longer exists) are findings.

Command:

```bash
grep -rEn "@link [A-Za-z_][A-Za-z0-9_]*" src/ | \
  awk -F'@link ' '{print $2}' | \
  awk -F'[}|. ]' '{print $1}' | \
  sort -u > /tmp/audit-symbols.txt
while read sym; do
  if ! grep -rq "\b$sym\b" src/ electron/; then
    echo "DANGLING: $sym"
  fi
done < /tmp/audit-symbols.txt
```

Pass criterion: zero dangling references, or each is filed.

#### 9.3 Ticket references

Every `T[123]-[0-9]+` in `src/` + `tests/` + `electron/` must exist in either `docs/ROADMAP.md` or `docs/ROADMAP-shipped-audit.md`.

Command:

```bash
grep -rEoh "T[123]-[0-9]+" src/ tests/ electron/ | sort -u > /tmp/code-tickets.txt
grep -rEoh "T[123]-[0-9]+" docs/ROADMAP.md docs/ROADMAP-shipped-audit.md | sort -u > /tmp/doc-tickets.txt
comm -23 /tmp/code-tickets.txt /tmp/doc-tickets.txt > /tmp/orphan-tickets.txt
cat /tmp/orphan-tickets.txt
```

Pass criterion: `/tmp/orphan-tickets.txt` is empty, or every orphan is filed as a finding (code mentions a ticket nobody documented).

#### 9.4 Shipped-status claims

Every "Status: Shipped in `<hash>`" in `ROADMAP.md` must reference a real commit that touches files related to the ticket.

Command:

```bash
grep -oE "Shipped in \`[a-f0-9]{7,40}\`" docs/ROADMAP.md | \
  awk -F'`' '{print $2}' | sort -u | while read h; do
  if ! git cat-file -e "$h" 2>/dev/null; then
    echo "MISSING: $h"
  fi
done
```

Pass criterion: every hash is reachable. A bonus pass cross-references commit body against ticket subject to catch "claimed shipped but the commit didn't actually implement it" cases (the T1-120 retrofit was about exactly this).

#### 9.5 Test source-pin assertions

Re-run every `readFileSync` + regex test under `tests/`. Any test that now fails is a drift signal; any test that still passes but on subtly different text is a candidate for a Low finding (test is too loose).

Command:

```bash
npm test 2>&1 | tee /tmp/full-test-output.log
grep -E "FAIL|✗" /tmp/full-test-output.log
```

Pass criterion: full suite green; any failure investigated and either fixed or filed.

#### 9.6 Comment-vs-code agreement

For high-traffic functions (the Phase 0 hot-file list + safety files), each JSDoc claim about behaviour is traced one level into the implementation. Claims contradicting the code are findings.

This sub-pass is manual; budget 30 minutes per hot file. The goal is to catch comments that say "this returns the LEASE" when the function actually returns boolean, etc. — drift between comment and implementation.

Pass criterion: every hot file's JSDoc reviewed; contradictions filed.

#### 9.7 README / AGENT_HANDOFF accuracy

`docs/AGENT_HANDOFF.md`'s "last shipped" claim is compared against `git log -1 --oneline`. The "current state" prose is compared against actual `git status`.

Command:

```bash
echo "=== Handoff claims ==="
grep -A2 "Last shipped" docs/AGENT_HANDOFF.md | head -5
echo "=== Reality ==="
git log -1 --oneline
git status --porcelain
```

Pass criterion: handoff matches reality, or the drift is filed (and the handoff is updated in a follow-up commit, OUTSIDE the audit).

#### 9.8 Self-contradiction across docs

`ROADMAP.md` shipped count vs. `ROADMAP-shipped-audit.md` shipped count vs. master-checklist `- [x]` count must agree.

Command:

```bash
echo "ROADMAP Status:Shipped count:"
grep -c "\*\*Status:\*\* Shipped" docs/ROADMAP.md
echo "Audit ledger Shipped section count:"
sed -n '/^## Shipped/,/^## /p' docs/ROADMAP-shipped-audit.md | grep -c "^| T"
echo "Master checklist [x] count:"
grep -c "^- \[x\]" docs/ROADMAP.md
```

Pass criterion: counts agree, or the drift is filed.

#### 9.9 External claim verification

Final sub-pass. The auditor reads back the in-progress findings ledger looking for any unverified external claim: "the prior audit found", "ChatGPT said", "the spec requires". Each such phrase is replaced with a local-verification step or removed.

Pass criterion: zero unverified external claims in the ledger.

**Phase 9 exit criteria:**

- Each sub-pass returns zero unresolved drift signals OR each unresolved signal is a Phase 9 finding.
- The audit doc itself passes sub-pass 1 and sub-pass 2 (re-run with the audit doc as target).
- Phase 9 commit.

### Phase 10 — Executive summary & sign-off

**Entry criteria:** Phase 9 complete with no unresolved drift.

**Tasks:**

1. **Severity counts.** Critical / High / Medium / Low / Info totals across the entire pass.
2. **Top-3 Critical.** One-paragraph synthesis per finding.
3. **Top-5 High.** One-paragraph synthesis per finding.
4. **Heat map by sector.** Findings per directory; safety-critical directories highlighted.
5. **Suggested ticket ordering.** Findings sorted by risk score (Section 7); top-15 with proposed ticket IDs (next T1 / T2 / T3 numbers from the master checklist).
6. **Open questions for the owner.** Anything the auditor couldn't resolve without owner input.
7. **Final sign-off.** Lead auditor's name and date.

**Exit criteria:**

- Executive summary at the top of the ledger.
- Ledger committed and pushed.
- AGENT_HANDOFF.md updated with a pointer to the new ledger.
- Phase 10 commit.

---

## Section 5 — Function-level checklist template

Reproduce this template once at the top of the ledger's Phase 4 section, then once per file (copying the header). Each exported symbol gets exactly one row.

```markdown
### File: `src/<path>/<file>.ts`

**Exports reviewed:** N (matches `grep -E '^export (function|class|const|interface|type|enum)' src/<path>/<file>.ts | wc -l`)

| Function / Class | Inputs validated | Failure modes | Side effects docced | Resource lifecycle | Re-entrant | Determinism | Unit test | Integration test | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `foo(x, y)` | ✓ | ✓ | ✓ | N/A (pure) | ✓ | pure | ✓ tests/foo.test.ts | ✓ tests/foo-integration.test.ts | — |
| `bar(input)` | ✗ — accepts unbounded string | ✗ — throws on empty input but JSDoc says returns null | ✓ | listener leak on early return | ✗ | non-det (Date.now) | ✓ | ✗ | F-NNN |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

**Findings count for this file:** X total (A critical, B high, C medium, D low, E info).
```

**Column conventions:**

- `✓` — satisfied / present.
- `✗ — <reason>` — defective, with a one-line reason.
- `N/A` — not applicable (e.g. pure function has no resource lifecycle).
- `partial — see notes` — mostly satisfied; details in the Notes column.

**Determinism column values:**

- `pure` — no side effects, deterministic.
- `deterministic` — has side effects, but same inputs → same observable behaviour.
- `non-det — <reason>` — uses `Date.now()`, randomness, file I/O, network, etc.

**Unit test column:**

- `✓ tests/<file>.test.ts` — at least one test exercises this function with a non-trivial assertion.
- `✗` — no test exists.

**Integration test column** (T1-120 wired-into-product gate):

- `✓ tests/<file>.test.ts` — a test mounts the LIVE production caller and exercises the path.
- `✗` — the function is tested in isolation but no test exercises a real caller.

---

## Section 6 — Finding template

```markdown
### F-NNN: <one-line description>

- **Severity:** Critical | High | Medium | Low | Info
- **Category:** Safety | Security | Correctness | Robustness | Performance | Concurrency | Type-safety | API surface | Design | Test coverage | Dead code | Documentation
- **CWE:** CWE-NNN (one or more, comma-separated)
- **ISO/IEC 25010:** Reliability | Security | Functional suitability | ... (one or more)
- **STPA / FMEA category:** Unsafe Control Action (UCA-N from Phase 5) | FMEA failure mode | N/A
- **Risk score:** severity × likelihood × blast radius = [1–45]
- **Location:** `<file>:<line>` (multiple if relevant)
- **Evidence:**
  ```ts
  // exact quote of the problematic code, with surrounding context
  ```
- **Analysis:**
  <2–4 sentences. Why is this a problem? What's the user-visible impact? What does the current code do instead of what it should do? Cite specific paths through control / data flow.>
- **Reproduction:**
  ```bash
  # one-line command that surfaces the evidence
  grep -n '<pattern>' src/<file>.ts
  ```
- **Recommendation:**
  <Concrete action: ticket number to file, specific code change to consider, "no action — design intent" with reasoning, or "investigate further — needs <X>".>
- **Related findings:** F-MMM, F-OOO (if any)
```

---

## Section 7 — Severity, risk score, triage

### 7.1 Severity scale

- **Critical** — Can directly cause a fire, mechanical damage, data loss, or remote-controllable security compromise. Drop everything. Ship a fix this week.
- **High** — Silent wrong behaviour in a safety path, OR a defence layer that doesn't actually defend. P0 ticket. Ship within two weeks.
- **Medium** — Correctness or robustness bug in non-safety code, OR a safety bug that another layer catches. File the ticket.
- **Low** — Style, naming, dead code, missing JSDoc. File only if trivial to fix.
- **Info** — Observation worth recording (architecture note, design decision rationale, test-coverage observation). Not actionable.

### 7.2 Risk score

```
risk = severity × likelihood × blast_radius

severity     = 5 (Critical) | 4 (High) | 3 (Medium) | 2 (Low) | 1 (Info)
likelihood   = 1 (needs specific user action / edge case)
             | 2 (happens on common paths)
             | 3 (always-on)
blast_radius = 1 (single feature / UI surface)
             | 2 (a subsystem)
             | 3 (whole-program / hardware / data integrity)
```

Score in [1, 45]. Triage rubric:

- **≥ 30** — ship a fix this sprint.
- **20–29** — ship within two sprints.
- **10–19** — backlog with target date.
- **< 10** — backlog, no target.

### 7.3 Categories

Same set as `docs/AUDIT-PROMPT.md` (the legacy prompt). Reproduced here for completeness:

- **Safety** — could cause physical harm or property damage.
- **Security** — could compromise user machine / data.
- **Correctness** — wrong output for valid input.
- **Robustness** — crashes / undefined behaviour on edge cases.
- **Performance** — measurable user-visible slowness.
- **Concurrency** — races, deadlocks, listener leaks.
- **Type-safety** — `any`, unchecked casts, `@ts-ignore`.
- **API surface** — public API mismatched with usage / docs.
- **Design** — coupling, layering, naming, smells.
- **Test coverage** — missing test for stated contract.
- **Dead code** — unreachable / unused.
- **Documentation** — wrong / missing / misleading comment.

---

## Section 8 — Reporting format

### 8.1 Per-pass ledger

Each audit pass produces `docs/AUDIT-<YYYY-MM-DD>.md` following the shape of `docs/AUDIT-2026-05-11.md`:

```markdown
# LaserForge full-code audit — YYYY-MM-DD

**Auditor:** <name / model>
**Scope:** all of `src/`, `electron/`, `tests/`, `scripts/`, `docs/`.
**Method:** see `docs/AUDIT.md`.
**Repo state at start:** master @ `<hash>` (post-<ticket>).

## Progress table
| Phase | Sector | Status | Findings |

## Severity counts (FINAL)

## Executive summary

## Phase 0 — Pre-audit inventory
## Phase 1 — Threat model
## Phase 2 — Static analysis
## Phase 3 — Architectural review
## Phase 4 — Function-by-function review
## Phase 5 — Safety-critical deep review
## Phase 6 — Concurrency
## Phase 7 — Determinism
## Phase 8 — Test integrity
## Phase 9 — Drift detection
## Phase 10 — Executive summary

## Appendices
- A. Dependency graph (SVG / DOT)
- B. ASVS L2 compliance checklist
- C. Function-level checklist (Phase 4 master table)
- D. CWE references
- E. ISO/IEC 25010 tags
```

### 8.2 Executive summary shape

The executive summary at the top of the ledger has:

1. **One-paragraph headline** — overall posture statement.
2. **Severity counts** — single-line tally.
3. **Top-3 Critical** — bullet list with risk score and recommended ticket.
4. **Top-5 High** — same.
5. **Heat map** — markdown table, findings per directory, sorted.
6. **Suggested next 15 tickets** — sorted by risk score, with proposed T1/T2/T3 IDs.
7. **Open questions** — bullets for owner attention.
8. **Sign-off** — auditor name, date, commit hash of the ledger.

### 8.3 Findings numbering

Findings are `F-001` through `F-NNN` in order of writing. Numbers do not collide across audit passes — each pass starts from `F-001` (the audit pass is identified by date in the filename). Cross-pass references use `<date>:F-NNN`.

---

## Section 9 — Definition of done

The audit is **not done** until every box is ticked.

- [ ] Every `src/` directory has at least one finding entry OR an explicit "no findings — reviewed" record.
- [ ] Every `electron/` file has at least one finding entry OR an explicit "no findings — reviewed" record.
- [ ] Every safety-touching file (per `CLAUDE.md` list) has at least 3 sentences of audit notes.
- [ ] Every exported symbol in `src/` + `electron/` appears as a row in the function-level checklist (Section 5).
- [ ] Phase 9 hallucination pass returns zero unresolved drift flags (every flag either fixed or filed as a finding).
- [ ] Every finding has a one-line reproduction command (Section 6 template field).
- [ ] The audit doc itself passes Phase 9 sub-passes 1, 2, 3 (line numbers, symbol refs, ticket refs in the ledger are verified).
- [ ] Executive summary at the top of the ledger.
- [ ] AGENT_HANDOFF.md updated with a pointer.
- [ ] Ledger committed to git on `master`.

---

## Section 10 — Onboarding & handoff

### 10.1 Starting an audit

1. Pull `master`. Working tree clean. `npx tsc --noEmit` returns 0.
2. Re-read this prompt end-to-end.
3. Re-read `CLAUDE.md` and `.cursor/rules/laserforge.md`.
4. Create `docs/AUDIT-<YYYY-MM-DD>.md` with the Section 8.1 skeleton.
5. Start Phase 0.

### 10.2 Mid-pass handoff

If the audit is paused (different session, different reviewer):

1. Last commit is the most recent `docs(audit): AUDIT-<date> Phase <N>` commit.
2. The ledger's Progress table shows the next phase to run.
3. The current `F-NNN` counter is the last finding number + 1.
4. Add a `## Handoff notes` block at the bottom of the ledger with anything the next reviewer should know.

### 10.3 Retiring an audit

After the executive summary is committed:

1. Tag the commit: `git tag audit-<date> <hash>`.
2. Update `docs/AGENT_HANDOFF.md` with a pointer to the new ledger.
3. Decide which findings ship as tickets; add them to `docs/ROADMAP.md`.
4. The findings ledger becomes historical evidence; subsequent audits reference but do not modify it.

---

## Appendix A — Phase 9 worked example

The `scripts/audit-drift-sample.mjs` script is the worked example for Phase 9 sub-pass 1 (line-number drift). It:

1. Scans a directory tree for comment lines containing `<file>:<line>` citations.
2. For each citation, reads the cited file at the cited line.
3. Reports matches/mismatches as JSON.

Run it from the repo root:

```bash
node scripts/audit-drift-sample.mjs --root src/app
node scripts/audit-drift-sample.mjs --root docs --json > drift-report.json
```

The script is intentionally small (~150 lines, no dependencies). It is **not** a full Phase 9 toolkit; it is one sub-pass implemented end-to-end so the prompt is verified to be runnable rather than theoretical. Future audit work can grow the toolkit (one sub-pass per script) under `scripts/audit-*.mjs`.

---

## Appendix B — Quick reference: every Phase 9 command in one place

```bash
# 9.1 — Line-number drift
node scripts/audit-drift-sample.mjs --root src/
node scripts/audit-drift-sample.mjs --root docs/

# 9.3 — Ticket references
grep -rEoh "T[123]-[0-9]+" src/ tests/ electron/ | sort -u > /tmp/code-tickets.txt
grep -rEoh "T[123]-[0-9]+" docs/ROADMAP.md docs/ROADMAP-shipped-audit.md | sort -u > /tmp/doc-tickets.txt
comm -23 /tmp/code-tickets.txt /tmp/doc-tickets.txt

# 9.4 — Shipped-status hashes
grep -oE "Shipped in \`[a-f0-9]{7,40}\`" docs/ROADMAP.md | awk -F'\`' '{print $2}' | sort -u | while read h; do
  git cat-file -e "$h" 2>/dev/null || echo "MISSING: $h"
done

# 9.5 — Test source-pin assertions
npm test

# 9.7 — Handoff drift
grep -A2 "Last shipped" docs/AGENT_HANDOFF.md
git log -1 --oneline

# 9.8 — Doc self-contradiction
grep -c "\*\*Status:\*\* Shipped" docs/ROADMAP.md
grep -c "^- \[x\]" docs/ROADMAP.md
```

---

**End of master audit prompt.** Begin an audit by creating `docs/AUDIT-<YYYY-MM-DD>.md` and starting Phase 0.
