## ADR-663 - Camera setup is a guided wizard and an everyday panel (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

This reorganises the Camera panel of ADR-107/116 and the calibration wizard of ADR-441. The
camera model, the one-photo calibration and its fit (ADR-440, ADR-441 and its amendments), every
camera source (ADR-116, ADR-121, ADR-448, ADR-449), several calibrated cameras (ADR-446), the
overlay, trace, pieces, height areas, Print and Cut marks and job watching are unchanged. Frame,
Start and output do not change, and no guard is added or removed (ADR-228). Calibrating stays a
Pro tool (ADR-540).

### Context

The maintainer, who uses a Creality Falcon A1 Pro with its built-in camera, said: "My camera setup
I have is absolutely horrible and I dont even know how to use it. I want to redesign the camera set
up as it should've been from the start. easy to use. smart and convenient."

The panel stacked every section at once: machine detection, RTSP, phone and USB sources (although an
operator has one camera), a two-step strip, the calibration button, the calibrated cameras, the
overlay row, snapshot, job watching and diagnostics. The wizard's first screen asked for sheet
thickness, camera height, power, speed and margin, and a "camera rides on the laser head"
checkbox, in one block of text. The controls used every day (show on canvas, refresh, material
height, trace) appeared only after calibration and sat among the rest.

Research (2026-10-22):

- LightBurn 2.1 lists cameras with previews and adds one through a wizard: type, source, lens
  calibration, workspace alignment, Finish. It has a preset for the Falcon A1 Pro camera. Its
  overlay controls are Update Overlay (Alt+C), Trace Overlay and an Adjust Overlay group with
  opacity and X/Y shift. Its troubleshooting leads with overlays thrown off by a moved camera or
  lid, or by material of another thickness.
- Glowforge and xTool make the camera picture the bed: one Refresh, the material height measured
  for the operator, and Batch Fill finds blanks and places the design on each.

The maintainer chose "a guided setup plus a simple everyday panel" over a canvas-wide camera mode
and over tidying the existing panel. They asked for four smart helpers (auto-start, auto-refresh,
a "camera moved?" warning and a quick nudge fix) and kept every existing tool. This decision covers
the layout; the helpers follow as their own amendments.

### Decision

- **The everyday panel.** The Camera panel opens on what the camera sees: one preview card with the
  camera's plain name ("Laser's built-in camera", the USB camera's label, "Phone camera", "Network
  camera") and one primary button. When the bridge found the laser's camera it is **Use this
  camera**; otherwise **Start camera** starts the chosen USB camera. **Choose camera…** opens the
  settings page. Below the card:
  - before the running camera is calibrated, one **Set up your camera** card with **Set up
    camera**, which opens the guided setup (ADR-540 gate as before); in the hosted Free build a note
    that lining the picture up is a Pro tool in the desktop app;
  - once calibrated, the bed-picture controls: **Refresh picture** (the still, LightBurn's Update
    Overlay), **Live**, **Trace from camera**, **Show on canvas** with an opacity slider, and
    **Material height**, then the folds **Fill blanks** (pieces, ADR-442) and **Raised objects**
    (height areas, ADR-441 Amendment 2). A head camera keeps its capture row (ADR-449);
  - the **Watch the job** fold (ADR-490), shown with or without a calibration.
- **The settings page.** The gear opens **Camera settings** inside the panel, with a back arrow:
  **Which camera** (machine detection, RTSP, phone and USB, or the hosted notice), **Calibration**
  (**Set up camera…**, or **Recalibrate…** and **Check camera…** with the accuracy summary and the
  **Accuracy map** toggle, then the calibrated cameras of ADR-446), **Picture** (snapshot and the
  larger monitoring view) and **Diagnostics**.
- **The guided setup.** The wizard ("Camera setup") gains three screens before the target, with a
  progress row of six steps: **Camera** (the laser's camera and each USB camera as one card with
  **Use this camera**, a fold for network and phone cameras, and the running camera's picture;
  Next needs a running camera), **Mounting** (two picture cards, **Above the bed** and **On the
  laser head**, replacing the checkbox), **Picture** (the live picture, measured every three
  seconds, and three reminders: the camera sees the bed, cannot move, and is sharp), then
  **Target**, **Photo** and **Save** as before. The target screen leads with the sheet and its
  thickness and names the mounting with **Change**; power, speed, margin or target size, and the
  camera height fold into **Engrave settings**. **Recalibrate…** opens at the target and **Check
  camera…** at the photo, as before (check mode shows Target, Photo, Compare).
- **The picture check is advice.** It measures the Rec. 601 luma of up to 40,000 sampled pixels:
  an average below 60 says the picture is dark, more than 5 % of samples at 250 or above says part
  of it is washed out, and the bed's long side over the picture's long side (and short over short)
  gives the finest millimetres per pixel the picture allows, flagged above 0.5 mm. Next is always
  offered; nothing is refused on it.
- **Names.** **Update still** becomes **Refresh picture**, **Overlay on/off** becomes **Show on
  canvas** (pressed when shown), **Fade** becomes **Opacity**, **Material surface height** becomes
  **Material height** (its input keeps its accessible name), and **Start USB camera** stays in the
  USB section of the settings page.
- **Free build boundary.** The wizard module joins `PRO_BUILD_ENTRIES`, since the panel now mounts
  it directly; the calibration controls, overlay controls and calibrated-camera list stay stubbed.

### Consequences

- An operator with one camera sees one camera and one button, and reaches calibration from one
  card. Sources they do not use, diagnostics and the calibrated-camera list move one click away.
- The wizard is longer by three screens on a first setup, each a single decision; recalibrating and
  checking are as short as before.
- The picture check can call a dimly lit but usable picture dark, or a white sheet under bright
  light washed out. It only advises, and its thresholds are KerfDesk's own, not a measured
  detection limit of the ring finder.
- Tests, the camera tutorial and WORKFLOW F-CAM1, F-CAM2, F-CAM3 and F-CAM8 describe the new
  layout. Nothing here has been checked on the Falcon's camera or any other hardware.
