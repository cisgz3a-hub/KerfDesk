## ADR-341 Amendment 1 - Sweep boundaries, beam-mode economy and a background restart preview (2026-09-22)

**Status:** Accepted. | **Date:** 2026-09-22

Moved verbatim from `DECISIONS.md`, where it was appended under ADR-341 after ADR-344 had
frozen that file. ADR-344 gives a new amendment section its own file, as ADR-341 Amendments 2
and 3 already have. The text below is unchanged.

Post-merge audit follow-up to PR #829. No decision above changes; these corrections make the
emitted output and the restart preview honour it.

1. A sweep also ends where a laser-off feed move leaves the current line. Such a move is a
   repositioning (the controlled-dark row change, emitted at the layer speed when the profile's
   travel feed equals it), not a runway. The move after that turn starts its own sweep unless it
   continues the turned line, in which case the turn was a runway and stays with the burn it
   feeds. Rows joined by `G1 … S0` travel at the engraving feed are therefore omitted one by one,
   as §3 requires, and the sweep's beam-off approach keeps the travel's feed word. A Falcon image
   with equal travel and engraving feeds is covered by an oracle test.
2. Derived output re-arms the beam only when the mode changes and ends with one `M5`. Every
   positioning move already carries `S0`, which keeps the beam dark in M3 and M4, so GRBL-family
   firmware no longer drains its planner around each selected sweep. §3 "position with the beam
   off" is unchanged in effect. Because §6 requires byte-exact re-emission, painted passes
   archived before this amendment (emitted with per-sweep beam words) stay in history and remain
   exportable but no longer reproduce, so their recovery and reuse as a second-pass source are
   refused with the existing lineage message; original archives are unaffected. The feature had
   not run on hardware, so no writer version is retained for them.
3. The restart picker derives its route from the sealed G-code in a dedicated worker and consumes
   it in packed columnar form; no object per sampled point is built on the UI thread and the
   review dialog stays responsive while a large image route is prepared. The line-number field is
   usable meanwhile, a worker failure falls back to line numbers, and the route is retained for the
   artifact's lifetime. Environments without workers keep the previous synchronous derivation.
4. At the final Start boundary a second-pass permit's execution signature is bound to its sealed
   lineage (source run and exact selection of the last stage) instead of being compared with
   itself.
5. Framing a painted pass while an ordinary canvas Frame is armed tells the operator that the
   canvas Frame was replaced. The completion prompt and workbench copy name cutting deeper as well
   as engraving darker, because a completed vector cut may also be repeated.
