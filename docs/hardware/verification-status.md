# Hardware verification status

Last repository review: 2026-07-22

This is the canonical repository ledger for claims that require real hardware,
physical output, or perceptual inspection. Automated tests, previews, simulators,
and source review can establish reproducibility, but they do not establish
machine safety or output quality.

## Status vocabulary

- **Code-verified:** the implementation and automated evidence are present.
- **Claimed:** the feature exists, but the named physical check is still pending.
- **Hardware-verified:** the named machine, material, procedure, date, and evidence
  are recorded below.
- **Not applicable:** no physical qualification is needed for the claim.

Do not promote an item to Hardware-verified from green CI alone. A result applies
only to the recorded machine, firmware, tooling, material, and settings.

## Current ledger

No repository-wide physical-output claim is Hardware-verified in this ledger yet.
Older audit files contain snapshots and acceptance plans; migrate evidence here
when a maintainer repeats and records the relevant procedure.

| Area | Current status | Required evidence |
|---|---|---|
| Raster engraving and dithering | Claimed | Named laser/material/settings, emitted file, burn photograph, dimensions, and defects |
| Persistent origin / G54 workflow | Claimed | Controller/firmware, set-clear-reconnect procedure, console log, and measured return-to-origin error |
| Material tests | Claimed | Named device/material, test matrix, photograph, and selected production settings |
| Rotary, Fire, Print-and-Cut, and camera registration | Claimed | Feature-specific checklist, controller/camera details, measured result, and photographs |
| 4040-safe contour entry policy | Claimed | Named 4040-class machine/tool/material, emitted G-code, dry run, cut result, and operator notes |
| Any-size raster emission | Claimed | Large real job, peak resource notes, emitted artifact, completed burn, and output inspection |
| CNC surfacing, probing, restart, and advanced toolpaths | Claimed | Named controller/tool/material, dry-run evidence, cut measurements, and safe recovery observations |
| Desktop installer and Windows update behavior | Claimed | Windows version, signed/unsigned package path as applicable, install/update logs, and job-stream exclusion check |
| Image Studio and trace editing | Claimed | Representative source images, edit/export artifacts, trace/burn result where applicable, and visual inspection |

## Evidence record template

Add a dated subsection when completing a physical check:

```text
### YYYY-MM-DD — feature / machine

- Machine, controller, and firmware:
- Tool or laser module:
- Material and workholding:
- KerfDesk commit and build:
- Procedure followed:
- Settings and emitted artifact:
- Measurements and observations:
- Photos, logs, or other evidence:
- Result: pass / limited pass / fail
- Remaining limitations:
```

## Safety boundary

This ledger documents observations; it is not a safety certification. Use the
machine manufacturer's procedures, independent emergency-stop or power-isolation
hardware appropriate to the machine, suitable PPE, ventilation, and continuous
supervision.
