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

# RESEARCH BEFORE YOU ANSWER — never reason your way to a fact

(Maintainer, 2026-07-25. Canonical source: `CLAUDE.md` collaboration rule 9.
Restated here in full so it is self-contained.)

An unverified belief is not a deliverable. The moment you are about to write
"I believe," "typically," "should be," "probably," "I think GRBL/LightBurn/that
library does X," or "I have not verified this, but" — **stop and go find out
before you answer.**

Research in this order: read the code in this tree → run the actual command →
read the vendor's own documentation or firmware source → search the web for the
authoritative source. Then **cite what you found** (`file:line`, command output,
or URL) so the maintainer can check it.

- Never substitute plausible reasoning about how something *probably* works for
  the documented fact.
- Never hand the maintainer a belief for them to go verify when a search would
  have settled it in a minute. "Please check X and paste it back" is only
  acceptable for facts **only they can supply** — what hardware is plugged in,
  what the machine physically did — never for anything documented.
- If research genuinely fails, state exactly what you consulted and what is
  still open: "I read X and searched Y; the answer is in neither." Never a bare
  "I don't know," and never a guess dressed up as a finding.

This binds hardest **outside** this repo — GRBL/grblHAL behavior, controller
firmware, LightBurn semantics, third-party APIs — because that is precisely
where nothing in the tree will catch the mistake for you.

---

# Agent completion reporting rule

## Required final handoff

When a job is finished, the final response must explain the outcome from the user's perspective. It must include all four of the following sections:

1. **Original request** — Restate what the user originally asked for. Account for the full request, including important additions made while the work was in progress, rather than describing only the last technical step.
2. **User goal** — Explain the practical result the user wanted to achieve and why the work was requested.
3. **Goal status** — State explicitly whether the goal was **achieved**, **partially achieved**, or **not achieved**. Support that status with the most relevant verification evidence. Never call a goal achieved while required work remains.
4. **How the final product works** — Describe the finished user-facing behavior, how the user operates it, and what they should expect. Mention important limitations or remaining work when applicable.

Use clear headings for these four sections. A technical change list, test summary, commit, deployment, or pull-request link may be included as supporting evidence, but it does not replace the required user-focused handoff.

If the job is blocked or intentionally incomplete, use the same structure and state exactly what remains before the goal can be achieved.
