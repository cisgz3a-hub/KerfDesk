## ADR-215 Amendment 2 - CNC recovery checks Work Z against the bit its own program starts with (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27
**Fixes:** rolling audit v4 H3-P1-1 (P1), confirmed by an independent refuter and re-verified on
main `105d6374c`.

### Context

CNC recovery qualifies the archived job as Start does (`prepareArchivedRecoverySource`). Start's
qualification adds one Work Z advisory: the job's first bit against the bit Work Z was set for
(`inspectPreparedStart` passes `cncToolPlan(prepared.job)[0]` to `cncWorkZeroToolStartIssue`).
That is the whole job's first bit. Pass recovery (this ADR) can resume in a later operation, and
then it streams only that operation's passes and bits, with no `M0` before them.

A 1/8" → 1/4" job resumed at operation 2 streams only the 1/4" (`em-6350`) passes:

- With the 1/4" bit zeroed, the only message said "Load 3.175 mm (1/8")": the wrong bit.
- With the 1/8" bit still zeroed, nothing named a bit, and the 1/4" passes ran at the 1/8" bit's
  Z zero. Nothing checked the bit at stream time either.

Supervised (runway) recovery is single-bit only (`jobAllowsSingleToolRunway`), so there the whole
job's first bit was the right one, but its check was advice too.

### Decision

1. **Recovery checks its own first bit.** Each CNC recovery flow checks Work Z against the first
   bit of the program it streams: pass recovery against the resumed job
   (`buildCncPassResumeJob`), supervised recovery against its runway job
   (`src/ui/laser/cnc-recovery-start-bit.ts`).
2. **A mismatch refuses recovery.** "Cannot start CNC recovery: The recovery program starts with
   6.35 mm (1/4") end mill, but work Z was established for 3.175 mm (1/8") end mill. Load …,
   select it as the Active bit, then touch it to the stock top and Zero Z — or probe again." It
   is checked after the program is built and before the claim, so nothing is sent and the saved
   job stays retryable. Zeroing or probing with that bit clears it. This is a recovery refusal,
   not an ordinary Start policy gate: ordinary Start keeps the advisory in Job Review (ADR-565).
   The final recovery assertion already refuses any Work Z change after the check
   (`controllerStartPreparationStillCurrent` compares `workZZeroEvidence`), so the zero checked is
   the zero that streams.
3. **The whole job's advisory goes from recovery.** `prepareArchivedRecoverySource` drops Start's
   first-bit advisory from the warnings it hands recovery, so no recovery dialog names the wrong
   bit. With no Work Z at all, the existing no-work-zero warning still applies, unchanged. A
   sealed job whose first bit has no tool id keeps Start's "does not identify its first bit"
   warning and is not refused: it cannot be recompiled, and no bit can be checked.
4. **Start from line stays refused for CNC.** `runStartFromLineFlow` refuses every CNC project
   (ADR-143, ADR-200) and the panel shows CNC guidance instead, so it cannot run a later bit on an
   earlier bit's zero. A regression test pins it.

### Consequences

- A multi-bit pass recovery that resumes in a later operation needs that operation's bit zeroed
  and selected as the Active bit; a resume in the first operation needs the first bit, as before.
- Regression tests: `cnc-recovery-start-bit.test.ts` (through `saveInterruptedRun` →
  `runCncPassRecoveryFlow`, and `runStartFromLineFlow` on a two-bit project).
- Not hardware-tested.
