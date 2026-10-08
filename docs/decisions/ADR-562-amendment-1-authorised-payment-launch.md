## ADR-562 Amendment 1 - Authorised payment launch

Date: 2026-10-07

Status: Approved by the owner. Deployment follows the qualification receipts below.

After verification and payout setup were complete, the owner explicitly said
“do it” in response to finishing payment/licence checks and enabling checkout.
This authorises the production payment flag and corresponding public sales copy.
It does not authorise a real-money test purchase.

The offer remains USD49.50 once, three active computers and one year of updates;
USD20 optionally adds a year without a subscription. Paddle adds applicable tax.
The published 14-day refund promise and private seller/payout details are unchanged.
The browser purchase flow in ADR-562 remains purchase-only and consumes no seat.

The customer Windows release is the authenticated unsigned 1.0.11 artifact from
e3820ed51a8d3e9ae8eab16f47097c4011dbd703. ADR-523 Amendment 5 allows this lane;
automatic commercial updates and Windows publisher reputation remain separate.
No replacement installer, public test signing key or entitlement bypass is introduced.

Before enabling the live flag, retain the existing genuine sandbox purchase,
renewal and webhook-delivery evidence; complete mobile cancellation, saved-order
recovery, repeated claim and operator lookup checks; and qualify activation,
Pro access, offline restart, same-version reinstall and deactivation using the
existing developer licence in the actual released Windows executable. Native
developer qualification and sandbox paid qualification are separate evidence.
Neither is a completed real-money purchase or a native paid-tier test.

Opening sales updates the published Supplier Terms/refund version to 1.1,
retains their effective v1.0 source/output privately, and aligns the website's
sales/trial flags and policy links with checked-in Worker settings. Full undated
review drafts remain separate. No app startup, Frame, Start or output gate changes.

The production provider change is limited to PAYMENTS_ENABLED. Preserve the
active script, all other variables, secret values, signing identity and durable bindings.
Closing that flag is the immediate rollback; existing authenticated claims and
licence checks continue while licensing stays enabled. Verify public health,
configuration, live checkout price and first-party recovery after deployment.
Record provider version, source and served-page identities with the final receipt.

On 2026-10-08, the sandbox health route served an older POST-only dispatcher. The sandbox
repair restores the previously qualified script only after its raw SHA256 matches
ea76d1d65cccbee7445551da56236dce6cea00a2503f144185093b5b46912907.
It inherits every binding and secret from the current sandbox version, preserves
the existing SandboxLicenseAuthority namespace and assets, and keeps checkout
closed while health is verified. Production script replacement is outside this
operation. The main-only protected deployment job retains a redacted receipt.

Historical content lookup returned the exact September bundle despite requesting
the October version UUID; the cause of that content ambiguity remains unverified.
The protected sandbox operator may instead decode the retained 72,532-byte October
bundle from the encrypted KERFDESK_PAYMENT_SANDBOX_ATTESTED_BUNDLE environment secret.
Canonical bounded gzip/base64 and the same immutable SHA are verified before any
provider request. The receipt identifies retained-attested-bundle with no source
version claim. Without that input, historical lookup retains its exact SHA guard.
The owner authorised transfer, sandbox restoration and removal of this temporary
secret after qualification; all current settings and recovery guards still apply.

Both operator changes stamp the created version with a unique operation annotation.
Recovery verifies the active UUID and unique matching annotation before restoring
the original closed version. An unrelated or ambiguous deployment is left intact
and reported unverified. Request deadlines reserve recovery time within the job;
the final version read and deployment write remain separate provider requests.

A rejected upload may record bounded numeric Cloudflare error codes, fixed error
categories and known binding or JavaScript exception names. Metadata diagnostics
record only allowlisted field names and value types. Provider messages, response
bodies, source code and credentials are never copied into receipts or logs. This
adds diagnosis only; the attested code, binding inheritance and ownership guards
remain unchanged.
