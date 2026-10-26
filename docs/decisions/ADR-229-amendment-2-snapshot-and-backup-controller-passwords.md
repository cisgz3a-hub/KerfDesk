## ADR-229 Amendment 2 - The comparison snapshot leaves out controller passwords; the backup keeps them and says so (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

ADR-229 v2 added a versioned controller snapshot export for machine-to-machine comparison. The
Machine Settings panel it embeds (WORKFLOW F-B14) exports a settings backup. Both copied every
`rawValue` read with `$$` (controller audit v2, finding C4-P3-7):

- grblHAL prints its password settings in clear in `$$` unless a WebUI client is connected: `$75`
  (Wi-Fi station), `$77` (access point), `$330` (WebUI admin), `$331` (WebUI user) and `$533` (MQTT
  broker). ADR-570 Amendment 1 records the sources.
- The snapshot (`…-controller-settings.lfsettings.json`) is meant to travel: the panel asks the
  user to export each machine and load both files, often someone else's.
- The backup (`.lfgrbl-settings.json`) is the user's own copy of the controller's settings. A
  restore needs every value, the passwords included.

### Decision

1. **The snapshot removes passwords.** `createControllerSettingsSnapshot` stores a non-empty
   password setting's value as `[password removed]`. An empty one stays empty, so the comparison
   still shows which machine has none set. The ids come from
   `src/core/controllers/controller-password-settings.ts`.
2. **The backup keeps passwords and says so.** The backup keeps every value. When the rows hold a
   non-empty password setting, the panel shows, before Export, that the backup keeps the
   controller's Wi-Fi, WebUI or MQTT passwords in plain text so a restore can put them back, and
   to keep the file private. The success toast is a warning that says the same.

### Consequences

- A snapshot saved before this amendment may still hold passwords. Loading it compares as before.
- Two snapshots whose passwords differ show that setting as equivalent. A password is not a
  motion or output setting, so the comparison loses nothing it is for.
- The backup's format and values are unchanged; nothing sends it anywhere.
