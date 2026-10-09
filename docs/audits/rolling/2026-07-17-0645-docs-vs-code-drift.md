# Rolling audit — docs-vs-code drift (DECISIONS.md / WORKFLOW.md / PROJECT.md / CLAUDE.md)

- **When:** 2026-07-17 06:45 (+08)
- **Tree:** audited against **`origin/main` @ `ed40b6d5`** (the audit branch's own base predates the #252 ADR-index backfill, so all claims here were re-verified against fetched main, not the stale branch base).
- **Scope:** ADR referential integrity (every `ADR-NNN` cited in `src/`, `electron/`, WORKFLOW.md, PROJECT.md, CLAUDE.md vs the DECISIONS.md body), index-table ↔ body consistency, topic-match of WORKFLOW.md citations, CLAUDE.md's enforcement claims vs `eslint.config.mjs`, PROJECT.md cross-references.
- **Method:** mechanical set-diff of referenced vs defined ADR numbers + sampled topic checks + config reads. **Not verified:** full topic-match of every citation in the 125–204 range (sampled only); WORKFLOW.md flow-content accuracy against actual UI behavior (that is a per-feature audit, not a drift check).
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P3-1 — test files are exempt from module-boundary enforcement; CLAUDE.md states the rule without the carve-out

CLAUDE.md's "Imports — boundaries enforced" section presents the core/io/platform/ui matrix as absolute ("Enforced by eslint-plugin-boundaries. Violation is a CI fail"). In fact `boundaries/ignore` excludes **all** `**/*.test.ts`, `**/*.test.tsx`, and `src/__fixtures__/**` ([eslint.config.mjs:33-41](../../eslint.config.mjs)) — a test anywhere may import across any boundary (e.g. a `core/` test reaching into `ui/`) with no CI signal. The `src/ui/app/main.tsx` composition-root exception is documented in-config (ADR-011), but the blanket test exemption appears nowhere in CLAUDE.md. Either document the exemption or narrow it; today the doc overstates the guarantee.

---

## P3-2 — PROJECT.md's status headline is 12 ADRs stale

The header reads "**Status:** v3.4 — named artwork operations (ADR-211)…" while the DECISIONS.md tail on main is ADR-223; twelve accepted ADRs (212–223, incl. fail-dark boundaries, pass-boundary CNC recovery, and the whole canvas-badge family) postdate the last status bump. Cosmetic, but this line is the first thing the session-start read-in-order surfaces, and it currently misstates where the product is.

---

## Verified clean (checked, no finding) — the headline of this iteration

- **ADR referential integrity is complete:** the set-diff of every `ADR-NNN` referenced across `src/`, `electron/`, WORKFLOW.md, PROJECT.md, and CLAUDE.md against DECISIONS.md body headings has **one** apparent orphan — `ADR-054` — and that is PROJECT.md's own historical note explaining the reserved 054..091 ticket block, not a dangling citation.
- **Index table ↔ body agree through ADR-223** on main: the #252 backfill landed (214, 216–220 present), and the three-way tail collision from PRs #245/#247/#250 resolved cleanly (221 elapsed-time badge, 222 single-artwork selection, 223 Canvas Focus layouts) with matching titles in both places. The apparent "duplicate ADR-211" is a deliberate `Amendment` heading, correctly reflected as "Amended" in the index.
- **WORKFLOW.md citations topic-match their ADR titles** across the sampled 003–124 range and the full collision-prone 205–223 tail (checked line-by-line); the feed-rate misreference class fixed by #243 has no surviving siblings in the tail.
- **CLAUDE.md's enforcement claims are real:** the import-boundary matrix matches `boundaryRules` exactly ([eslint.config.mjs:45-58](../../eslint.config.mjs)); `import/no-cycle: 'error'` exists (line 128); `@typescript-eslint/no-floating-promises: 'error'` exists (line 194); the release-gate description was verified in iteration 2.
- **CLAUDE.md ↔ PROJECT.md cross-references hold:** non-negotiable #21 is the guard rule and cites ADR-206, whose DECISIONS.md entry exists with the matching title ("Require explicit maintainer permission for every new guard"); #16's "CI does not enforce" phrasing on co-located tests agrees with CLAUDE.md's caveat.
- **Naming contract is documented, not drift:** KerfDesk (product) vs LaserForge-2.0 (repo) vs `laserforge` (Pages project) is an explicit PROJECT.md contract — consistent with the repo-guard allowlist audited in iteration 2.

## Not verified

- Topic-match sampling did not cover every citation in the ADR-125–204 range.
- WORKFLOW.md's flow *content* (do the described flows match the shipped UI?) is out of scope for a drift check and remains per-feature audit territory.
