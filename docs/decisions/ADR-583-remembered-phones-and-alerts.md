## ADR-583 - Remembered phones and job alerts

**Status:** Accepted for the maintainer's request on 10 October 2026. Extends ADR-564 and ADR-569. Amends the fixed eight-hour phone session recorded in `services/remote-control/README.md`.

**Context.** A phone approval expired eight hours after PC approval regardless of use, forcing a new QR scan and PC approval every working day. OAuth clients could already keep an approval for up to 30 days with `offline_access`. Operators also asked to hear when a job finishes or stops without watching the phone.

**Decision — remembered phones.**

- The PC approval prompt gains **Keep this phone signed in for 30 days (otherwise 8 hours)**. It starts unchecked, so a longer session is always the operator's explicit choice. When unchecked, or when an older desktop omits the choice, the phone keeps the eight-hour session.
- `pair.decide` carries optional `remember: boolean`. The relay sets the phone session and lease to 30 days only when `remember === true`. The cookie lifetime follows the stored expiry; status checks still never renew it.
- Remembered phones appear in desktop Settings with their scopes and can be revoked individually or all at once. Revocation, disabling access and lease expiry behave as before and cancel pending work.
- Machine-control approval is unchanged in kind: it requires the explicit PC checkbox, and its bounded action ledger applies for the life of the lease.

**Decision — job alerts.**

- The desktop renderer reports machine events by kind only: `job.finished`, `job.stopped`, `machine.alarm`. Main forwards them to its Durable Object as `{v:1,type:'event',kind}`. Events carry no artwork, file name, G-code, position or error text.
- A phone may store one Web Push subscription per approved client. The endpoint must be HTTPS on a known browser push service host. Keys are validated before storage. Subscriptions are deleted on revocation or expiry, and on a 404/410 response.
- Delivery uses VAPID (RFC 8292) and the `aes128gcm` content encoding (RFC 8291) implemented with Web Crypto. The payload is a fixed, generic sentence chosen from the event kind.
- Alerts are disabled unless the Worker has `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` secrets. Creating those secrets is a provider action reserved for the maintainer; source changes never create them. Without them, `/api/push/key` returns 404 and the app hides the option.

**Unchanged.** Pairing codes stay one-use and five minutes. The PC remains the only approver. Alerts never grant control, and missing an alert is not a safety signal: the machine and the PC remain authoritative.

**Consequences.** A lost phone keeps access until revoked on the PC; the Settings list makes that visible. Alert delivery depends on browser and operating-system push support, which the app detects and the user grants.
