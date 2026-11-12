## ADR-237 Amendment 4 - Run again also carries a review that rests on the operator's power-scale statement (2026-11-11)

**Status:** Accepted with [ADR-095 Amendment 1](ADR-095-amendment-1-the-operator-states-a-power-scale-the-firmware-does-not-report.md),
for finding B3-P2-1 of user annoyance audit A2. | **Date:** 2026-11-11

**Amends:** [ADR-237 Amendment 3](ADR-237-amendment-3-run-again-carries-an-unchanged-review.md),
decision 1.3 ("its acknowledgement is `laser-verified`") and decision 4 ("the provenance
validator accepts `carriedOver` only on a `laser-verified` ordinary Start"). Every other
condition of Amendment 3 is unchanged.

### Context

Amendment 3 lets Run again start an unchanged, already-reviewed laser job without showing Job
Review, when the review "needs no answer". It named one such review: a verified laser. A Marlin
or Smoothieware laser can never be verified, because the firmware reports no power scale, so
those machines never got the shortcut.

ADR-095 Amendment 1 adds a second review that asks nothing: one where the operator has recorded,
for this machine profile, that they checked the power scale. Job Review then shows a fact line
and no acknowledgement.

### Decision

1. **A review asks nothing when its acknowledgement is `laser-verified` or
   `laser-operator-stated`.** Run again carries either, under all of Amendment 3's other
   conditions: a laser, the desktop button, the completed run's exact program, the same warning
   set, no machine-type question, the same app and controller session.
2. **The carried run's evidence is its own.** It is built from the fresh preparation, so it
   carries the statement again and is archived as `laser-operator-stated`. A statement that no
   longer stands gives a `laser-unverified` review, which is never carried.
3. **The validator accepts `carriedOver` on either kind**, and on no other.

### Consequences

- Repeating an unchanged job on a Marlin or Smoothieware laser is one press, once the operator
  has stated the power scale.
- Making or clearing the statement is a profile edit, so the completed run's inputs no longer
  match and Run again does not repeat that run. Start reviews the job.
- `PROJECT.md` non-negotiable 21 already says "when its freshly built review asks nothing"; it
  needs no change.

### Evidence

- `run-again-review-carry.operator-stated.test.ts`: before the statement Run again shows Job
  Review; after it Run again starts with no dialog, sends the completed run's bytes and
  archives `laser-operator-stated` with `carriedOver`; after the statement is cleared nothing
  is carried.
- `execution-operator-stated-validation.test.ts`: `carriedOver` is valid on `laser-verified`
  and `laser-operator-stated` only.
- The existing `run-again-review-carry` suites pass unchanged.
