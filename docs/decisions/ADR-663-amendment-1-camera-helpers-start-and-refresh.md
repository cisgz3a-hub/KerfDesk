## ADR-663 Amendment 1 - The camera starts and refreshes by itself (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

This amends ADR-663. It adds the first two of the helpers the maintainer asked for: "Auto-start my
camera" ("Remember your camera and start it when you open KerfDesk or connect the laser") and
"Auto-refresh the picture" ("Update the bed picture when a job finishes, plus a hotkey (Alt+C like
LightBurn) to refresh any time"). Camera sources, calibration, the overlay, Frame, Start and output
do not change, and no guard is added or removed (ADR-228).

### Decision

- **Remember the camera.** When a camera goes live, KerfDesk keeps its kind on this computer:
  the laser's own camera, USB, RTSP or phone. A USB camera is also remembered by the device that
  actually opened (the stream's device id), not the picker's default. Addresses are the existing
  credential-free RTSP and phone preferences (ADR-116, ADR-448).
- **Start it again.** With **Start my camera by itself** on (Camera settings → Helpers, default
  on), the remembered camera starts:
  - when the Camera panel opens, after the machine-camera probe;
  - when a calibration is saved on the machine, KerfDesk opens with one, or the laser connects,
    for a camera that has a calibration: its picture then shows on the canvas without opening the
    panel. The laser's own camera (Falcon A1 Pro) answers only once the laser is connected, so a
    camera not found earlier is looked for again then.
  Each start acts only when no camera is running, starting or showing a problem, tries once, and
  stays quiet when the camera is not there (a problem shows in the Camera panel as for a camera
  started by hand). A USB camera starts only when the remembered device is plugged in; another
  camera, such as a laptop's own, is never started in its place. The hosted Free build does not
  start a camera with KerfDesk or the laser, since it draws no calibrated picture.
- **Refresh after a job.** With **Refresh the picture after each job** on (default on), a held
  picture (Refresh picture) is taken again when a job finishes, after the burn check's settle time
  (`AFTER_SETTLE_MS`, 3 s). A live picture needs nothing. A stopped or failed job, a head camera
  and a camera that is not running are left alone, and a failure is quiet.
- **Alt+C** (Option+C on macOS, matched like Alt+T) refreshes the picture from anywhere outside a
  text field, LightBurn's Update Overlay key. It takes a new held picture, shows the overlay and
  latches camera placement, as **Refresh picture** does. With no camera running it opens the Camera
  panel, which starts the remembered camera, and refreshes once that camera runs (within 30 s). It
  says why when it cannot: no camera, not set up yet, or a camera on the laser head (whose pictures
  are taken with Capture here or Capture bed).

### Consequences

- An operator with a calibrated camera sees the bed on the canvas once the laser is connected,
  without opening the Camera panel, and keeps the picture current with Alt+C or by itself after
  each job.
- The camera can turn on without a click. Both helpers can be switched off, and nothing starts a
  camera that was never used on this computer.
- A head camera's after-job picture still needs Capture; the helpers never move the head.
- WORKFLOW F-CAM1, F-CAM3 and F-A15 and the shortcut list describe the helpers. They are not
  checked on the Falcon's camera or any other hardware.
