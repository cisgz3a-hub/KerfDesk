# Commercial desktop: business decisions before taking payments

Internal checklist for the owner. The licensing, checkout and update code is
prepared, but checkout stays disabled until every item below is decided,
written down and, where marked, reviewed by a qualified adviser. Each item
names the implementation facts the decision has to respect, so the published
terms never promise something the software does not do.

This is not legal, tax or financial advice. Items marked **adviser** need a
qualified professional in the relevant country before launch.

## Already decided (do not reopen)

| Item | Decision |
| --- | --- |
| Product | KerfDesk desktop commercial edition for Windows first |
| Price | US$49.50 per licence, before any tax Paddle adds at checkout |
| Included | Perpetual use of eligible versions, three active computers, one year of updates |
| Renewal | Optional US$20 for another year of updates; never automatic |
| Trial | Every Pro tool for 30 days from the first online registration |
| Editions | KerfDesk Free on the web and desktop; Pro only in the Windows desktop app (ADR-540, owner's choice 2026-09-29). The app always opens; only Pro tools need a licence |
| Developer access | Separate free licences for Johann and Father, three computers each, unlimited updates |
| Seller | South Africa; customers expected mainly in the USA |
| Payment provider | Paddle (subject to its own seller approval) |
| Free editions | The web app and free Preview builds keep working without a licence |

## 1. Seller identity and provider approval

- [ ] Legal seller name, address and support contact that will appear on the
      checkout, receipts and terms. **adviser** for business registration.
- [ ] Paddle seller verification, payout account and KYC completed. Record the
      approval date and the approved checkout domain (`https://kerfdesk.com/buy.html`).
- [ ] Confirm how Paddle handles sales tax and VAT for your account, and that the
      "plus applicable tax" wording on `buy.html` and `download.html` matches it.

## 2. Customer licence terms (**adviser**)

The installer requires an explicit terms file; the free MIT notice is never
reused for the commercial edition. The terms must match these facts:

- A licence permits Pro in every version released on or before its update
  cutoff, forever. After the cutoff, newer versions open as KerfDesk Free with the
  Pro tools locked until the licence is renewed; older eligible versions keep Pro
  and stay downloadable.
- Three computers can be active at once. Customers move a seat by deactivating a
  computer in Help > Licence. Offline use continues after activation.
- The trial lasts 30 days from the first online registration and is tied to the
  computer's Windows installation. Reinstalling KerfDesk does not restart it.
- Updates install only when the customer quits KerfDesk; nothing restarts the app
  or interrupts a job.
- KerfDesk controls lasers and CNC machines. Decide the warranty disclaimer,
  limitation of liability and safety wording with the adviser; the licence adds
  no machine-operation checks of its own.
- Governing law, dispute handling and consumer rights for US and other buyers.

## 3. Refunds and chargebacks

Decide the refund window (for example none after purchase except where law
requires, or a fixed number of days) and write it into the terms and checkout
page. Facts that constrain it:

- Refunds and chargebacks do not revoke anything automatically. The operator
  revokes the licence (ADR-523 Amendment 1): its key stops activating and
  connected computers drop Pro at their next weekly check, but an offline copy
  that was already activated keeps its rights until it reconnects. Do not promise
  more.
- Never tell a customer to pay a second time to fix an uncertain checkout; the
  support playbook reconciles the original order.

## 4. Privacy notice (**adviser**)

The notice must list exactly what is processed:

- Licensing service (Cloudflare): hashed licence, activation and order
  credentials; a product-specific hash of the Windows installation identity (never
  the raw identifier); a generic device label such as `win32 computer` (the real
  computer name is not sent); licence, activation and order IDs; entitlement
  dates; request metadata Cloudflare processes to operate the service.
- Paddle: payment, billing and contact details as the merchant of record, under
  Paddle's own terms and privacy notice.
- No projects, drawings, toolpaths, machine or job data are uploaded. No
  analytics or crash reporting is added by licensing.
- Decide retention periods, the contact for privacy requests, and how a deletion
  request is handled (today it is a manual operator step in the database).

## 5. Support commitments

- [ ] Support contact (email or form) shown in the app, on the website and in
      receipts.
- [ ] Target response time.
- [ ] Who holds the administrator token and signing secrets, and the backup plan
      if that person is unavailable. Losing them strands licence issuance.
- [ ] The operator steps in `desktop-commercial-support.md` rehearsed once with
      sandbox data.

## 6. Rights review (**adviser**)

- [ ] Earlier MIT releases stay MIT; the private repository does not revoke those
      grants. Decide the cutoff commit and record it.
- [ ] Contributions from anyone other than the owner are licensed for commercial
      distribution, or removed.
- [ ] Third-party notices shipped in the installer are complete for the
      commercial build.

## 7. Launch gate

Checkout may be enabled only after sections 1 to 6 are complete, the pilot in
`desktop-commercial-pilot-checklist.md` has passed for two signed versions, and
the owner explicitly approves live payments.
