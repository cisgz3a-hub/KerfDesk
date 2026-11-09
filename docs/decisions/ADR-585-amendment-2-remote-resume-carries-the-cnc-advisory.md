## ADR-585 Amendment 2 - A remote Resume carries the PC's CNC Resume advisory (2026-11-09)

**Status:** Accepted (rolling audit v11 finding W2-P2-1, confirmed by the refuter with a repro and
rated P1 for its FluidNC branch; the maintainer's standing instruction to fix confirmed audit
findings). Amends ADR-585's `pause_job` / `resume_job` row. | **Date:** 2026-11-09

### Context

ADR-585's table promises the remote `pause_job` and `resume_job` "with their controller
confirmation, laser-mode and door rules". For a paused CNC job the laser-mode rule is an advisory,
not a refusal: the PC shows `cncResumeAdvisoryNotice` in the paused job panel
(`JobRunControls.tsx`) and as the Resume button's title (`LiveMotionBar.tsx`). ADR-180 Amendments 5
and 7 wrote that text:

- On FluidNC, KerfDesk never lifts the bit, and Resume waits only the spindle's `spinup_ms`, which
  is 0 unless set. With no wait, the bit stopped in the kerf is fed along the cut at cutting feed
  while the spindle is still speeding up. Prefer ABORT JOB.
- With laser mode on (`$32=1`), or `$32` unconfirmed, GRBL and grblHAL skip the spin-up delay, and
  the stopped bit is pushed through the cut. Prefer ABORT JOB.
- With a lift, or stock GRBL at a confirmed `$32=0` (a 4 s door delay), the text only informs.

The remote path never read that advisory. The phone showed "Paused" and a one-tap Resume, and
`get_machine_status` reported `availability.resume: { available: true }` with no text. Resume sent
`~` and the receipt said "Resumed.". The refuter reproduced it with the real adapter on a
simulated FluidNC router at `$32=0`. The P1 rating follows J3-P2-3: the only warning is on a PC
screen that the phone operator is not looking at. Standing at the machine does not show the
firmware's spin-up setting either.

### Decision

1. **The status carries the advisory.** While a CNC job is paused, `get_machine_status` reports
   `job.resumeAdvisory: { message, confirmation? }`. `message` is the PC's advisory word for word,
   from the same store selectors the PC reads (`machine-resume-advisory.ts`), so it changes when
   the PC's text changes, for example as a lift moves through its phases.
2. **Where the PC prefers ABORT JOB, a remote Resume needs the warning confirmed.** That means
   FluidNC (both of its texts), and a laser mode that is on or unconfirmed, with no lift holding
   the bit. There, `confirmation` is an 8-hex-digit code for this warning text and this job
   (FNV-1a over the stream epoch and the text). `resume_job` takes an optional `confirmAdvisory`.
   A Resume without the current code is refused before anything is sent. The receipt is `failed`
   and carries the warning text and "To resume anyway, confirm this warning; otherwise abort the
   job." A stale code, from a warning that has since changed, is refused the same way. The code
   is a tag, not a secret: it proves the caller read the warning now in force, not who the caller
   is. Admission and approval are unchanged.
3. **Where the PC only informs, so does the remote.** A lifted bit, a lift in progress, and stock
   GRBL at a confirmed `$32=0` get the `message` without a `confirmation`, and Resume works as
   before. The PC never refuses Resume (PROJECT.md non-negotiable 21). The remote confirmation
   stands in for the screen the remote operator cannot see. It is not a new refusal: a confirmed
   Resume runs the same `resumeJob()`.
4. **The Pause receipt says what Resume will do from here.** On CNC it is "Paused." followed by
   the current advisory, which is where the PC's Pause title says the bit stays in the cut on
   FluidNC. Laser receipts stay "Paused.".
5. **These policy texts are not filtered as artwork.** The advisory is fixed desktop policy text,
   plus a lift skip reason. Receipts that carry it (`policyMessage`) are bounded by `safeLabel` at
   2048 characters. They do not go through the private-label filter, which would replace the
   whole warning if a layer happened to be named "cut" or "bit". The status field is projected the
   same way.
6. **The phone shows it and asks for a slide.** The paused card shows the advisory as a warning
   banner. Where a confirmation is required, Resume opens a sheet with the warning, says that the
   PC recommends Abort (the dock at the bottom), and resumes only on "Slide to resume", the same
   gesture as Start. A refused Resume's receipt is shown on the card.
7. **MCP.** `resume_job`'s description tells agents to relay `job.resumeAdvisory.message` to the
   user word for word, and to pass `confirmAdvisory` only after the user confirms. `pause_job`
   says the receipt and status describe what Resume will do. The input and output schemas in
   `electron/mcp/machine-schemas.ts` carry both fields. The relay Worker bundles these schemas.

### Consequences

- A phone or MCP operator sees the same Resume warning as someone at the PC, and the cases where
  the PC prefers Abort cannot be resumed with one unwarned tap.
- An older phone page or MCP client that does not know `confirmAdvisory` can still Pause and Abort.
  Its Resume of a FluidNC or laser-mode CNC job is refused with the warning text; it can Resume
  laser jobs and informing-only CNC states as before.
- **Worker redeploy required.** The phone page (`public/app`, the MCP Apps resource) and the
  Worker's bundled schemas change. Until the Worker is redeployed, a deployed Worker parses
  `get_machine_status` with its old schema, which strips `job.resumeAdvisory`, and its strict
  `resume_job` input schema rejects `confirmAdvisory`. So through an old Worker a remote Resume of
  a paused FluidNC or laser-mode CNC job is refused (failing safe), with the warning text in the
  receipt, until the redeploy. Abort is unaffected.
- The Start review now also names FluidNC's `spinup_ms` (ADR-180 Amendment 8), so the operator
  learns it before the job runs, on the PC and in the phone review.
- Not covered: W2-P3-4 (the phone calls a CNC tool-change hold "Running"), and the Marlin
  stream-side Pause note, which is P3 on its own.
