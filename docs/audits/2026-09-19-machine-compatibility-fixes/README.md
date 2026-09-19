# Machine compatibility audit corrections

Research date: 19 September 2026. Base: `7d4b82812f4ee059edb6f077b8ec6870d06356e2`.

This change addresses all eleven correction groups in the machine catalogue/controller audit.
The corrected catalogue contains 18 device profiles, nine CNC geometry/RPM presets, six controller
families and one researched cutting starter. These categories overlap.

## Correction record

| Audit finding | Corrected behaviour | Independent basis |
| --- | --- | --- |
| MC-01 Smoothieware raster power | Compile/dither at sufficient PWM resolution, preserve original-unit job values, then convert stored or streamed rows once at output. At an S1 maximum, black-image 25/50/100% emits S0.25/S0.5/S1. | Native Laser module S scaling and public exporter regression cases. |
| MC-02 Marlin inline mode and preamble | Clear stale inline mode with `M5 I`, enter `M3 I S0`, retain per-move S and exit with `M5 I`. Re-entry first settles and disables power with `M5 I`. Omit GRBL-specific G54/G94 assumptions. The UI identifies firmware-defined acceleration compensation. | Marlin 2.1.2.6 native M3/M4/M5 and motion dispatch. Native off/re-arm boundaries remove the timing difference between LASER_POWER_SYNC builds without assuming idle laser blanking. M4 I is feedrate-derived, not a replacement for GRBL dynamic power. |
| MC-03 Onefinity compatibility | Retain useful geometry templates with explicit controller/postprocessor limitations, generation notes, dated sources, and unchanged selected-controller disclosure. | Onefinity distinguishes Buildbotics, MASSO and Redline. MASSO G04 P uses milliseconds; a GRBL file is not thereby qualified. |
| MC-04 Falcon A1 Pro | Vendor configuration supplies **X358/Y268**, 115200 baud, S1000, M8 air and `$HZ1` autofocus. An explicit command-set field disables settings fetch and native `$J` jogging, uses bounded tool-off G1 jog/Frame, and acknowledges `$HX` then `$HY` independently. | Creality's downloadable LightBurn device configuration, recovered after the original audit could not load the guide. Its Width/Height fields resolve the axis assignment absent from the product's 268 x 358 prose. |
| MC-05 Sculpfun air | Stock S30 emits M8/M9 when air is requested; a separate manual-pump preset emits no pump command. | Sculpfun's stock pump specification plus actual output tests. |
| MC-06 head variants | Separate xTool D1 Pro 5/10/20/40 W and Ortur LM3 LU2-10A/LU3-20A/LU3-40A travel. Existing IDs retain an explicit head identity. | Manufacturer head-specific dimensions. |
| MC-07 stock 4040-PRO spindle | The stock preset uses the vendor table's 9000 RPM and names the stock spindle. | SainSmart 4040-PRO column, not the adjacent Other 4040 column. |
| MC-08 output-kind advisories | Named laser machines carry laser-only metadata; the hybrid declares both. Generic firmware templates explicitly leave the installed tool unspecified. | Source-described machine configuration; mode mismatch remains advisory. |
| MC-09 evidence confidence | Legacy researched/unverified labels no longer become simulator/public-spec claims. Falcon and the cutting starter no longer assert unsupported physical verification. | Research is kept separate from simulator, firmware and physical evidence. |
| MC-10 reported settings | Travel is described as configured travel. Both CNC detection surfaces require an explicit, connection-bound numerical S-to-RPM mapping before copying `$30` into spindle RPM, even with `$32=0`. Reconnection clears that choice. | SainSmart documents spindle configurations whose S maximum is a PWM scale rather than actual RPM. |
| MC-11 Smoothieware native modes | Constant/proportional intentions map to settled native M221 settings. Native manual-fire cleanup is acknowledged according to the pinned firmware response. Generic realtime hold/resume remains unavailable and the copy now says so. | Smoothieware V1 Laser.cpp and serial implementation. |

Additional corrections: FluidNC's new laser starter/controller selection uses the researched S255
default while preserving saved/custom values and showing YAML configuration conditions. Ruida's UI
describes the experimental equal-Min/Max layer power behaviour instead of offering an ineffective
constant/dynamic selector.

Generated-file inspection and countdown use the same native contracts. Marlin's inline `I`
flag is recognized on its laser mode commands; Smoothieware `M221 S` remains a percentage
override separate from motion S. Native powered moves remain cutting segments in current-job,
streamed and retained-run inspection. Export provenance uses emitter revision
`machine-compatibility-20260919-v2`, and headers describe the actual native power commands.

## Supported contracts and remaining limits

- **GRBL/grblHAL/FluidNC:** configuration-specific serial integrations. Board/build/plugins, S scale,
  homing, wiring and physical travel are still machine-specific. Serial support does not imply Wi-Fi.
- **Falcon A1 Pro:** researched vendor command set; the vendor's GRBL-LPC label does not independently
  establish a grblHAL firmware build. The retained family/legacy ID is a compatibility selection.
  Existing saved profiles require deliberate preset reapplication to adopt the new command set;
  custom machine settings are not silently migrated.
- **Marlin:** inline contract researched against 2.1.2.6 `LASER_FEATURE` with PWM. Match S maximum to
  `CUTTER_POWER_UNIT`; `LASER_POWER_TRAP` is a build choice. Native M5 I off/re-arm boundaries
  settle builds with either `LASER_POWER_SYNC` choice, so inspection/countdown use emitted
  boundaries instead of guessing that firmware option or assuming idle power is blanked. Origin reset requires
  `CNC_COORDINATE_SYSTEMS` on a non-SCARA build. Fan wiring uses the separate M106/M107 dialect.
- **Smoothieware:** V1 native laser configuration and exact documented shell completion semantics.
  Set `laser_module_minimum_power` to `0` so S0 feed moves remain dark, and match
  `laser_module_maximum_s_value` to the profile. No CNC support or generic realtime hold/resume
  is claimed. Host pause drains buffered moves.
- **Ruida:** experimental vector-only `.rd` export; no live transport, raster support, independent
  Min/Max control or manufacturer file-acceptance qualification is claimed.
- **CNC presets:** geometry/RPM starters are separate from the controller and spindle-control wiring.
  A manual router, relay, PWM spindle and VFD do not acquire interchangeable control semantics from
  a size preset. Unknown model revisions, legacy Onefinity dimensions and cutting recipe performance
  remain explicitly unqualified rather than being replaced by guessed values.

The existing completed-Frame requirement remains the sole ordinary Start policy gate. No hardware
was operated or qualified, no firmware was executed, and no physical stopping/cutting performance
is inferred from passing software tests.

## Primary research references

- [Creality A1 Pro LightBurn guide](https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/lightburn-guide),
  [vendor bundle](https://wiki.creality.com/falcon_a1_pro_(lightburn_2.0.00+).lbzip).
  The accompanying JSON records selected factual fields and the downloaded bundle's hash.
- [Marlin M3](https://marlinfw.org/docs/gcode/M003.html),
  [Marlin M400](https://marlinfw.org/docs/gcode/M400.html),
  [Marlin 2.1.2.6 M3/M5 source](https://github.com/MarlinFirmware/Marlin/blob/5554ccb52f4d449d97ef88b28d03b53d9d63ba70/Marlin/src/gcode/control/M3-M5.cpp),
  [Marlin G92 source](https://github.com/MarlinFirmware/Marlin/blob/5554ccb52f4d449d97ef88b28d03b53d9d63ba70/Marlin/src/gcode/geometry/G92.cpp).
- [Smoothieware laser configuration](https://smoothieware.org/laser.html),
  [pinned native laser implementation](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp).
- [FluidNC v4.0.3 LaserSpindle](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Spindles/LaserSpindle.cpp).
- [Sculpfun S30 stock pump](https://www.sculpfun.com/products/sculpfun-s30-5w-laser-engraver-rotary-roller-40-40cm-honeycomb-panel),
  [xTool D1 Pro](https://xtool.zendesk.com/hc/en-us/articles/14109952045463-D1-Pro-Product-Introduction),
  [xTool 40 W head](https://www.xtool.com/products/40w-laser-module-for-d1-pro/make-money-shopping-guide),
  [Ortur LM3 variants](https://ortur.net/pages/support-olm3).
- [SainSmart 4040-PRO](https://www.sainsmart.com/products/genmitsu-4040-pro-semi-assembly-desktop-cnc-machine-for-carving-and-cutting),
  [S scale and RPM](https://docs.sainsmart.com/article/9m0rbnw6k1-introduction-to-cnc-for-a-total-novice-tuning-gbrl-settings).
- [Onefinity controller generations](https://www.onefinitycnc.com/support),
  [MASSO dwell units](https://docs.masso.com.au/supported-g-codes/g04-dwell).

The CNC catalogue also carries per-entry sources for Genmitsu, Neotronics, Shapeoko, X-Carve,
Onefinity and LongMill, with the supported facts identified separately from unverified assumptions.

## Verification

Focused behavioural checks cover public image output, streamed rows, native power-mode transitions,
host controller lifecycle and acknowledgements, persistence, variant bounds, air command ordering,
settings adoption, compatibility warnings, native inspection/countdown and setup UI.

- Local validation used Node 24.15.0, pnpm 11.3.0 and Vitest 3.2.6 on Windows.
- The full test run completed 2,147 files: 2,127 passed, six reported failures and 14 were already
  skipped. The failures identified two stale output snapshots, the old qualification label, a
  pre-native Marlin acknowledgement assumption, missing controller context in an inspection
  fixture, a missing checkbox tooltip and an exhaustive-test timeout. All six affected files
  pass on focused reruns (61 tests after adding the native M5 I settlement case).
- The exhaustive raster grammar test retains all original inputs and reference comparisons.
  Constructing assertion diagnostics only on a mismatch reduced its four-test runtime from more
  than ten seconds to 90 ms in the local rerun, without raising the timeout or changing production
  parsing. The full run also reported a Vitest worker RPC timeout, so it is not recorded as a clean
  full-suite pass; the PR must pass the complete CI gate before merging.
- Type checking, repository and Electron lint, formatting, ADR numbering, action pinning, licence
  checks, 127 release-integrity tests, web and Electron builds, and size/export limits passed.
  The new command-set imports stay internal instead of increasing the device barrel's export cap.
- Local Chrome checks covered Falcon setup fields and connection guidance, Onefinity geometry
  application with the controller disclosure, and a generated Smoothieware 20 mm cut at S0.25 in
  the G-code viewer with a working time estimate. No browser runtime errors were reported.

CI and review results are recorded on the associated pull request. Software and browser results do
not establish firmware execution, physical machine compatibility or cutting performance.
