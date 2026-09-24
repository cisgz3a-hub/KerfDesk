## ADR-150 Amendment 1 - Date and time fields print the computer's local time (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends ADR-150's date/time fields. Changes no sequence, record or advance rule.

### Context

The date and time fields formatted the clock with `toISOString()`, so they printed UTC with no
label. An operator in the Americas engraving in the evening got tomorrow's date, and every time was
off by the zone's offset. The remediation ledger tracked this as UA8-TXT23 and left the time-zone
choice to product policy. LightBurn documents its date and time fields as the computer's current
local date and time
([Variable Text Formatting](https://docs.lightburnsoftware.com/2.1/Reference/VariableText/)).

### Decision

1. Date and time fields use the computer's local wall clock, matching LightBurn.
2. `{{date}}` prints the local `YYYY-MM-DD`, `{{time}}` the local 24-hour `HH:MM:SS`, and
   `{{datetime}}` the local timestamp to the second with its UTC offset, for example
   `2026-09-24T19:05:07-04:00`. A zero offset prints `+00:00`.
3. Every output path keeps evaluating its own current-time snapshot (UA8-BATCH-N3). Preview and
   burned text share one clock and one zone because browser workers share the page's zone.

### Consequences

- Engraved dates match the operator's calendar and clock.
- `{{datetime}}` no longer prints milliseconds or a trailing `Z`. No test or document defined the
  old full form.
- The core evaluator now reads the host zone through the Date's local-time methods. The core lint
  rules still forbid reading the clock itself.
