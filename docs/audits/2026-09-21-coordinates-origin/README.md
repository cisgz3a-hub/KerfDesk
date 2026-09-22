# Coordinate, machine settings and origin audit

Audit dates: 21–22 September 2026. Johann identified the machine as **Creality Falcon, “20w pro”**. This matches Creality's **Falcon A1 Pro 20W** product; the “A1” model designation is an inference from that clarification and the manufacturer listing.

## Outcome and scope

The ordinary coordinate transforms and Frame-to-Start placement passed independent software tests. The audit also reproduced defects that the existing suites did not catch. After Johann requested fixes, a commit, PR and merge, the repairs were extended to both coordinate-model defects: native controller coordinates now have an explicit mapping to the configured bed, and contour entries use bounds in the prepared program's coordinate frame. Focused regression tests pass; final release verification is recorded below. This is software and simulated-controller evidence, not physical machine qualification.

Audit branch: `codex/audit-coordinates-origin-20260921`, originally based on `288ad66baf23e0c75c0a05f6216787577ddc6812`, then rebased onto `4f1a33bc373dc5821a9b766a6e6385bb81f4de95` before the authorised repair. The primary checkout at `C:\Users\Asus\LaserForge-2.0` was on `claude/vcarve-stamp-subcell`, `a37082457b76d56b8c9ba92be27db027b5a92cb0`, with substantial existing edits; it was left untouched. Results for the repair worktree must not be attributed to that older working copy.

No machine was connected, moved, homed, framed, fired, probed, or reconfigured. No firmware values, saved browser profiles or user projects were changed. Git publication was subsequently authorised by Johann; its outcome is separate from physical machine qualification.

## What was visible in the open apps

Read-only browser inspection found:

| Open app | Displayed build | Displayed setup |
|---|---|---|
| `https://kerfdesk.com/` | `377e692b`, v0.1.2068 | Default 400×400; Laser; disconnected; homing off |
| `http://localhost:5196/` | `95b55b0d`, v0.1.1397 | Default 400×400; Laser; disconnected; homing off |
| `https://laserforge-2fj.pages.dev/` | `377e692b`, v0.1.2068 | Default 400×400; CNC; disconnected; unsaved rectangle project |

These observations do **not** establish which tab or profile Johann uses with the Falcon. The inspected public build and the audit base have identical coordinate/controller implementation files; the intervening diff concerns theme/application UI. The older localhost build and dirty primary checkout are separate versions.

## How the origin controls should be understood

| Control or setting | Meaning |
|---|---|
| Machine/profile origin | The coordinate orientation used when converting the drawing into output. It does not move the head or configure controller homing direction. |
| Home | A physical reference operation supported by that machine's firmware and switches. Generic GRBL uses `$H`; the A1 Pro profile instead uses its vendor X/Y sequence. It is different from returning to a workpiece zero. |
| Set origin here | Declares the current physical head location to be work X0/Y0. It sends a coordinate-setting command, not a travel command. GRBL-family operation selects G54 and sets temporary G92 XY. |
| Nine-dot Job origin | The point on the **artwork bounds** attached to the chosen reference point. Front-left means the artwork's physical front-left; centre places the artwork around the reference point. |
| User Origin | Attaches the selected artwork anchor to the work zero established with Set origin. Moving the head afterwards does not move that work zero. |
| Current Position | Attaches the selected artwork anchor to the live head position when the job is prepared for Frame. Frame returns there and Start uses the frozen prepared placement. Setting a separate workpiece origin is optional for this mode. |
| Absolute Coordinates | Uses the drawing's configured bed coordinates. The ordinary nine-dot placement is ignored. The app requires custom XY origin offsets to be cleared for this mode. A trustworthy physical bed reference still matters. |
| Verified Origin | Uses the same work-zero-relative geometry as User Origin, with deliberately untrusted absolute bed location for hand-positioned setups. It is not automatic physical position sensing. |
| Go to work zero | A movement back to work X0/Y0. It is not a homing cycle. |
| Reset origin | Clears temporary G92 offsets, including temporary Z zero; stored G54 offsets can remain. It does not necessarily make work coordinates equal machine coordinates. |
| Persistent origin | Writes G54 XY into controller storage. It survives reset/power cycle; clearing it is distinct from clearing temporary G92. Stored G54 Z is not erased by an XY-only G10 command. |
| Frame | Traces the prepared motion envelope with the tool off, including applicable extra travel. Only completed Frame authorizes ordinary Start; coordinate/settings advisories remain in Job Review. |

Example: for a 40×20 mm design, placing the head at the workpiece's front-left, choosing **User Origin + front-left**, and setting origin makes the design extend 40 mm right and 20 mm away from that reference on a conventional front-left setup. Choosing **centre** instead puts half the design on each side of the same reference. That apparent shift is intentional anchor behaviour. The audit does not recommend changing any hardware setting without identifying the exact Falcon model and controller state.

GRBL command semantics were checked against the [official command reference](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands) and [status-interface reference](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface), rather than inferred from the app's own simulator alone.

## Falcon-specific configuration evidence

For the [Falcon A1 Pro 20W](https://www.creality.com/products/falcon-a1-pro-20w), the matching catalogue choice is **Creality Falcon A1 Pro (vendor command set)**, with X358 × Y268 mm. The separately labelled **Falcon-compatible GRBL fallback**, 400 × 400 mm, does not identify this model. Creality's original Falcon/Falcon2 machines use different dimensions and must not be substituted for the A1 Pro.

| A1 Pro profile item | Audited value / interpretation |
|---|---|
| Work area | X358 × Y268 mm, as explicitly labelled in the manufacturer configuration |
| Machine origin | Front-left coordinate orientation |
| Controller | `grblhal` family **with** the `creality-falcon-a1-pro` vendor command override; a bare generic controller selection is not equivalent |
| Connection | 115200 baud |
| Home | `$HX` then `$HY`; the profile's Home switch initially defaults off, which does **not** mean the machine lacks homing |
| Autofocus | `$HZ1`, separate from XY Home |
| Output S scale | 0–1000, a controller scale rather than watts or measured optical output |
| Requested maximum / Frame feed | 10000 mm/min, subject to the runtime motion contract; not a physical speed qualification |
| Air | M8 vendor handling, with the existing restart behaviour retained |
| Settings fetch / native jog | Ordinary `$$` and `$J` are not used by this vendor contract |

If an inspected generic 400×400 tab is the one used for this machine, its saved profile needs to be corrected through Machine Setup. This audit did not change it. Home versus User Origin remains an operator choice: use a verified machine reference for bed-based Absolute placement, or deliberately establish a workpiece origin for User Origin.

The A1 Pro command contract is materially different: vendor X/Y Home, tool-off finite G1 jogs instead of `$J`, and no ordinary `$$` settings fetch. The audit's A1 scenarios verify the host command contract through a scripted GRBL motion model; they do not emulate proprietary Falcon firmware. See [machine settings evidence](machine-settings.md) for the freshly checked manufacturer bundle and settings coverage.

## Confirmed findings

| Finding | Reproduction and effect | Disposition |
|---|---|---|
| Report-unit changes can reinterpret old positions | After `$13` changes mm reporting to inches, stale MPos(10,20) and WCO(5,10) become 254/508 mm and 127/254 mm. A request to go to machine (20,20) produced relative X−234/Y−488 rather than X+10/Y0. | **Fixed locally.** Retain the known unit contract during reads, suppress ambiguous coordinates during writes, invalidate stale values at verified readback, and recover from fresh status. Generic GRBL route; the A1 vendor contract does not expose this settings route. |
| Changed detected Z travel retains old confirmation | Applying detected `$132` from 75 to 150 mm preserved `zTravelConfirmed=true`, including in the setup wizard. | **Fixed locally.** Changed travel no longer inherits an old confirmation; direct Apply and wizard regressions pass. |
| Homing and reset descriptions overstate their effects | Home help described `$H`/all axes for the A1 vendor X/Y sequence; profile homing corner looked like a firmware setting; Reset origin implied machine zero despite persistent G54. | **Corrected locally.** Controller-aware Home wording, distinct Recorded home reference, usable-travel explanation, correct temporary/persistent XY/Z descriptions and workflow documentation. |
| Native negative GRBL machine coordinates do not map to the ordinary positive bed correctly | A physically valid stock-GRBL position with negative native MPos appears outside the drawn bed; valid jobs can receive false out-of-bed advisories. Absolute output also needs the inverse translation to reach its drawn bed position. | **Fixed.** A shared mapping uses current-session homing, settings and build evidence, or the explicit A1 vendor convention. Display, advisories, captures, click positioning and prepared Absolute output use that mapping. Unknown mappings retain artwork-relative presentation and advisory status. This does not prove the user's Falcon uses stock GRBL's convention. |
| Centred-origin contour entry uses a positive-bed clamp | For a 400 mm centred bed, burn X198→188 can receive an X203 entry runway beyond the actual X200 edge. Frame includes this motion and preflight warns. | **Fixed.** Prepared jobs carry placement-aware entry bounds. Emission, Frame, preview and timing share them; the example now clips at X200. Unknown physical bounds omit the optional entry. Existing archived output without the new metadata retains its original interpretation. |

## Verification and coverage

The initial audit's deduplicated inventory contained **126 files / 1,372 passing correctness checks**, plus **3 characterisations reproducing the coordinate-model defects**. All three characterisations have now been converted to regression tests that require correct behaviour. The machine-readable [verification summary](evidence/verification-summary.json) records the latest available result for each unique file, run stage and source log; repeated runs are not added together.

The final focused inventory contains **171 files / 1,909 passing correctness checks** and **zero open-defect characterisations**. It includes the native-frame repair (12 files / 645 tests), contour-envelope repair (17 / 253), preview/estimate/worker integration (16 / 111), asynchronous preparation ownership (8 / 182), and second-pass reference handling (2 / 22). These counts overlap; 1,909 is the deduplicated total, not the sum of cohorts. [Native-coordinate repair details](native-coordinate-repair.md) explain the evidence required to map a controller position to the configured bed.

Initial audit cohorts:

- Final Frame/Start/placement plus Falcon flow: **48 files / 291 passed**.
- Final settings/profile/UI: **29 files / 207 passed**.
- Final targeted origin/settings lifecycle: **17 files / 177 passed** (the latest 12-case audit file replaces its earlier 11-case result).
- Additional origin/controller/probe integration after the repair: **17 files / 160 passed**. Together with the other final cohorts, this replaces all earlier origin/controller baseline results in the deduplicated inventory.
- Unchanged coordinate geometry: **14 existing files / 113 passed**.
- Independent physical-coordinate matrix: **440 cases**, covering five origins, nine anchors, four start modes, laser/CNC emitted output and 80 raster rotation/mirror cases. Output comparisons allow the documented 0.001 mm G-code rounding quantum.
- New full host pipeline: **8 passed**, four start modes × two Falcon command profiles. Each runs real connection, jog, optional Set Origin, Frame completion and Start through the fake transport, checks expected placement and return position, and verifies the complete prepared command sequence appears contiguously on the wire.
- Independent small GRBL coordinate oracle checks temporary/persistent offsets, units, WCS selection and Z semantics without using production placement helpers.

These cohorts overlap in some existing files and must not be added as unique coverage without deduplication. Initial failing logs are retained alongside final logs under [evidence](evidence/). The subsequent repair adds native-frame evidence and invalidation tests, contour-entry edge coverage across five origins and four start modes, direct/worker/saved-output parity, and preview/estimate/Print & Cut integration checks. Full release and browser verification are recorded separately in the associated pull request's checks; those checks must succeed for the final PR head before merge. The focused inventory is not a claim of hardware or installed-desktop qualification.

The audit covers profile fields and persistence, millimetre/inch reporting, scene/work/machine conversion, offsets, all placement modes and anchors, selection scope, Home/jog/zero/probe semantics, laser/CNC/raster paths, Frame return and authorization, emitted commands and simulated transport. Physical calibration, switch direction, steps/mm, lost steps, actual laser position, real controller firmware acceptance and material results remain unverified.

## Remaining physical verification

Confirm the A1 Pro designation and profile in the actual app used with the machine; no live saved A1 profile or firmware snapshot was available in the inspected tabs. The coordinate-model repairs preserve the existing Frame-first Start policy. Physical bed alignment, homing direction, actual work zero and measured travel still require a supervised machine check. The 4040 contour-entry policy is not enabled by the ordinary Falcon profiles.
