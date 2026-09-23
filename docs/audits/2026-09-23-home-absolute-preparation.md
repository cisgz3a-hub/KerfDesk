# Home, Absolute Coordinates and preparation ownership

Reported on kerfdesk.com at build `90c791c5`; repair based on `04252e8a6`.
The live page was inspected read-only. No machine command was sent by this audit.

## Reproduced defects

- Absolute placement rejected a known custom work offset before the existing
  native-to-bed translation could compensate it. Tests using the reported
  X200.398/Y170.323 offset failed before the change for both mm and inch reports.
- Home incorrectly assumed an earlier G92 origin had disappeared, while an
  earlier unknown/persistent origin could remain active even after fresh zero WCO.
  Home establishes machine position; a fresh offset report establishes offset truth.
- Preparation compared optional MPos/WPos fields independently and treated the
  first explicit zero WCO as a change from its existing no-origin zero assumption.
  Six baseline regressions failed, including a live owned-worker cancellation case.
- The Idle report that settles Home has deliberately suppressed coordinates.
  Starting compilation before the following normal position/WCO report could
  invalidate the new compilation without an artwork or machine setup edit.
- Frame completion and the final Start handoff rejected equivalent rounded
  MPos/WPos reports, especially with inch reporting. Nine baseline regressions
  failed, also exposing a missing final-handoff report-unit identity check at zero.

## Repair

Absolute output subtracts the observed work offset. When the native bed mapping
is known, it also subtracts that translation exactly once. An unknown bed mapping
retains the existing advisory and native-coordinate target, with WCO compensation.
Preview, Frame and the prepared program share the placement calculation.
No G92/G10 reset is added, and a missing live custom offset is never guessed.

Home retains prior origin provenance as unknown until fresh WCO reconciles it.
Fresh zero XY clears only unknown provenance; an explicitly set zero origin stays
meaningful. Offset classification uses mm while the raw reporting-unit cache is
preserved. Frame queries briefly for the fresh post-Home position/offset before
capturing compilation inputs, with a bounded timeout and session/position checks.

Equivalent controller report representations preserve preparation. Conversion
allows only the report-rounding difference at a stable nonzero offset. Direct
same-format movement, changed offsets, report units, sessions, origin/Z evidence
and output edits still invalidate it. Final Frame completion and Start retain
their exact-offset handoff checks. They accept one reporting tick only for the
nonzero-offset representation conversion, retain the existing direct-position
tolerance, and bind report units even when every coordinate is zero.

## Evidence and limits

Focused suites cover physical-coordinate algebra, explicit/unknown zero origins,
retained nonzero offsets, inch reports, incomplete Home reports, bounded waits,
worker ownership and changed-input rejection. The Falcon simulator checks the
Frame envelope and that Start sends the complete sealed program with the retained
offset. The browser regression now exercises Sharp, Preview, Home with a retained
offset, and a status-format switch while the real preparation worker is active.

The broader sequential cohort passed 269 tests across 23 files after two old
physical-safety fixtures were corrected to provide the required post-Home WCO.
The final Frame/Start representation cohort passed 58 tests across three files.
Two independent code reviews found no remaining actionable issue.

The original `C:\Users\Asus\Desktop\Owl.png` passed the combined Chrome test on
the branch integrated with main `57a5a55a7`: Sharp, commit, Preview, scrub/play/pause,
Home with X200.398/Y170.323 WCO, three Frame clicks, and an equivalent WPos report.
The run finished in 2.8 minutes with 14,389 contours / 494,902 vertices preserved,
no renderer crash or page error, neither preparation toast, and no G92/G10 writes.
The rendered final page showed “Ready to start — framed job unchanged”.
The image SHA-256 was
`7e9c682821fbb079dabb29535dc85f71e47fc6008bfb38fb35257f808664a6c5`.
Stage JSON and screenshots are under `artifacts/absolute-home-owl-complete/`.

An initial parallel validation batch exhausted host memory: TypeScript, Prettier
and esbuild reported allocation failures, and the owl browser run timed out while
still tracing. Those attempts are not passing evidence. Validation was reduced
to sequential runs. Local browser evidence is kept under ignored `artifacts/`.
Two intermediate browser attempts exposed test harness issues: a summary element
was addressed as a button, and a short action timeout also constrained cold page
navigation. The final run uses the real summary and a separate navigation timeout.

These are software and simulated-controller checks. No physical Home, Frame,
engraving, material run or hardware qualification was performed by the agent.
