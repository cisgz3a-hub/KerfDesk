# CNC V-carve contour-ramp entry - research and acceptance

- **Date:** 2026-08-01
- **Scope:** software/CAM/G-code only; no controller connection, machine motion,
  firmware/settings change, or physical cutter qualification
- **Decision:** ADR-276

## Outcome

CurveDesk now has an opt-in lower-load V-carve entry. Instead of reaching each
offset ring through same-XY stepped plunges, an enabled ring begins at stock top
and descends continuously over one or more complete contour laps. A final level
lap cuts the ring everywhere at its exact target depth.

This is a deterministic load-spike reduction, not a claim that the prior
incident was caused by the G-code and not a cure for open-loop position loss.
Without independent axis encoders, controller status cannot prove that the
physical gantry followed every commanded step under cutting load.

## Motion contract

The planner works on the same 0.001 mm coordinate grid written to G-code.
Because a later job-origin translation can place binary floating-point values on
opposite sides of an emitter tie, the planner subtracts one 0.001 mm quantum
from each nonzero XY component before calculating a conservative segment length
`L`. Its permitted descent is `floor(L * tan(a) / 0.001)` Z quanta. A complete
lap is constrained by both the sum of those segment capacities and the
configured depth-per-pass. The planner then uses enough complete laps to reach
the rounded emitted target depth.

It:

1. chooses the midpoint of the longest ring segment deterministically;
2. starts the V-bit at that XY at `Z=0`;
3. distributes integer Z quanta by cumulative segment capacity over those laps;
4. emits every descending XYZ segment at the group's plunge feed;
5. emits one complete level cleanup ring at normal cutting feed; and
6. records the configured maximum angle in G-code provenance.

The strategy emits ordinary absolute `G1 X Y Z F` blocks supported by the
existing GRBL emitter. It adds no controller command, adaptive feed, load
sensor, encoder loop, or coordinate-recovery behavior.

## Advisory fallback boundaries

- 0/absent preserves legacy output. CurveDesk does not guess a ramp angle.
- The dedicated `vCarveRampEntryDeg` maximum must be finite, greater than 0,
  and less than 90 degrees. A sub-0.5-degree stored value is honored, never
  steepened; a stale generic `rampEntryDeg` remains independent and inert.
- The input must remain a usable closed contour after 0.001 mm emission rounding.
- There is no predictive segment cap. An invalid, precision-collapsed, or
  numerically unrepresentable request retains the complete legacy
  stepped-plunge ladder and produces a named, nonblocking Job Review advisory.
  G-code provenance discloses fallback.
- Every tiled ramp warns that per-tile derivation can create new endpoints, so
  tiled files label the angle as `requested-max-angle-deg` and explicitly do not
  claim the ordinary final-emission maximum-angle guarantee. Export remains
  available. If clipping creates a piece that begins below stock top, a second
  warning toast and inert G-code comment disclose its direct plunge at the
  configured plunge feed.

## Why this strategy

- [Vectric's profile documentation](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/uiProfileMachineForm/index.html)
  says ramping prevents vertical entry and reduces wear, heat, spindle load,
  and Z-axis load; it also documents plunge-feed ramps and whole-perimeter
  spiral descents whose lap count follows cutter pass depth.
- [LMT Onsrud's routing paper](https://www.onsrud.com/images/Fixturing%20and%20Routing%20of%20Plastics%20with%20CNC.pdf)
  explains that straight plunging recontacts the cut surface and recuts chips,
  while simultaneous XY/Z ramp-in motion gradually enters the material.
- [Autodesk Fusion](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUIDA73542E9-ED9C-4BD9-A87D-3A0ECA8BEB41.htm)
  uses maximum stepdown per ramp revolution to constrain full-width tool load
  and warns that undersized helices impair chip evacuation and can cause
  jerking or breakage.
- [Autodesk FeatureCAM](https://help.autodesk.com/cloudhelp/2018/ENU/FCAM/files/GUID-6CFBBFC3-4DA6-44B7-B47F-9B7B0141554F.htm)
  requires non-gouging entry geometry and distinguishes center-cutting from
  non-center-cutting tools by required XY travel.

A blanket helix was rejected: narrow V-carve rings may have no safe circular
clearance, and a helix would cut outside the requested ring geometry. Pecking
was rejected because it is a drilling strategy and retains repeated axial
entries. The chosen contour ramp stays on the exact V-carve ring and remains
valid even when the ring is too small to fit a separate circular bore.

## V-bit mismatch caveat

Angle and nominal diameter are not enough to authorize entry. Vectric says a
ramp angle may come from the cutter manufacturer, and its V-carve page applies
`Ramp Plunge Moves` to the separate clearance cutter—not universally to the
V-bit. [Amana model 45747](https://www.amanatool.com/45747-carbide-v-groove-90-deg-folding-for-composite-material-panels-like-tcm-ccm-acm-0-090-inch-tip-width-x-13-64-x-1-2-dia-x-1-2-inch-shank-zrn-coated-router-bit.html)
is an official example of a 90-degree V-groove tool that is non-end-cutting and
cannot plunge. CurveDesk therefore leaves the strategy off until the exact
cutter SKU or datasheet establishes a permissible ramp entry and angle.

## Software verification

- Focused Vitest bundle: 15 files, 158 tests passed.
- Full TypeScript check: passed.
- Full ESLint check: passed.
- Release-integrity tests, web build, Electron-main build, file-size policy,
  soft-size report, and index-export ratchet: passed.
- The complete `pnpm release:check` run passed all stages through license checks,
  then reached the repository-wide Vitest suite and timed out at 30 minutes
  without an assertion failure. The full suite is therefore inconclusive, not
  claimed as passing.

Tests cover the depth-per-pass constraint, maximum slope after actual 0.001 mm
G-code rounding and a half-quantum job-origin translation, exact final depth,
cleanup lap, deterministic cyclic entry,
microscopic contours, numeric-domain fallback, no direct negative-Z plunge in the
ramped G-code fixture, plunge-versus-cut feed selection, provenance, preflight
reporting, and nonblocking tile-clipping disclosure. Existing no-ramp V-carve
tests continue to pin legacy output.

## Physical qualification still required

Before enabling this on a real job, identify the exact cutter SKU and obtain
its manufacturer's entry/ramp limit and material guidance. Qualification then
requires the operator's normal machine-specific procedure: reviewed G-code,
correct bit and collet engagement, secure stock, dust/chip clearance, emergency
stop access, conservative scrap, and observation for deflection, chatter,
heating, or position loss. This implementation performed none of those
hardware actions and does not certify a loaded cut.
