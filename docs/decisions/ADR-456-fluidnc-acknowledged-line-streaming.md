## ADR-456 - FluidNC follows its acknowledged-line channel contract (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

The speed and quality audit found that FluidNC inherited GRBL character-counted
streaming. Its G-code compatibility does not establish a compatible receive-byte
window. The upstream [FluidNC v4.0.3 channel contract](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Serial.cpp#L17-L32)
requires the sender to receive an acknowledgement before sending another line.
The same contract remained in upstream main when checked on 2026-09-27.
This is a source-backed protocol correction, not a reproduced physical overflow.

### Decision

- Include FluidNC in the shared acknowledged-line streaming rule, alongside
  Marlin and Smoothieware. GRBL and grblHAL retain their existing buffered modes
  and receive-capacity evidence rules.
- Use that same rule in controller/profile reconciliation. Detecting GRBL or
  grblHAL after an acknowledged-line family restores buffered streaming;
  an explicitly selected ping-pong mode within a buffered family stays selected.
- Correct the generic FluidNC preset and version only that preset to 2026-09-27.
  Existing project files and imported machine profiles already pass through the
  shared normalization helper, so they receive the correction without a separate
  migration or an operator action. Their saved receive-window value is retained
  as metadata; it cannot authorize multiple in-flight lines.
- Enforce the active controller rule again at the final Start boundary. Existing
  callers for ordinary Start, laser restart, supervised CNC recovery, calibration,
  and reviewed jobs use the same helper. A stale requested mode cannot bypass it.
- Keep acknowledgements distinct from physical completion. No Frame/Start policy,
  output geometry, power, firmware configuration, or hardware state changes.

### Consequences and verification

One-line acknowledgement can lower achievable throughput on short dense paths.
Quality and the documented transport contract take precedence over assumed
buffer capacity. A future buffered FluidNC mode requires a separately evidenced
channel/version contract, not a larger guessed byte window.

The throughput cost is unmeasured. No FluidNC hardware run has compared
acknowledged-line and character-counted streaming on a dense raster or Fill job,
and the 2026-09-25 controller audit had judged the profile window conservative
from the same firmware version. This rule rests only on the cited firmware source
comment. It stays the conservative behaviour until a hardware measurement shows
either a planner-starvation cost that needs a buffered mode or no measurable
cost. Nothing here claims a hardware result.

Focused tests cover every controller kind, family transitions, idempotent profile
normalization, preset version/hash, old project and profile import, final stream
options, and a synthetic FluidNC connection through the real store. The store
test requests buffered mode with 512 bytes and proves only G21 is sent initially;
G90 is sent only after the first acknowledgement. Existing GRBL/grblHAL window
tests continue to pass. This is software and synthetic transport evidence, not
hardware or material qualification.
