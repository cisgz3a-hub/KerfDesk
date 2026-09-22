## ADR-344 - New decisions are one file each, not appended to DECISIONS.md (2026-09-22)

**Status:** Accepted. | **Date:** 2026-09-22

### Context

Every decision has been appended to the end of a single 21,000-line
`DECISIONS.md`. Two branches that each add a decision therefore add different
content at the *same* end-of-file position, and git cannot merge that — it is a
conflict by construction, every time, no matter how small or unrelated the two
decisions are.

This is not theoretical. It is a recurring, named cost in this repository:

- 2026-08-02 recorded that with a ~20 minute fleet merge cadence against a ~30
  minute gate, "ADR-appending PRs never green AND conflict-free".
- 2026-09-21 minted ADR-323 four separate times, because the gate only reads the
  branch it runs on.
- On 2026-09-22, PR #831 passed all three checks and then failed to merge
  anyway: ADR-342 and ADR-343 landed in the gap between CI going green and the
  merge command, and all three had appended to the same place.

The number-uniqueness gate already exists and works, but it solves a different
problem. It catches two branches claiming the same *number*; it does nothing
about two branches writing to the same *position*. The second failure is the
common one, and it costs a full CI cycle each time because the conflict only
surfaces after the checks that took ~50 minutes.

### Decision

**New decisions are one file each under `docs/decisions/`**, named
`ADR-<number>-<slug>.md`, or `ADR-<number>-amendment-<n>-<slug>.md` for an
amendment. Two branches adding two decisions now write two different files and
have no shared position to conflict over.

- **`DECISIONS.md` is frozen as the historical record**, not migrated. It holds
  ADR-001 through ADR-343 and keeps working exactly as it does today. Splitting
  289 existing entries would churn every `DECISIONS.md#adr-NNN` anchor in
  `WORKFLOW.md`, every line reference in past audits, and every reader's habits,
  to fix a problem that only affects decisions not yet written.
- **Amendments to historical entries may still be written in place** in
  `DECISIONS.md` when they are genuinely edits to an existing entry's text.
  A *new* amendment section goes in its own file like any other new decision.
- **`scripts/check-adr-numbers.mjs` reads both sources** and enforces
  uniqueness across the pair, so numbering stays global and "next free number"
  stays correct. It additionally rejects a `docs/decisions/` file whose heading
  number disagrees with its filename, since one decision per file is the
  property that makes conflicts impossible.

### Consequences

- Two decisions landing the same day stop conflicting. The remaining ADR race is
  the *numbering* one, which the gate already detects — and a rename is a far
  cheaper fix than a rebase and a second 50-minute CI cycle.
- `DECISIONS.md` stops growing. It is already 21k lines and had become slow to
  grep, slow to diff, and a guaranteed merge hotspot.
- Decisions become individually greppable by filename, and a decision's history
  is its own file's history rather than a moving offset inside a shared one.
- The record is split across two locations, which is a real cost. The gate's
  output names both, and `DECISIONS.md` carries a pointer at the top so nobody
  has to infer where a new decision went.

### Alternatives rejected

- **A `merge=union` driver on `DECISIONS.md`:** rejected, and it was tempting —
  one line in `.gitattributes` makes concurrent appends concatenate instead of
  conflict. But union merge applies to every conflicting hunk in the file, not
  just appends at the end. Two branches editing the same existing entry would
  have both versions silently interleaved, with no marker and no failure. A
  docs-as-spec file that can silently self-corrupt is worse than one that
  conflicts honestly.
- **Migrating all 289 existing entries:** rejected — see above. The problem is
  entirely in front of us, so the fix belongs there too.
- **Date-based identifiers (`ADR-2026-09-22-slug`) to kill the numbering race
  as well:** rejected for now — roughly 300 code comments reference `ADR-NNN`,
  and the numbering race is already caught mechanically. Worth revisiting on its
  own rather than bundled into this change.
- **Keeping appends and merging more often:** rejected — the repository should
  not impose a merge-rate ceiling on itself to work around a file layout.

### Verification

- `scripts/check-adr-numbers.test.mjs` covers both sources: a decision in each
  with distinct numbers passes; the same number claimed once in each is caught
  as a duplicate and names both locations; an amendment file still re-uses its
  number without counting as a collision; a misnamed file and a heading that
  disagrees with its filename both fail; and the legacy-only layout still
  passes unchanged, under both LF and CRLF.
- The gate runs clean against the real repository and reports decisions from
  both sources.
- This decision is itself the first file under `docs/decisions/`, so the scheme
  is exercised by its own landing rather than only by tests.
- **NOT verified:** that two same-day decisions now merge without conflict —
  that can only be observed the next time two land together. The mechanism is
  structural (different paths cannot share a conflict position), not behavioural.
