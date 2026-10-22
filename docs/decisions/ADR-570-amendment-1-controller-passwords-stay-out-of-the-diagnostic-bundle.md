## ADR-570 Amendment 1 - Controller passwords stay out of the diagnostic bundle (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

ADR-570 says diagnostic exports are local, bounded and redacted. The Super Console's local
diagnostic bundle (`diagnostic-bundle.ts`) keeps only numeric values in its settings block, and its
disclosure lists "raw settings values" as left out. Its transcript block did not keep that promise
(controller audit v2, finding C5-P2-1):

- grblHAL prints every `Format_Password` setting in clear in each `$$` reply unless a WebUI client
  is connected (core `settings.c` `setting_get_value`). Those settings are `$75` (Wi-Fi station),
  `$77` (access point), `$330` (WebUI admin), `$331` (WebUI user) and `$533` (MQTT broker).
- The transcript kept `$$` reply lines (`setting`) and typed Console writes such as `$75=newpass`
  (`setting-write`). Its keyword filter drops a line only when it names a word such as `password`,
  and `$75=hunter2` names none. The transcript is on by default, so a bundle saved within about
  100 s of any `$$` carried the passwords.
- A user macro's dispatch line ("User macro … dispatched through Console: `$77=…`") carried a typed
  password the same way.
- An all-digit password parsed as a number and so reached the settings block too.

### Decision

1. **No setting lines in the transcript.** The bundle leaves out every `setting` and
   `setting-write` row. The settings block already carries the numeric values, so the disclosure's
   "raw settings values" is now true of the whole file.
2. **Password assignments are masked in every kept line.** The redaction pass replaces the value of
   a grblHAL password setting (`$75=…`), a FluidNC `$…/Password=…` and `[ESP101]`/`[ESP106]` with
   `[password removed]`, to the end of the line. This covers the macro dispatch line and any other
   free text.
3. **The settings block keeps no password value.** A password setting keeps its id, so support can
   see the board has networking, with `numericValue: null`.
4. **One list.** The ids live in `src/core/controllers/controller-password-settings.ts`, with the
   upstream sources. The comparison snapshot and the settings backup (ADR-229 Amendment 2) use the
   same list, and the support report's redaction (ADR-546) can adopt it.
5. The disclosure lists "raw settings values and setting lines" and "controller passwords", and the
   panel says the bundle leaves out raw setting lines and controller passwords.

### Consequences

- A support bundle no longer shows `$$` reply lines. Their numeric values are still in the settings
  block. String settings such as the SSID (`$74`), host name (`$300`) and MQTT user name (`$532`)
  are left out with them.
- The keyword filter is unchanged. It is still a second layer and does not promise to recognise
  every secret; the panel still asks the operator to check the JSON before sharing it.
- Audit C5-P2-1's repro shape is a regression test (`diagnostic-bundle.test.ts`): a grblHAL `$75=`
  and `$533=` reply, a typed `$75=` write and a macro's `$77=` dispatch line.
