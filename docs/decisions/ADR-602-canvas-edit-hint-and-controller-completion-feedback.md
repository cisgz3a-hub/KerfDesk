## ADR-602 - Canvas selection controls and controller completion feedback

**Status:** Accepted for the scoped UI and acknowledgement-feedback changes requested on 2026-10-17. The reported physical completion failure and separate crosshair-light control remain unqualified.

## Changes

Selecting traced artwork no longer opens the canvas panel offering Edit trace parts and Edit nodes. The existing menu and tool strip still enter these modes. Once explicitly editing, the panel retains Done, preparation progress, Retry and the part-node action.

A dedicated **Centre selection** button appears below the laser jog controls. It reuses ADR-493's existing beam-off move to the centre of the selected artwork's world bounds. It preserves that action's Absolute Coords requirement, native-coordinate conversion, live controller readiness and rotary X-only behaviour. It does not activate either a cutting beam or a separate light.

An outstanding serial acknowledgement is described as **Waiting for controller replies**, rather than asserting that the controller is holding its program. The current reported state remains part of the detail. A resumed stream acknowledgement clears the old wait immediately, including during the transition into final settlement, without waiting for another polling tick. Generic notices no longer attribute every controller's delay to a Falcon setting or prescribe a firmware-setting change.

Pausing after all job lines were acknowledged could strand the post-job settlement operation: if its drain acknowledgement arrived while paused, the continuation no longer considered itself the owner and returned, but the operation remained installed. Resume then could not start another settlement. The existing settlement now retains its exact session/run/transport ownership across that pause, ignores paused Idle reports for completion, and requires fresh completion evidence after Resume. A pause between the final Idle report and the asynchronous completion continuation likewise waits again instead of completing a paused run.

Pause also resets any accumulated post-job Idle count immediately. A stream-side Pause/Resume can occur entirely between status polls, so waiting for an observed paused status to reset that count could combine pre-pause and post-resume reports. A Smoothieware simulator regression covers this case.

No output bytes, Frame permissions or controller recovery policy change. A final return move reaching its destination does not settle missing acknowledgements. The final job acknowledgement, driver-specific planner drain and fresh Idle evidence still determine normal completion.

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

Automatic centre-and-light operation remains pending explicit device/accessory command and offset mappings. The centre-only button does not claim this capability. No controller or hardware was operated during this work.

## Verification

Focused tests cover removal of the selection hint while retaining editing controls, transformed selection-centre dispatch and disabled states, immediate wait cleanup, and a delayed final park acknowledgement followed by the existing planner-drain/Idle completion sequence. The paused-tail completion regression fails before the fix and passes afterward. Existing GRBL, Falcon, Marlin and Smoothieware lifecycle suites exercise the retained family-specific boundaries. This reproduces a software completion defect; it does not establish that the user's unrecorded incident followed the same sequence. Software checks are distinct from installed-app and physical-machine qualification.
