## ADR-689 - Job Review says "Before you start": glasses, focus, supervision and fire, on the PC and the phone

**Status:** Accepted. Fixes UX audit findings U4-P2-1 (P2) and U4-P2-2 (P3 after the refuter)
(`docs/audits/2026-11-03-ux-u1/U4-first-burn.md`). Builds on ADR-224 (Job Review is the one pre-burn
checkpoint) and stays inside ADR-228 rule 7 and ADR-565: this is wording, not a guard. Tested in the
Job Review component, the remote review projection and the Learn catalogue, including a Start
through the dialog whose G-code is byte-identical with the block open or folded; not burn-tested.
Frame, Start policy, output, G-code and licences are unchanged. | **Date:** 2026-11-03

### Context

- **U4-P2-1.** Between installing and a 16-minute fill burn, nothing on a beginner's path said to
  wear laser glasses, watch for fire or stay with the laser. A laser session with `$32=1` verified
  got no acknowledgement section at all (`JobReviewAcknowledgement` returns null), so its Job Review
  had no safety words. KerfDesk's own "Never leave a running machine unattended. Watching on a
  camera, phone or remote connection is NOT supervision" lived only under Help → Safety & liability
  and About. The Learn lesson "Frame, review and start the exact job" said nothing either. The app
  said "Wear laser safety glasses" only for the low-power positioning dot. LightBurn's first-project
  page says "Never run your laser unsupervised"; MillMage shows in-app warnings.
- **U4-P2-2.** Focus guidance was one grey line under the jog pad, "Manual focus: adjust the laser
  head by hand.", with nothing about how, a focus gauge or material thickness. An unfocused diode
  burns faint, and a beginner blames power and speed.
- **The phone remote.** A remote Start shows the review's stats, warnings and acknowledgement prompt
  and starts from a slide. A verified laser projected no prompt, so the phone showed no safety words
  either, and a phone is exactly where "a camera or phone is not supervision" matters.

### Decision

1. **Every laser and CNC Job Review for a Start shows a "Before you start" block** above the
   acknowledgement and **Start job**, whatever the laser-mode state, including a painted second
   pass. A Frame review (tool off) does not show it. Laser:
   - Wear laser safety glasses rated for your laser's wavelength.
   - Focus the laser on the top of your material. The gap changes with the material's thickness.
   - Stay with the laser while it runs and keep a fire extinguisher close. A camera or phone is not
     supervision.
   - Use air assist and ventilation.

   CNC:
   - Wear eye and ear protection.
   - Clamp the material down and keep the clamps clear of the toolpath.
   - Stay with the machine while it runs, hands clear of the bit. A camera or phone is not
     supervision.

   The CNC workholding attestation (ADR-224) is unchanged; the block is the plain short form.
2. **It starts open and may be folded.** Folding is remembered per machine on this computer,
   keyed by the profile id or, without one, the machine name
   (`laserforge.job-review.before-you-start-folded.v1:<profile id or name>`), so a machine never
   folded, such as a newly set-up one, shows it open. It never disappears: the folded summary
   still reads "Before you start". Folding changes nothing the review hands off.
3. **The phone remote and MCP get the same points** as the review's acknowledgement `prompt`:
   "Before you start: …" alone for a verified laser, or ahead of the prompt the operator confirms so
   its question stays last. Every deployed phone page and the MCP machine view already show
   `prompt`, so no Worker deploy is needed. The acknowledgement `kind` and Start's evidence are
   unchanged.
4. **Not a guard.** Nothing is acknowledged, counted or recorded; Start, Frame and the Job Review
   gate behave as before (ADR-228 rule 7, ADR-565).
5. **Focus says how.** With no powered Z and no auto-focus command, the hint under the jog pad reads:
   "Manual focus: before each job, set the gap between the laser and the top of your material with
   the focus gauge or spacer that came with your laser (see its manual), then tighten the head.
   Thicker material needs the head raised."
6. **The Learn lesson "Frame, review and start the exact job"** gains a **Focus on this material**
   step (gauge or spacer, material thickness, CNC Z zero on the stock top) and a **Before you start**
   step with the laser and CNC points. It now takes 5 minutes.

### Alternatives

- **A checkbox or confirm before Start.** Rejected: ADR-228 rule 7 and ADR-565 keep Frame as the
  sole ordinary Start guard, and AGENTS.md keeps policy findings as warnings.
- **Fold after N completed jobs.** Rejected for now: a count is new state with its own failure
  modes, and an explicit fold by an experienced operator is simpler and per machine.
- **Add the block to the phone page itself.** Rejected for now: it needs a Worker deploy and leaves
  older phone pages without it; the prompt reaches all of them today.
- **Put the points in the warnings list.** Rejected: they are the same every job, and the warnings
  list counts things to check about this job.

### Consequences

- A first burn's review names glasses, focus, supervision and fire, or eye/ear protection, clamps
  and supervision for CNC, on the PC and on the phone.
- The phone's acknowledgement prompt is now always present. Its text is longer for unverified and
  CNC reviews; it stays under the MCP schema's 2048-character message bound.
- Wording only: no G-code, Frame, Start or controller behaviour changes.
