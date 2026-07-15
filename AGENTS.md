# Agent completion reporting rule

## Required final handoff

When a job is finished, the final response must explain the outcome from the user's perspective. It must include all four of the following sections:

1. **Original request** — Restate what the user originally asked for. Account for the full request, including important additions made while the work was in progress, rather than describing only the last technical step.
2. **User goal** — Explain the practical result the user wanted to achieve and why the work was requested.
3. **Goal status** — State explicitly whether the goal was **achieved**, **partially achieved**, or **not achieved**. Support that status with the most relevant verification evidence. Never call a goal achieved while required work remains.
4. **How the final product works** — Describe the finished user-facing behavior, how the user operates it, and what they should expect. Mention important limitations or remaining work when applicable.

Use clear headings for these four sections. A technical change list, test summary, commit, deployment, or pull-request link may be included as supporting evidence, but it does not replace the required user-focused handoff.

If the job is blocked or intentionally incomplete, use the same structure and state exactly what remains before the goal can be achieved.
