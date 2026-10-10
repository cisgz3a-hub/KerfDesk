## ADR-578 - Case-by-case refunds and safety-notice parity with LightBurn

Date: 2026-10-10

Status: Accepted by the owner, who asked to align KerfDesk's safety warnings and refund terms with LightBurn's, chose a LightBurn-style refund policy, approved editing `public/eula.txt`, and chose no indemnity clause.

### Context

An audit compared KerfDesk's published policies with LightBurn's on 10 October 2026 (product pages, EULA version June 2026, Safety and Fire Safety pages). LightBurn considers refund requests "on a case-by-case basis" and "reserve[s] the right to deny any request". KerfDesk's Refund Policy 1.1 promised a full no-reason refund within 14 days, even after use.

LightBurn covers safety points KerfDesk lacked: what to do when a fire starts, that remote or camera viewing is not supervision, that the software does not control the machine's own safety features, untrained users, machines left switched on, and beams you cannot see. Its EULA adds a clause saying some jurisdictions do not allow these exclusions.

Paddle, the merchant of record, recommends but does not require a 30-day money-back guarantee. It does require sellers to tell it about refund-policy changes. Its own policy keeps statutory withdrawal rights (for example 14 days in the EU, EEA, Switzerland and UK unless waived) and allows its own discretionary refunds within 14 days.

### Decision

1. **Refund Policy 1.2 and Supplier Terms 1.2**, published 10 October 2026, apply to purchases made on or after that date. Refund requests made within 14 calendar days are considered case by case and may be declined. Statutory withdrawal and cancellation rights, duplicate or incorrect charges, undelivered or unusable licences, defect remedies and other mandatory rights always apply. Buyers are pointed to the free 30-day trial first.
2. Purchases made before 10 October 2026 keep the version 1.1 promise, as both documents already stated ("the policy supplied on the day of your purchase applies").
3. No indemnity clause is added: the owner chose to leave it out, and the review notes record that it cannot bind consumers under South Africa's Consumer Protection Act.
4. The safety points listed above are added, in KerfDesk's own words, to `public/eula.txt` (which the installer shows), the in-app Help > Safety & liability text, `docs/safety.md`, the published `/safety/` page, Supplier Terms section 4, the Phone & MCP page and the phone remote-control UI. The in-app notice links `https://kerfdesk.com/safety/` instead of the repository path `docs/safety.md`, which users cannot open.
5. Nothing here adds a startup acknowledgement, licence gate or machine-control gate. Frame, Start, output and running jobs are unchanged.

### Consequences

- The owner must tell Paddle about the refund-policy change, as Paddle's seller requirements say, and the pages take effect only when deployed. If deployment happens after 10 October 2026, the version date should be changed to the actual publication date before it does.
- The unpublished review drafts (`kerfdesk-licence-agreement.md`, `kerfdesk-refund-policy.md`, `kerfdesk-pricing.md`) carry the same case-by-case wording, so a later publication does not reintroduce the old promise. `lawyer-review-notes.md` is a dated record and is left as written.
- Existing installations keep the notice they were installed with; the new `eula.txt` reaches Windows users through the next installer.
- This is not legal advice or a compliance certification. The owner chose to proceed without lawyers.
