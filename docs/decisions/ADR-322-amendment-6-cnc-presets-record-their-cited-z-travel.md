## ADR-322 Amendment 6 - CNC presets record the Z travel their sources cite (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14

Amends ADR-322 (machine presets carry researched contracts). Closes CNC audit v3 N6-P3-3.

### Context

Three CNC size presets cite a Z travel in their own sources but never recorded it:

| Preset | Cited Z travel |
| --- | --- |
| Genmitsu 3018-PRO | 45 mm |
| Genmitsu 4040-PRO | 78 mm |
| Neotronics 4040 Max | 75 mm |

Choosing a preset therefore left the device profile without a Z travel, and the offline Z-travel
review (`cnc-z-travel-warnings.ts`) stayed silent, for example on a 44 mm deep job in 44 mm stock.
The Neotronics device profile records 75 mm itself; only the size preset did not.

### Decision

1. `CncMachinePreset` gains an optional `zTravelMm`, set only where a cited source states it.
2. **Both apply paths patch it:** Machine Setup's preset action and the device-setup picker. It is
   recorded as unconfirmed travel (`zTravelConfirmed: false`), because a published travel is not a
   measurement of this machine.
3. **A confirmed travel is kept.** An operator's confirmed, measured Z travel is a better value
   than a published one, so re-applying a preset leaves it in place.

### Consequences

- The offline Z-travel review runs after choosing these presets. A live `$132` still takes
  precedence.
- Presets whose sources state no Z travel are unchanged.
