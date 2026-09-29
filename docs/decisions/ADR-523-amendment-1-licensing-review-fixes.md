## ADR-523 Amendment 1 - Licensing review fixes: keep the key, recover from damage, cap seat moves, allow revocation (2026-09-29)

**Status:** Implemented in source; the licence service is not deployed yet | **Date:** 2026-09-29 | **Amends:** ADR-523 (licensing trust, payments and updates)

### Context

A review of the ADR-523 licensing found six gaps that would reach customers or
support:

1. A buyer never saw their licence key, so they could not activate their second
   and third devices or recover after a reinstall.
2. A saved licence the operating system could no longer decrypt (after a Windows
   password reset, say) locked the device out with no way to recover.
3. A checkout whose provider transaction was never confirmed stayed "pending"
   forever on the device, which then refused every new checkout.
4. Anyone with a key could release and re-activate seats without limit, so one
   licence could serve any number of computers in turn.
5. There was no way to cancel a licence (a refund or a leaked key).
6. One damaged or unverifiable entry in the update catalogue stopped every update.

### Decision

1. **The key is kept and shown.** A key accepted by the service is saved in the
   encrypted record next to the credential. Help > Licence shows it hidden, with
   Show key and Copy key. After a paid checkout, the message tells the buyer to copy
   and keep it. Trials never save a key.
2. **Damage falls back to Free.** An unreadable or corrupt record reports
   `storeUnreadable`: the app runs Free and Help > Licence offers "Reset saved
   licence", which deletes the file. The server keeps the device's seat, and the
   same device re-activating reuses it.
3. **Stuck orders can be forgotten.** The device can forget a saved order ("Forget
   this order", confirmed twice, showing the order number for support). Its next
   checkout is a new order with a new provider transaction. The server still never
   re-creates a transaction for the old order by itself: a lost response may hide
   one that exists, and only a URL the customer was given can be paid.
4. **Seat moves are capped.** A paid licence can free at most six seats in any rolling
   30 days, from its devices or with its key. The seventh is refused with
   `release_limit_reached`, and the device keeps its seat and its Pro tools.
   Developer and trial licences are exempt.
5. **Licences can be revoked.** A private admin endpoint revokes or restores a
   licence. A refresh of a revoked licence answers `license_revoked`, and the device
   removes its credential and saved key. Devices confirm their rights quietly about
   once a week, so a revocation reaches a connected device within about a week.
   Offline copies keep their signed rights until they reconnect, as ADR-523 already
   says. A private admin lookup finds an order's licence so support can resend a
   lost key.
6. **Only explicit answers remove rights.** A released seat (`activation_inactive`
   or `activation_released`) removes the credential but keeps the key, so the owner
   can activate again. A revoked licence removes both. An outage, a rate limit or
   any other error only shows a message.
7. **Bad catalogue entries are skipped.** The updater ignores catalogue entries
   that fail verification, logs how many it skipped, and still installs the newest
   verified eligible release. Duplicate versions are still refused entirely.

### Consequences

- `LicenceRecord` gains `refreshedAt` and `licenseKey`. Older records read as
  before and refresh once on the next launch.
- The weekly refresh sends the same credential fields as a manual refresh; no new
  data leaves the device.
- Support can resend a key only through the private admin API. The service still
  stores no customer email address.
