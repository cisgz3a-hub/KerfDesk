## ADR-399 - CNC files say they are for GRBL-family controllers, and the CNC Frame names the real reason (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends the CNC export surfaces of ADR-098 and the controller scope of ADR-094/095/096. The
Frame-first Start contract (PROJECT.md non-negotiable 21) is unchanged: this adds warnings and
corrects refusal messages, and it adds no block.

### Context

Controller audit 2026-09-25, CNC-controller track: CN-1 to CN-4. The track's research into which
controllers hobby CNC machines ship with is in the audit report
(`docs/audits/2026-09-25-controller-full-audit.md`, "CNC controllers").

- KerfDesk writes every CNC program in one dialect, its GRBL CNC dialect: `M3 S<rpm>` then
  `G4 P<seconds>`, and `M0` for a tool change. The emitter ignores the profile's controller.
  Marlin, MASSO, UCCNC and RepRapFirmware read `G4 P3.000` as 3 milliseconds, so the bit plunges
  before the spindle is at speed. Smoothieware ignores `M0`, so the next section is cut with the
  wrong bit.
- KerfDesk runs CNC jobs live only on GRBL-family controllers (`capabilities.cncJobs`). For
  Marlin, Smoothieware and the file-only Ruida profile the only route is Save G-code, tile export
  or surfacing export, and none of them said the file was for GRBL (CN-1).
- On Marlin or Smoothieware the CNC Frame first sent the operator through the G54 normalization
  and the Work Z prompt, which writes `G92 Z0`, and then refused with "cannot build the required
  safe-Z retract" (CN-2). No CNC Frame can be built there.
- A CNC project saved on the Ruida profile was refused as a "Fill/Image raster" layer, while the
  tiled Save bypassed the `.rd` route and wrote GRBL tiles (CN-3).
- Machine Setup's "Output dialect" select looked as if it set CNC output; it lists laser dialects
  only and has no effect on CNC bytes (CN-4).

### Decision

1. **Exports warn.** When the profile's controller cannot run KerfDesk CNC jobs, Save G-code of
   a CNC project, tile export and surfacing export each push one warning. It says the file is
   written for a GRBL-family controller (`G4 P` in seconds, `M0` at each tool change), names the
   profile's controller, and says that controller may read these commands differently: a `G4 P`
   taken as milliseconds lets the bit plunge before the spindle is at speed, and a skipped `M0`
   cuts the next section with the previous bit. The warning appears whether or not a controller
   is connected. Bytes, saves and routing are unchanged.
2. **The CNC Frame refuses first, with the reason.** The Frame's own existing refusal now comes
   right after the controller-queue check, before WCS normalization and the Work Z prompt:
   "CNC Frame is unavailable: KerfDesk CNC jobs require a GRBL-family controller (GRBL, grblHAL,
   FluidNC), and the connected controller cannot run them. …". This is the same refusal of a
   Frame that cannot be built, earlier and in the right words; it is not a new gate.
   - The Laser/CNC toggle, switching to CNC on a profile whose controller cannot run KerfDesk
     CNC jobs, warns "CNC mode is active, but this profile's controller (Marlin) cannot run
     KerfDesk CNC jobs: they need a GRBL-family controller …", whatever the profile's capability
     label says. The mode still switches.
   - When the setup includes CNC, Machine Setup's controller list marks those controllers
     "— laser only".
3. **Ruida.** An untiled CNC Save on the Ruida profile says a router job cannot be a Ruida `.rd`
   laser file (ADR-394). A tiled Save still writes GRBL tiles, now with the item 1 warning. A
   refusal would take a working file away from an operator whose tile cutter runs GRBL.
4. **Machine Setup.** When the setup includes CNC, the select is labelled "Laser output dialect"
   with the hint "CNC programs always use KerfDesk's GRBL CNC dialect." Laser-only setups are
   unchanged.

### Consequences

- An operator with a non-GRBL CNC controller learns before cutting that the file assumes GRBL,
  and why that matters.
- A CNC Frame on Marlin or Smoothieware no longer writes `G92 Z0` before it refuses.
- Regression tests: `cnc-export-controller-advisory.test.ts`,
  `cnc-export-controller-advisory-exports.test.ts`, `use-frame-action.cnc-controller.test.ts`,
  `cnc-frame-lines.test.ts`, `emit-rd-cnc-refusal.test.ts`,
  `emit-gcode-cnc-dialect-independence.test.ts`, `DeviceSetupWizard.cnc.test.tsx`,
  `MachineModeToggle.hybrid.test.tsx`.
