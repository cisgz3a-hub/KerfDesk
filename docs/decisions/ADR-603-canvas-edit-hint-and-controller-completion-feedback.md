## ADR-603 - Canvas selection controls, separate positioning light and controller completion

**Status:** Accepted. Physical controller and accessory qualification remains separate from software verification.

## Changes

Selecting traced artwork no longer opens the canvas panel offering Edit trace parts and Edit nodes. The existing menu and tool strip still enter these modes. Once explicitly editing, the panel retains Done, preparation progress, Retry and the part-node action.

A dedicated **Centre & LED** button appears below the laser jog controls. It centres a configured separate positioning light on the selected artwork's world bounds, subtracting its bed-axis offset before ADR-493's native-coordinate conversion. This requires Cartesian Absolute Coords: a rotary canvas Y is not a bed location, and origin-based job placement does not follow the canvas. **Set up LED** opens Machine Setup at the light settings. **LED off** remains available after deselection or switching to CNC.

An outstanding serial acknowledgement is described as **Waiting for controller replies**, rather than asserting that the controller is holding its program. The current reported state remains part of the detail. A resumed stream acknowledgement clears the old wait immediately, including during the transition into final settlement, without waiting for another polling tick. Generic notices no longer attribute every controller's delay to a Falcon setting or prescribe a firmware-setting change.

Pausing after all job lines were acknowledged could strand the post-job settlement operation: if its drain acknowledgement arrived while paused, the continuation no longer considered itself the owner and returned, but the operation remained installed. Resume then could not start another settlement. The existing settlement now retains its exact session/run/transport ownership across that pause, ignores paused Idle reports for completion, and requires fresh completion evidence after Resume. A pause between the final Idle report and the asynchronous completion continuation likewise waits again instead of completing a paused run.

Pause also resets any accumulated post-job Idle count immediately. A stream-side Pause/Resume can occur entirely between status polls, so waiting for an observed paused status to reset that count could combine pre-pause and post-resume reports. A Smoothieware simulator regression covers this case.

No job output bytes, Frame permissions or controller recovery policy change. A final return move reaching its destination does not settle missing acknowledgements. The final job acknowledgement, driver-specific planner drain and fresh Idle evidence still determine normal completion.

## Controller research

The supported controller families do not share a universal end-of-job command:

- [GRBL's interface contract](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md) distinguishes command acceptance from execution. Its [program-flow implementation](https://github.com/gnea/grbl/blob/master/grbl/gcode.c) synchronises program end; M0 is a pause, while M2/M30 end the program.
- [grblHAL](https://github.com/grblHAL/core/blob/master/gcode.c) and [FluidNC](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/GCode.cpp) implement their own program-flow and planner synchronisation.
- [Marlin M400](https://marlinfw.org/docs/gcode/M400.html) waits for motion completion. [Marlin M30](https://marlinfw.org/docs/gcode/M030.html) deletes an SD file; it must not be used as a generic completion fix.
- [Smoothieware's communication contract](https://smoothieware.org/communication) explicitly distinguishes an ordinary acknowledgement from completed motion. Its [command list](https://smoothieware.org/supported-g-codes.html) defines M400 for finishing moves and M30 for deleting an SD file.
- KerfDesk's current Ruida driver is file-export only, so it provides no live-controller completion evidence.

KerfDesk's laser finish-position option emits a tool-off return/park move. This is distinct from a limit-switch homing cycle. Research and simulated delayed-final-reply tests do not establish the cause of an actual controller's missing final acknowledgement; that needs the affected run's transmitted and received transcript.

## Separate positioning light

The requested separate LED/crosshair is not low-power Fire. Controller family alone does not identify the light's output or its offset from the cutting head. [FluidNC user outputs](https://github.com/bdring/fluidnc-wiki-content/blob/main/config/user_outputs.md) require configuration; [Smoothieware switches](https://smoothieware.org/switch) use configured command mappings; [Marlin M355](https://marlinfw.org/docs/gcode/M355.html) controls an optionally configured case-light output, not a universally defined crosshair. Generic spindle/coolant commands cannot be assumed to address the light.

Device profiles persist explicit on/off commands and the pointer spot's X/Y offset from the cutting spot in canvas bed axes. A pointer 10 mm right of the cutting spot needs a head target 10 mm left of the selection centre. Configuration is absent by default; no spindle, coolant or case-light output is silently treated as a pointer. Imported settings are validated, and changing controller family clears the mapping. Validation compares numeric command and parameter identity and rejects repeated parameter letters, so formatting aliases cannot make On and Off identical. Standard grblHAL/FluidNC M64/M65 pairs use opposite states on the same output, including active-low mappings. Known park, probe, babystep, filament, Z-calibration and SCARA movement commands are not accessory commands.

All five live controller families use the same owned transaction with their existing driver-specific tool-off, movement, planner-drain and status protocols. After arrival is settled, the configured light-on command is acknowledged. Commands are bound to the current connection, controller session and operation, so cancellation or reconnect cannot light a replacement device. A pending status confirmation owned by another action refuses the new request before any operation or query is claimed; its original waiter remains intact. The captured off mapping remains associated with the session that enabled it even if artwork or profile settings change. The UI offers Off after a possibly dispatched on command; this is command tracking, not an optical sensor reading.

Family examples are conditional on configured hardware: [grblHAL](https://github.com/grblHAL/grblhal_docs/blob/main/content/markdown/04-Reference/02-complete-gcode-and-mcode-reference.md) and FluidNC support M64/M65 for assigned digital outputs; Marlin M355 requires its optional case-light output to drive the pointer; Smoothieware requires configured switch commands. Stock GRBL has no standard pointer command and needs an explicit documented accessory/custom-firmware mapping. The official [Falcon A1 Pro LightBurn bundle](https://wiki.creality.com/falcon_a1_pro_(lightburn_2.0.00+).lbzip) supplies home/autofocus macros and cutting-beam Fire, but no verified separate-light command. Ruida remains file-only and explains that positioning/light control must happen at the machine. These limitations cannot be removed by inventing a universal command.

No controller or hardware was operated during this work.

## Verification

Focused tests cover removal of the selection hint while retaining editing controls, offset-corrected transformed selection-centre dispatch and disabled states, configuration persistence and invalid-command rejection, immediate wait cleanup, and a delayed final park acknowledgement followed by the existing planner-drain/Idle completion sequence. The paused-tail completion regression fails before the fix and passes afterward. Existing GRBL, Falcon, Marlin and Smoothieware lifecycle suites exercise the retained family-specific boundaries. The separate-light transaction is also exercised through the real store and serial simulators for all five live families, with explicit simulated auxiliary-output mappings. Rendered browser checks at 390px and 1280px cover the setup link, invalid cutting-beam command, centre dispatch and Off after deselection. This reproduces a software completion defect; it does not establish that the user's unrecorded incident followed the same sequence. Software checks are distinct from installed-app and physical-machine qualification.
