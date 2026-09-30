## ADR-523 Amendment 4 - Recover checkout intents and isolate sandbox desktop testing (2026-09-30)

**Status:** Implemented locally; no provider flags or production state changed.
**Amends:** ADR-523 and Amendments 1-3; supplements ADR-541's release checks.

The audit reproduced a checkout failure in the pinned workerd runtime:
`redirect: 'error'` was rejected before any outbound request. Retrying the same
client request could then remain pending indefinitely. The deployed sandbox had
a local `manual` redirect correction that was absent from main.

- Paddle requests use manual redirects. A redirect is never followed with the
  provider API credential. Real workerd tests cover all five redirect statuses,
  successful checkout, and recovery after a lost response.
- An authenticated, audited `POST /v1/admin/orders/reconcile` accepts an explicit
  existing Paddle transaction ID. A provider GET must verify ownership, order
  proof, operation, catalog and checkout destination before the original intent is
  reattached atomically. This requires Paddle `transaction.read`. Reconciliation
  grants no entitlement; verified signed payment webhooks remain authoritative.
- No transaction found, uncertain provider state, failed authentication, or a
  missing transaction ID is not evidence that a payment does not exist. Preserve
  the pending intent. Do not create a replacement payable transaction, delete its
  request ID, or infer absence. An unidentified old transaction still needs
  operator investigation. Backup restore is a separate recovery design.
- A generated sandbox desktop package uses fixed sandbox endpoints and public
  test trust anchors, a distinct app ID/name/executable and `kerfdesk-sandbox`
  profile. It has no project file associations and no update/publication channel.
  Public fixture release-signing material is accepted only by this fully pinned
  sandbox context. Production trust pins and metadata validation remain separate.
- The owner approved continuing with unsigned Windows testing first on
  30 September 2026. Certificate enrolment is deferred. The local sandbox smoke
  observes Free licence state and unavailable updates through read-only app
  routes, without trial, activation, payment or hardware actions. Required licence
  and third-party notice copies are verified before the installer is produced.
- Commercial preflight runs the dependency advisory report before paid native
  packaging/signing jobs. Current advisory patch floors preserve dependency major
  versions. Runtime and build-time exposure are reported separately.

Sandbox preparation and tests do not prove seller verification, signing identity,
production service availability, a published catalog, hosted legal pages or an
installed commercial upgrade. Those owner/provider and release tasks remain open.
