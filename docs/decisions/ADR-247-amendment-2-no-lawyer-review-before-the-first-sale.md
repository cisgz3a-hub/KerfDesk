## ADR-247 Amendment 2 - No lawyer's review before the first sale (2026-09-29)

> **Current publication scope (8 October 2026):** The owner decision about lawyer review remains recorded here. The finished public information and separate local commercial drafts are now defined in [publishing notes](../legal/publishing-notes.md), as implemented on main by PR #1083. The historical review below does not make a draft published or effective.

**Status:** Accepted | **Date:** 2026-09-29 | **Amends:** ADR-247 "Consequences"; ADR-114's
consequences; ADR-543 decision 6

### Context

ADR-247's consequences say a first sale requires a new lawyer-reviewed commercial decision that
meets its cutoff, contributor-rights, notice and release requirements. ADR-114 says the EULA must
be reviewed by a lawyer before the first sale, and ADR-543 decision 6 says a lawyer's review of its
contributor-rights audit follows before the first sale. The customer documents in `docs/legal/` ask
a South African and a US lawyer to check the clauses listed in `docs/legal/lawyer-review-notes.md`.

The owner is preparing the first sale through Paddle, whose website review needs the Terms,
Privacy and Refund pages live (ADR-524 Amendment 3). On 2026-09-29 he decided against a lawyer's
review: "Im not getting a lawyer to check. you make sure its correct by law" (14:15 UTC).

### Decision

1. **No lawyer's review is required before the first sale.** The owner's decision replaces the
   lawyer's review in ADR-247's consequences, ADR-114's consequences and ADR-543 decision 6. The
   rest of ADR-247 stands: ADR-543 set the cutoff (the `mit-final` tag) and recorded the
   contributor-rights audit, and the notice and release requirements still apply to every release.
2. **Claude checks the legal texts instead.** Before a customer-facing legal text is published or
   changed, Claude checks it clause by clause against the law where KerfDesk is sold (South
   Africa, the United States, the European Union and the United Kingdom) and against Paddle's
   rules, cites the provisions it relied on, and says plainly what stays uncertain. The owner
   decides each uncertain point.
3. **The sourced review replaces the review notes.** On 29 and 30 September 2026 the drafts from
   PR #1021 were checked against South African law (CPA, ECTA, POPIA, PAIA), EU and UK law (GDPR,
   consumer and digital-content law), US law (warranties, CalOPPA, the FTC Act) and Paddle's
   seller, buyer and domain rules, with sources, an adversarial fact-check of each document and a
   cross-document consistency check. Its corrected texts are the customer documents in
   `docs/legal/`, copied unchanged; `docs/legal/publishing-notes.md` lists the blanks the owner
   fills, what ships with the pages and what must exist before Pro trials or sales open.
   `docs/legal/lawyer-review-notes.md` is kept for its history only.

### Consequences

- No lawyer reviews KerfDesk's legal texts, and the owner accepted that. Claude's check is not legal
  advice: a court or a regulator may read a clause differently.
- Hiring a lawyer later needs no new ADR. Their findings go into the texts like any correction.
- ADR-114, ADR-524, ADR-543 and the notes in `docs/legal/` still mention a lawyer's review before
  the first sale; this amendment governs those passages.
- The review's evidence (its sourced requirements, findings and verdicts, and a ranked list of
  residual risks) stays with the owner's project files rather than in this public repository.
