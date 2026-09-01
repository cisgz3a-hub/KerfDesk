# Laser production workflows

## Device and Labs setup

1. Open **Machine Setup** and choose the closest supported profile.
2. Connect, read controller settings, and confirm the work area, origin, maximum feed, and power scale.
3. Open **Tools > Labs** only for workflows that still use a local experimental switch.
4. Keep low-power Fire, Print and Cut, and camera alignment v2 disabled unless the connected profile supports them. Rotary setup and G-code output do not use a Labs permission; their physical qualification remains operator-owned and is disclosed in Job Review.

## Rotary jobs

1. Open **Tools > Rotary Setup**.
2. Choose Roller or Chuck, enter the object diameter, and set direction. Chuck mode also requires machine motion per revolution.
3. Generate the calibration pattern and measure it on the actual attachment before running artwork.
4. For raster output, review the rotary qualification warning and use a supervised low-risk test to establish scale, direction, seam placement, focus, workholding, and material response. The warning informs and never refuses output.

## Variable text

1. Add or edit text and enable **Variable text**.
2. Insert date, time, serial, cut-setting, or an embedded CSV-column field.
3. Set the current record and serial number. Manual advancement is the default.
4. Choose automatic advancement only after a completed stream or successful export. Cancelled, refused, and failed jobs do not advance.
5. Preview, Frame, estimate, export, and Start all evaluate the same prepared snapshot.

## Arrays and nesting

1. Select artwork and open **Arrange > Array** for a grid or circular layout.
2. Use **Arrange > Quick Nest** to pack selected unlocked parts into the workspace or placed board.
3. Set spacing and 90-degree rotation policy before applying.
4. The operation is deterministic and commits as one undo step; inspect Preview before output.

## Print and Cut

1. Use a homing-enabled absolute-position profile and enable Print and Cut in Labs.
2. Home the machine, open **Tools > Print and Cut**, and enter two distinct design targets.
3. Move the head to each printed target and capture its machine point.
4. Apply registration and keep absolute placement active. Job-origin placement is **not** disabled while registered — if registration and a non-absolute job origin are both active, Frame and Job Review warn that the physical Frame traces the combined transform. Confirm the traced position before continuing.
5. Re-register after disconnect, alarm, reset, release-motors, or any trusted-position loss.

## Camera sources

1. Open **Camera** and start a USB camera directly, or expand **RTSP camera** for a private-network `rtsp://` source.
2. Browser RTSP use requires `pnpm camera:bridge` in a separate terminal; KerfDesk Desktop starts the loopback bridge automatically.
3. Open **Diagnostics** and confirm the bridge, frame proxy, FFmpeg, active source, and readable-pixel capture before calibration.
4. Calibrate the lens, align the camera to the bed, and repeat alignment after camera position or resolution changes.
5. Treat an unavailable bridge, missing FFmpeg, failed capture, or stale preview as a blocked camera workflow; reconnect and rerun Diagnostics before alignment or trace.

## Material libraries

1. Open the **Materials** tab in the Cuts / Layers panel, then open **Saved Libraries**.
2. Import KerfDesk libraries or use **Import CLB** for supported LightBurn material-library records.
3. Review imported speeds, power, passes, thickness, and warnings; CLB support is import-only.
4. Apply a preset for a one-time copy or Link it to retain the library and preset identity.
5. If a linked library or record disappears, KerfDesk uses the last-resolved settings and shows a stale-link warning.

## Curve-native design

1. SVG, DXF, trace, text, and supported LightBurn project geometry retain canonical curves.
2. Use node editing for anchors, cubic controls, corner/smooth conversion, Join/Break, and start-point selection.
3. Join connects two selected endpoints from open subpaths in the same colored path. Selecting the
   two endpoints of one open subpath closes it; click order never changes source-order output.
4. Interior anchors, closed paths, and anchors with incompatible ownership remain selected and get
   a nonblocking explanation instead of a disconnected cut or silent success.
5. Imported fonts are embedded with stored outlines. Missing fonts remain renderable but must be relinked before text edits.
6. Text can bend or follow a selected vector guide; output flattening happens only at preview and machine boundaries.

## Output check

1. Confirm the intended output layers and material settings.
2. Use Preview to inspect cut order, travel, curves, arrays, variables, nesting, and registration.
3. Frame on the connected machine with the laser off.
4. Start is opened by that completed Frame for the exact current job — nothing else gates it. Bounds, position, controller readiness, raster, and curve-segment findings surface as Job Review warnings, which inform and never refuse (ADR-228; `CLAUDE.md` rule 7).
