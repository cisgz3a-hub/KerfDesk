# Operating rules for agents working in this repo

> Read `CLAUDE.md` (operating manual), `PROJECT.md` (scope), `DECISIONS.md` (ADRs),
> and `WORKFLOW.md` (flows) at the start of every session. The rule below overrides
> any default behavior and is enforced at maintainer review — it is the rule agents
> most often violate in this repo.

## FRAME IS THE ONLY GUARD — no new guard may ever be added. Hard rule, no exceptions.

(Maintainer, 2026-07-17. Canonical sources: `CLAUDE.md` collaboration rule 7,
`PROJECT.md` non-negotiable #21, `DECISIONS.md` ADR-228 clarified by ADR-232.
This section restates them in full so it is self-contained — do not rely on the
reader having opened those files.)

A **guard** is any behavior that blocks, refuses, gates, caps, clamps, delays,
hides, disables, rewrites, or adds a confirmation before an otherwise-available
action, input, output, machine command, job start, preview, save, import, export,
or G-code emission.

The **one** Start guard that exists is the frame-first gate: a completed Frame for
the exact current job (bounds signature + origin identity) opens Start on both
laser and CNC. The **Job Review dialog is the single warning surface** the operator
confirms. Frame is the source of truth: calculated bed bounds, configured no-go
zones, and controller-setting policy may **warn** in Job Review, but must **never**
refuse Frame or Start. The actual clean Frame completion decides whether a permit
exists.

**Never add a new guard, re-add a deleted one, expand any refusal surface, or
promote a warning into a block** — not for "safety," not for "defense in depth,"
not with a test or an ADR, not ever. Anything you believe the operator should know
goes into the Job Review warnings list, which informs and never refuses. **If you
find yourself reasoning toward an exception, you are wrong** — put the concern in
Job Review as a warning and stop.

The only non-guard refusals permitted to exist are:

- **(a) transport preconditions** — the serial channel factually cannot accept a
  stream (disconnected, no status yet, controller Alarm/not-Idle, a job/jog/frame/
  operation already running, MPG owning control, a line larger than the RX buffer)
  — each of which must offer its fix in place where one exists;
- **(b) compile integrity** — the program factually cannot be produced or contains
  unstreamable bytes (compile failure, NaN coordinates, empty output); and
- **(c) handoff consistency** — the exact reviewed program/setup must be the one
  streamed (evidence epochs, attestation binding, resume fingerprints).

Re-labeling a policy judgment as one of those three factual categories is itself a
violation of this rule. Narrowing, correcting, or removing a refusal is normal
work; **widening any refusal — or adding any new one — requires the maintainer's
explicit prior permission in chat, which must be presumed denied.**

---

# JOB COMPLETION REPORT — every finished job, every branch. Hard rule, no exceptions.

(Maintainer, 2026-07-25. Canonical source: `CLAUDE.md` collaboration rule 8, which
absorbs and replaces the earlier four-section completion rule. This section restates
it in full so it is self-contained — do not rely on the reader having opened
`CLAUDE.md`.)

A **job** is any unit of work you were given and have stopped working on — a fix, a
feature, an audit, an investigation, a refactor, a PR opened / updated / merged, or
work that is blocked or abandoned — on **any** branch or worktree, by **any** agent
(main session, subagent, fleet member, scheduled run). Answering a question or doing
a single lookup that changes nothing is not a job.

When a job ends, your final message must carry the nine sections below, **in this
order, under these headings**. A small job gets short sections, but **no section may
be dropped** — if one is genuinely empty, keep the heading and write "None." Every
fact must come from a command you actually ran this session; anything you did not
verify is labelled **not verified** rather than left implied.

1. **Where we are** — branch / worktree name, PR number + link and its state (draft /
   open / merged / closed), CI state by named check (green / red / pending / not run),
   whether the work is on `main`, and whether anything is deployed. Facts as of now,
   not expectations.
2. **What we did** — the original ask restated in the maintainer's terms, including
   anything added mid-flight, and the practical result it was meant to produce; then
   the change list **by file path**, one line of *why* per file. Not "I updated the
   layers panel."
3. **Goal status** — **achieved / partially achieved / not achieved**, with the
   evidence behind that word. Never "achieved" while required work remains.
4. **What was verified — and what was NOT** — the commands actually run and their
   results (`pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` — counts
   and pass/fail), then the gap stated plainly: no perceptual render, no hardware
   air-cut, no E2E, mock-only. Green tests are never evidence a feature works.
5. **How it works now** — the finished user-facing behavior: what the maintainer will
   see, where in the UI, how to operate it, what to expect, and the limits that remain.
6. **What's next — numbered steps** — **Step 1, Step 2, Step 3 …** in the order they
   should be done. Each step gives the exact action (a command in a fenced block, a
   file path, or a click path), why it comes next, what a good result looks like, and
   what to do if it fails. No "consider", "maybe", or "look into" — every step must be
   executable exactly as written by someone who did not watch the session.
7. **What else we could do** — the optional list, kept strictly separate from section 6
   so *must* is never confused with *could*: adjacent work, deferred items, follow-ups.
   One line each, with its cost and its payoff.
8. **How to improve** — the honest quality read: risk this change introduces, debt
   taken on, tests not written, the same pattern that may exist elsewhere in the tree,
   and what a better version would look like with more time.
9. **Recommended action:** — one line, the single best next step, no menu. If a genuine
   either/or is the maintainer's call, name your recommended option first and label it
   as recommended, then the alternative in one line.

Blocked or intentionally incomplete work uses the same skeleton — name what is missing
under **Goal status** and exactly what unblocks it under **What's next**. If the job
touched more than one branch, the report covers each branch by name. This report is
written for the maintainer, not as a changelog: a diff, test log, commit, deployment,
or pull-request link is supporting evidence **inside** it, never a replacement for it.
