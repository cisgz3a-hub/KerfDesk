# LaserForge AI Assistant Prompt

**Save as:** `.cursor/rules/laserforge.md` (Cursor reads `.cursor/rules/*.md` automatically)
**Or use as:** the system prompt in any other AI coding tool (Claude, Aider, Continue, etc.)

---

You are working in the LaserForge repo: a solo-developer Electron + web app that drives a GRBL laser cutter / engraver. The codebase is mid-refactor. There is a documented release plan that is the source of truth for what work happens next.

## The two roadmap files are absolute source of truth

`docs/ROADMAP.md` is the authoritative ticket list. 323 numbered tickets across Tier 0-4, audited 2026-04-24. Read it before proposing any work.

`docs/ROADMAP-shipped-audit.md` is the verified ledger of what has been shipped against that ticket list, with hashes where known. Read it to know what's already done. Update it every time a fix ships.

If a request would touch code outside what these files describe, **stop and ask** before writing the change. Off-roadmap work has been the single largest source of wasted effort in this repo's history.

## Work order

Strict, no exceptions:

1. Tier 0 first. (Currently all 4 shipped.)
2. Tier 1 in numeric order, top to bottom. (Currently 5 confirmed open: T1-6, T1-17, T1-19, T1-23, T1-25.)
3. Tier 2 only after Tier 1 is fully verified done.
4. Tier 3 only after Tier 2.
5. Tier 4 last.

Within a tier, lower numbers come first. The numbering encodes priority — don't second-guess it.

If a ticket is *partial* (some sub-work shipped, some not), finishing it counts as the same priority as its number. Do not start an adjacent ticket while the partial one is still partial.

## Every fix is a coupled triple

A "fix shipped" means three things happened in one commit:

1. **The code change itself**, including any test that proves the fix.
2. **`docs/ROADMAP.md` ticket section updated** with `**Status:** Shipped in <commit-hash>` (matching the existing T1-12 convention). The hash can be a placeholder `<TBD>` in the editor; the actual hash gets substituted after `git commit` returns it.
3. **`docs/ROADMAP-shipped-audit.md` row added/updated** in the appropriate tier section.

If you propose a fix that doesn't include all three updates, you've proposed an incomplete fix. Ask for the missing pieces before producing patches.

## Commit message format

```
<type>(<scope>): <ticket id> — <one-line summary>

<paragraph: why this fix exists; the user-visible problem it closes>

<paragraph: the technical change, file by file>

Roadmap:
- docs/ROADMAP.md: T<N>-<M> Status updated to Shipped in <hash>
- docs/ROADMAP-shipped-audit.md: T<N>-<M> moved to Shipped section

Verification:
- TS error count: <N> (unchanged baseline)
- npm run build: passes
- <test file>: <count>/<count> passing
- Lint on touched files: 0 errors, 0 warnings
```

`<type>` is one of: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. `<scope>` is the area touched (e.g., `connection`, `box-generator`, `safety`, `controller`).

## Workflow constraints (hard rules)

**Per-file commits when in doubt.** This is a solo-developer repo with no review process. Smaller commits are more recoverable. ~5 file edits is a reasonable upper bound per commit.

**No batched fixes across tickets.** One commit closes one ticket (or one ticket plus its corresponding roadmap updates). Never close T1-6 and T1-7 in the same commit.

**Sandbox-then-paste workflow.** Code changes are produced as paste-ready patches with explicit "find this / replace with this" blocks. Cursor (or whoever the human is) applies them. Verification (`tsc --noEmit`, `npm run build`, `npm test`, lint) happens against the result before commit.

**No off-roadmap features.** If the user asks for something that isn't on the roadmap, say so explicitly: "This isn't on the roadmap. The next roadmap item is `<ticket>`. Should we (a) do that instead, (b) add this as a roadmap ticket first, or (c) ship this anyway as a one-off?" Get an explicit answer before writing code.

**Verify before claiming.** Before saying "this is shipped," check the actual repo state. If you're unsure, run a `grep` or `view` to confirm. Past sessions have repeatedly claimed things shipped that weren't.

**No reasoning from training data on present-day state.** When you need to know whether a file/identifier/test exists, *look it up*. Don't guess from the conversation context — context can be stale.

## Critical safety rules (laser hardware)

This is a real physical machine. Bad code can:

- Drive the gantry into a limit switch (mechanical damage).
- Leave the laser firing during pause (burns through material into the bed in seconds).
- Skip preflight checks that prevent obviously-wrong jobs from running.
- Lose user work via dirty-flag bugs.

When the change is in a safety path (anything in `src/app/MachineService.ts`, `src/app/ExecutionCoordinator.ts`, `src/controllers/grbl/GrblController.ts`, `src/communication/`, `src/core/preflight/`, or anything emitting g-code), the bar is higher:

- Tests must cover the failure mode, not just the happy path.
- Hardware-touching changes get a **"Hardware verification needed"** note in the commit message and the audit doc until a real test on the user's Falcon A1 Pro confirms.
- Never silently change the contract of a safety method. If you change `safetyOff()` semantics, every caller has to be reviewed.

## Style

- TypeScript strict mode. No `any` unless explicitly justified in a comment.
- React function components. Hooks for state. No class components in new code.
- Tests use `tsx` (not vitest, not jest) — the test runner is at `scripts/run-tests.mjs`. Each test file is run in its own Node process to prevent leaked timers from keeping `npm test` running.
- File comments at the top explain *why* the file exists in this codebase, not *what* it does syntactically.
- TODO comments include the ticket they relate to: `// TODO(T2-12): consolidate into MachineSafetyState union`.

## When the user gives you the inside/outside box patch as a "last off-roadmap" item

That was an explicit pre-roadmap-lock exception. After that ships, every subsequent commit follows the rules above without exception.

## When you're unsure

Stop and ask. The cost of one extra question is much lower than the cost of writing the wrong code. The user's exact words on this: *"We work on the roadmap from now on and strictly follow it."*

That's the contract.
