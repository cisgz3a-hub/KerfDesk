# Rolling audit v2 — method

Started 2026-10-21 on `origin/main` @ `70c01e11f`. Builds on the July rolling audit
(`docs/audits/rolling/`) and the August ten-loop audit, and changes three things: areas are
chosen by **risk × change since last audit**, every finding must carry an **anchor**, and
every finding passes an **independent refuter** that has to try to break it, using research
where the claim depends on the outside world.

## 1. What a finding is

A finding is a place where the code's behaviour differs from what it must do. "Must" has to
come from one of three anchors. A finding with no anchor is an opinion and is dropped.

| Anchor | Source of "must" | Example |
|---|---|---|
| **Contract** | `PROJECT.md` non-negotiables, the governing ADR, `WORKFLOW.md` | Licence check gates Start (forbidden by ADR-540) |
| **Ground truth** | A primary outside source: firmware docs, file-format spec, platform security guidance, reference-app behaviour | GRBL `$32` laser mode semantics; SVG arc flags; Electron `contextIsolation` |
| **Twin consistency** | Two pieces of code that model the same thing must agree | Preview path vs emitted G-code; time estimate vs streamed program; client vs server validation |

## 2. Lenses

Each area runs the lenses that apply to it. Lenses are run as separate, independent passes
(parallel subagents where possible), so one pass's framing does not blind the others.

- **L1 Contract.** List the clauses that govern the area, then check each clause in the code.
- **L2 Ground truth.** List every assumption the area makes about the outside world, then
  check each against a primary source. Research is required; memory is not evidence.
- **L3 Twin models.** Find every concept computed in more than one place, and diff the
  implementations. This lens produced most of the July rolling audit's real bugs.
- **L4 Adversarial input and state.** Boundary values (0, negative, NaN, Infinity, empty,
  huge, Unicode, CRLF), interleavings (cancel, reconnect, double-click, a second window), and
  lifecycle (Undo/Redo, reload, migration, autosave recovery).
- **L5 Trust boundary.** Wherever untrusted data enters (files, network, IPC, phone, MCP,
  licence tokens, camera streams): validation, authorisation, injection, replay, resource
  exhaustion.
- **L6 Failure path.** What happens on error: is the laser turned off, the port released, the
  partial file cleaned up, the user told the truth? Look for swallowed errors.
- **L7 Test truth.** Do the tests assert the behaviour the code claims, or only restate the
  implementation? Which fragile path has no regression test?

## 3. Severity

- **P1.** Can fire the laser or move the machine unexpectedly; silently produces wrong physical
  output (power, position, depth, scale); loses or corrupts user data; or is a shipped,
  remotely reachable security hole or licence bypass.
- **P2.** Wrong behaviour an ordinary user will hit, with a misleading result; a security
  weakness that needs local access or unusual conditions; or a broken contract with a clear
  failure scenario.
- **P3.** Latent (not reachable today), doc/code drift, missing test, or polish.

## 4. Evidence bar

Every finding records:

1. `file:line` on the audited SHA.
2. A failure scenario: concrete input or state → wrong result.
3. Its anchor (Contract / Ground truth / Twin), with the clause, URL or twin location.
4. Its evidence type:
   - **REPRO**: it was run (node script, focused Vitest, or browser) — give the command and
     the observed output.
   - **SOURCE**: a primary-source citation — URL and a short quote (under 15 words).
   - **READ**: code reading only.

A READ-only finding cannot be P1 unless the refuter reproduces it. Severity is set by the
failure scenario, not by how alarming the code looks.

## 5. Verification (the refuter)

Every candidate finding goes to a refuter that did not raise it and starts from a fresh
context. The refuter's job is to prove the finding wrong:

1. State what would make the finding false (a guard upstream, an unreachable path, a
   mis-read spec).
2. Check exactly that: read the callers and guards, run a repro, and for any ground-truth
   claim, fetch the primary source itself instead of trusting the auditor's citation.
3. Return **CONFIRMED** (reproduced, or two independent lines of evidence), **PLAUSIBLE**
   (consistent, not reproduced) or **REFUTED** (with the reason).

Refuted findings stay in the report under "Refuted", so later audits do not raise them again.

The coordinator then re-verifies every P1 and P2 itself before the ledger counts it, and
de-duplicates across areas.

## 6. Novelty check

Before raising a finding, search `docs/audits/` for the same file or symptom, and check open
PRs that touch the file (`gh pr list --state open --json number,title,files`). Mark a finding
**KNOWN** (with the prior report or PR) instead of raising it as new.

## 7. Rules for audit sessions

- Report only: no code fixes, no pushes, no PRs. Do not operate hardware.
- Audit the latest `origin/main` (record the SHA). Work in your own worktree. Never use
  `git stash` (the stash is shared by every worktree); never touch another worktree.
- Repro scripts go in your scratchpad, not the repo. Focused Vitest runs only — no full suite.
- Commit only your report to your own local branch `claude/audit-v2-<area-id>`.

## 8. Report template

File: `docs/audits/2026-10-21-rolling-v2/<NN>-<area-id>.md`

```markdown
# Rolling audit v2 — <Area name>

- **When:** <date time>   **Tree:** origin/main @ <sha>
- **Scope:** <paths, entry points, governing ADRs>
- **Lenses run:** L1..L7 (say which were skipped and why)
- **Counts:** <raised> raised → <refuted> refuted → P1 <n> / P2 <n> / P3 <n> (+ <n> KNOWN)

## Headline
<two to four sentences: the most important thing a maintainer should know>

## Findings
### <P#-n> — <one-line claim>
- **Where:** `path:line`
- **Anchor:** Contract | Ground truth | Twin — <clause / URL / twin location>
- **Scenario:** <input/state → wrong result>
- **Evidence:** REPRO | SOURCE | READ — <command + output, or URL + short quote>
- **Refuter:** CONFIRMED | PLAUSIBLE — <what the refuter checked>
- **Fix direction:** <one or two sentences; no patch>

## Refuted
<each refuted candidate, one line, with the reason>

## Verified clean
<what was checked hard and holds — so the next audit can skip it>

## Not verified
<what this audit could not cover, and why>
```

Each report ends with a fenced `json` block listing its findings, one object per finding:
`{"id","severity","area","file","line","anchor","evidence","verdict","known","summary"}`.

## 9a. Runner change from batch 2

Batch 1 ran as four Claude sessions, each with parallel lens subagents and refuters. The
desktop app does not let an automated loop tick start new sessions, so from batch 2 the
coordinator runs each area as two background subagents in the shared audit worktree. First an
**auditor** runs every applicable lens and writes the draft report with verdicts `PENDING`.
Then a fresh **refuter**, which never saw the auditor's reasoning, tries to break every finding
and writes the verdicts. The coordinator still re-verifies every P1/P2. Auditors and refuters
never commit; the coordinator commits the reports.

## 9. Coordinator loop

1. Pick the next batch of four areas from `AREAS.md` (highest priority not yet audited).
2. Start one audit session per area, each in its own worktree.
3. When the batch finishes: collect the reports onto `claude/rolling-audit-20261021`,
   re-verify every P1/P2 (code + repro + research), de-duplicate, and update `LEDGER.md`.
4. Propose a fix session for each confirmed P1/P2 cluster.
5. Start the next batch.
