## ADR-567 Amendment 3 - A CNC spindle with no S range is named in Job Review (2026-11-10)

**Status:** Accepted under the maintainer's standing authorisation to repair confirmed audit findings. It extends Amendment 1's `power-range-empty` warning, which closed audit 03-P2-5 for lasers only, to CNC and router projects. Software evidence does not qualify spindle or physical output.

**Context.** Amendment 1 named an empty S range for laser projects: when the reported `$30` is not above `$31`, laser Job Review warns. CNC readiness compared `$30` with the machine's spindle max RPM and nothing else, so a router whose `$30` matched the profile but whose `$31` was at or above it got no warning. The firmware facts are the same for a spindle as for a laser. Stock GRBL's [`spindle_compute_pwm_value`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c#L192-L205) returns the maximum PWM when `rpm_min >= rpm_max`, before its S0 branch, so every S, S0 included, runs the spindle at full speed while M3 or M4 is on. grblHAL's [`spindle_precompute_pwm_values`](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/spindle_control.c#L1045-L1078) marks the spindle as not variable when `rpm_max <= rpm_min`, and the driver falls back to on/off spindle control, so S no longer sets the RPM.

**Decision.**

1. **CNC readiness names the empty range.** When the reported `$30` (a reported 0 included) is not above `$31` (an unreported `$31` counts as 0), CNC readiness adds the `power-range-empty` Job Review warning. Its wording follows the connected firmware the same way as Amendment 1's: for stock GRBL, the spindle runs at full speed even at S0 while M3 or M4 is on; for grblHAL, it switches to on/off spindle control and S no longer sets the RPM; when the firmware is not known, both; for FluidNC, `$30` comes from the spindle's speed_map. The GRBL-family wordings ask for `$30` at the spindle's max RPM with `$31` below it.

2. **No double warning.** A `$30` that differs from the spindle max RPM is already a `spindle-scale-mismatch`, including a reported `$30=0` (Amendment 1, decision 4). That error asks for `$30` at the max RPM, which also restores the range unless `$31` is at or above that RPM. So the empty range is named only when `$30` matches the profile, or when `$31` is at or above the spindle max RPM. A `$30=0` with `$31` below the max RPM keeps the mismatch error alone.

3. **Never a Start guard.** As in Amendment 1 and ADR-565, this is a policy finding: a Job Review warning that never refuses Start, Save or Frame.

**Unchanged.** Laser readiness, the `spindle-scale-mismatch` wording, the `$32` router-mode checks and CNC output bytes are unchanged.

**Verification.** `core/preflight/controller-readiness-spindle-power-range.test.ts` covers the stock GRBL, grblHAL and unknown-firmware wording, a mismatched `$30` with `$31` at the spindle max, the `$30=0` case left to the mismatch, a usable range with a raised spindle minimum, and the warning staying a warning beside a `$32=1` error. The Amendment 1 tests in `controller-readiness-power-range.test.ts` pass unchanged.
