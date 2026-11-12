## ADR-611 Amendment 3 - A settings read with nothing to do is a log line, not a toast (2026-11-11)

**Status:** Accepted. Fixes user annoyance audit A1 finding A5-P3-4
(`docs/audits/2026-11-11-annoyance-a1/`, fix group F2). Narrows Amendment 2's toast rule; its status
line, titles and the per-profile record are unchanged. | **Date:** 2026-11-11

### Context

Amendment 2 quietened reconnects: the "Machine settings detected" toast appears when a read offers
profile updates or when its review items differ from the last read announced for the machine
profile in this run. A reload starts that record afresh, so the first connect of every launch still
raised "Machine settings detected: controller settings were read successfully in Machine Setup."
With auto-connect on, that is a toast on every launch that asks nothing of the operator. The status
line beside the dot already turns from "Reading settings…" to "Connected".

### Decision

- A read that offers no profile update and has no review item (no homing or limit setting to check,
  no unknown setting) raises no toast. Its sentence goes to the console log instead, prefixed
  `[lf2]`, once per announced read under Amendment 2's rule.
- The other four toasts are unchanged: updates ready, updates and review items, review homing and
  limit settings, unknown settings were read.
- Machine Setup still shows every read.

### Evidence and limits

`DetectedSettingsToast.test.tsx` pins the rule: a clean read logs and shows no toast, a read with an
update still shows one. Unit-tested only; no machine was operated.
