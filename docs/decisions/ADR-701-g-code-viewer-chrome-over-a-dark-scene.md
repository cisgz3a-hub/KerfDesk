## ADR-701 - G-code viewer chrome: one header row, dark overlays, a banded scrubber

**Status:** Accepted (maintainer request, 2026-11-10: the G-code preview "should get a visual upgrade
and a better design in overall ... currently it looks like slop"; the maintainer chose the chrome and
overlay pass first). Pass 1 of 3; scene rendering (pass 2) and the side panels (pass 3) are later
decisions. Burn, G-code, Frame, Start and every viewer behaviour are unchanged. | **Date:** 2026-11-10

### Context

The G-code Inspector dialog and the canvas's G-code 3D tab share `InspectorView`. A review of both on
a laser job found:

- Five light-theme cards (readout, camera, legend, hint bar, stock) floating over a 3D scene that is
  dark in every app theme (`viewer3d-theme.ts`). They covered about 40% of the view and read as
  pasted on.
- Three stacked header rows in the canvas tab: the Design / G-code 3D switch, a name and Refresh
  bar, and an uppercase "G-CODE / 3D" label with an "Explore the toolpath" subtitle.
- No button hierarchy: "Hide readouts" and "Hide source" were filled in the accent colour like a
  main action, and the camera card had nine equally weighted text buttons in two rows.
- Instructions left on screen ("Following progress · Drag for manual view · Faint path: program
  context").
- A transport of text buttons (`Restart −0.25s Play +0.25s`) and a plain range input that carried no
  information about the program.

### Decision 1 - One header row that says what the job is

The header keeps one row. On the left are chips for the estimated motion time, the width × height
of what the program cuts (its cut bounds, so travel to and from the origin does not inflate it; the
whole program's bounds when nothing cuts), and the cut length. On the right are the Classic / Studio look switch and icon toggles for
the source, the readouts and full window. Their accessible names stay "Hide source" / "Show source",
"Hide readouts" / "Show readouts", and "Full window" / "Exit full window". The uppercase label and
the subtitle are gone; a live run still says "Watching the started program".

The canvas view's name, "Design changed" note and Refresh button lead that row once a program is
ready (`InspectorView`'s `lead`). While the design compiles or has no program, they stay in a bar of
their own.

### Decision 2 - Everything over the scene is dark glass

Overlays over the scene use the viewer's own tokens (`--lf-viewer-*` on `.gcode-viewer-body`), not
the app theme: a translucent near-black, a hairline light edge, light text. Inside them the app's text
and border tokens are re-scoped to those values, so the legend and the stock switches written
against `--lf-text-muted` read correctly without being rewritten. There is no backdrop blur, because
it would re-blur the WebGL canvas on every playback frame. The move tip uses the same material.

They sit in four places: the readout top-left, the view toolbar top-right, the travel switch (and in
the canvas tab the legend above it) bottom-left, and the view cube and stock switches bottom-right.
The readout's numbers are monospaced and its fixed width stays (the Chrome software-renderer note in
the stylesheet).

### Decision 3 - One slim view toolbar

The camera card becomes a single row in three groups, split by hairlines: camera mode as icons
(Manual, Follow, Auto views), the standard views as short words (Iso, Top, Front, Right), and the
tools as icons (Ortho, Fit, Measure, Save image). Measure moves here from the hint bar. "PNG" becomes
"Save image", whose tooltip says it saves a PNG. Each icon button's accessible name is its old label,
so keyboard, screen-reader and end-to-end paths are unchanged.

### Decision 4 - Hints only while they help

The bottom-left strip holds the Travel switch, whose swatch is the scene's dashed traversal red. It
shows a hint only while the measure tool runs (its two steps) or while the view has the keyboard
(the keys, ADR-470). The mouse hint moves to the Manual button's tooltip. The "Faint path" note is
dropped.

### Decision 5 - A transport in one row, with a scrubber that shows the program

The transport is one row: icon buttons for Restart, step back, Play / Pause (the one filled accent
control in the viewer) and step forward, with their accessible names unchanged; the scrubber; the
clock as `m:ss / m:ss est.` in monospace; and compact selects for speed and trail ("Full trail",
"Trail 60 s" ...). The container keeps its "Playback estimate" accessible name.

The scrubber's track shows which stretches of the program's time cut, travel, or plunge and retract
(`timeline-bands.ts`). The motion time is divided into 240 bins; each bin takes the kind that spent
the most planner seconds in it, and runs of one kind merge into bands. It is one pass over the moves
whatever the program's size, worked out once per program. Cutting uses the app accent, travel the
scene's traversal red (LightBurn's convention, `viewer3d-theme.ts`), plunges and retracts amber. The
part still to play is dimmed.

A live run keeps its reported-progress bar, with no transport (a live job is observational).

### Consequences

- No viewer behaviour changes; every control keeps its action and accessible name except "PNG",
  now "Save image".
- Unit tests find the transport and toolbar buttons by accessible name; the trail options' new
  wording is pinned in `InspectorTimeline.test.tsx`; `timeline-bands.test.ts` pins the band maths.
- The viewer's own icons live in `src/ui/gcode-inspector/viewer-icons.tsx` on the kit's 24-unit grid,
  because only the viewer uses them.
