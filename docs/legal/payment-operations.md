# KerfDesk payment and privacy operations

Prepared 7 October 2026 for the sole proprietor Johannes Stephanus Stolk. The owner authorised the checkout rollout on 7 October 2026 (ADR-562 Amendment 1); actual deployed availability is recorded separately. Public-content readiness is separate from provider/licensed-build, delivery and refund qualification, and from resolving the applicable statutory disclosure questions in publishing-notes.md. This is an operator process, not a claim that live payment delivery has been proven. It requires no company incorporation, lawyer or Windows signing purchase.

## Opening and closing new checkout

Before enabling payments, confirm the live catalog, approved checkout URL and production provider configuration, and retain evidence for the supported browser/phone and Windows customer journeys. Sandbox payment checks do not require a real charge. A live paid purchase or refund is a separate financial action and needs the owner's specific authorisation.

The launch changes only PAYMENTS_ENABLED to true in the existing kerfdesk-desktop-licensing service configuration. Keep LICENSING_ENABLED=true, the existing signing key id, live catalog and credentials, rate-limit namespaces and LicenseAuthority binding/migration. Reconcile dashboard-only non-secret variables before deploying: Wrangler normally replaces vars but preserves secrets. In particular, ensure the configured public Paddle client token survives the deployment. Never record its private API or webhook credentials in source or an operator receipt.

For an incident, set PAYMENTS_ENABLED=false and close website salesOpen, while preserving LICENSING_ENABLED=true and all existing provider/catalog/signing/storage configuration. Redeploy the same service and publish the matching availability copy. Trials can remain open. The service still accepts authenticated completed-payment notifications for existing orders and permits saved claims, activation and refresh. An existing already-created checkout can still take payment; closing new-order creation does not cancel it at Paddle. Preserve pending orders, support recovery and licences, and reconcile any payment received during the incident. Never reset the licensing database to close sales.

After enabling or closing new orders, verify both public endpoints. GET /v1/public/health confirms database availability only; GET /v1/public/config confirms enabled/disabled checkout configuration. The buyer's Check payment result and successful desktop activation provide separate delivery evidence. Never claim a browser completion callback proves fulfilment.

## Support and lost keys

Use support@kerfdesk.com as the customer route. For a paid order, compare the receipt and purchase email with the transaction in the authenticated Paddle dashboard. A transaction ID by itself does not prove ownership. Use the private licensing lookup only after that check; return a key privately to the verified purchaser. Never request a complete key or payment-card information, or put credentials in chat, source, logs or public files. There is no automated key email service.

## Refunds and disputes

Check the dated policy that applied when the customer bought. Record the verified transaction, reason, amount and decision privately, and process the refund in Paddle. The API key prepared for checkout has no refund permissions; use the authenticated dashboard or a separately authorised, appropriately scoped credential.

After a confirmed full base-licence refund or chargeback, revoke that licence with the documented private administration route and ask the customer to deactivate. A definitive revoked response at an online check removes the saved credential and now-useless licence key. An already established paid Pro allowance stays latched for the current session until restart or explicit sign-out/reset; removing the saved entitlement does not immediately remove that session allowance. A retained offline perpetual token cannot be recalled remotely. Machine control and a running job remain usable. Restore a licence only after verifying the payment stands; do not claim a webhook performs automatic refunds or revocation.

For an optional update-extension refund, keep the base licence and its purchased rights intact. Current administration provides no cutoff rollback route. If a reviewed entitlement correction is unavailable, refund the extension and leave its extra coverage in place. Do not revoke the base licence or edit authority storage by guesswork. Note that decision in the private support record.

## Privacy requests and retention

Review support/privacy requests and licence/order records at least monthly. Identify information by verified order or licence reference, request only the minimum ownership evidence and explain any legal retention. Use the documented customer-delete route only after reviewing its consequences: it cancels refresh and future activation and cannot be undone. Do not mistake deactivation for deletion. A short administrative audit remains after customer deletion.

Keep paid licence records while needed to honour the perpetual licence, seat transfers, entitlements and support. Keep disputed/payment/accounting records for the applicable legal obligation or active claim. Review unpaid orders, expired trials and unnecessary attachments; confirm the payment is not pending or payable before deleting an order. Trial-abuse and audit records must receive a necessity review instead of a false promise of a timer the service does not implement. The service has no scheduled licensing-retention job.

Review private support mail and encrypted backup exports monthly; delete unnecessary attachments and obsolete backup copies by their exact verified paths. Keep only copies needed to operate or recover the authority. Never promise that deleting a local export deletes provider backups or logs. Provider-held information follows the provider's own retention and access process. Record an applicable legal hold rather than silently retaining everything.

## Dated documents and service continuity

Before replacing an effective policy, retain its exact dated source/output in a private policy archive and publish the new date. Supply prior effective versions on request. Link the final terms and refund policy before opening purchases. Existing installers keep their supplied notice; no new startup, Frame, Start or output gate is introduced by website publication.

For an incident, close new purchases if delivery is unreliable; preserve existing licence activation and pending-order recovery where possible. Compare Paddle transaction status with the licensing order before recovery. Do not take a second payment to resolve uncertainty, invent an entitlement, or restore an old authority database without reconciling seats and payments.

## Public contact arrangement

No requirement to acquire a company office is established here. ECTA section 43 lists physical address/telephone and legal-service disclosures for an applicable electronic-sale supplier. Whether those duties apply to the KerfDesk licensor alongside Paddle resale is a tracked scope question, not a universal publication gate. If applicable, establish a genuine authorised contact/service arrangement; do not substitute Paddle's address, publish private residence/mobile details by default, or assume a post box alone satisfies physical-address wording. Keep email primary. The separate POPIA responsible-party notification and PAIA questions remain in publishing-notes.md.

The studio label Ons Houtkombuis remains in the existing product site. It is not substituted for the confirmed legal supplier and its unverified relationship is not asserted in the new legal pages. Information Officer registration, any required representative or provider arrangement must be checked before making a claim that it exists; no registration is invented here.

## Primary references checked 7 October 2026

- [Paddle domain review](https://www.paddle.com/help/start/account-verification/what-is-domain-verification): live HTTPS product/pricing and accessible terms, refund and privacy information; legal seller identity. It does not impose a lawyer, company incorporation or Windows signing requirement.
- [South African government ECTA](https://www.gov.za/documents/electronic-communications-and-transactions-act), [Act PDF](https://www.gov.za/sites/default/files/gcis_document/201409/a25-02.pdf): sections 42–43 electronic-transaction/supplier disclosures. The government links the amended Act; licensor applicability and the authorised notification/contact arrangement remain separate questions.
- [Paddle refunds](https://www.paddle.com/legal/refund-policy) and [buyer terms](https://www.paddle.com/legal/buyer-terms): provider rules and customer rights remain separate from the KerfDesk offer.
- [Information Regulator PAIA](https://inforegulator.org.za/paia/) and [contact details](https://inforegulator.org.za/contact-us/): requests, forms and current official contacts.
- [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/), [Cloudflare privacy](https://www.cloudflare.com/privacypolicy/), [Google privacy](https://policies.google.com/privacy), [Paddle privacy](https://www.paddle.com/legal/privacy): public provider terms do not establish a bespoke agreement, representation or certification for this seller by themselves.
