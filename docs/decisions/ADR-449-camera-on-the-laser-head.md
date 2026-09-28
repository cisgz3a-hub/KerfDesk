## ADR-449 - A camera on the laser head (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

Some lasers carry their camera on the laser head instead of above the bed, and some owners mount
a small camera beside the laser module because the lid is too low for an overhead camera. LightBurn
supports such a camera by moving the head over the bed and joining the pictures it takes. The
camera plan's batch 6 asked for the same.

A camera on the head differs from an overhead camera in three ways:

- **It moves.** Its picture shows a different part of the bed wherever the head goes, so a
  calibration alone cannot place it; the head position at the photo has to be known too.
- **It sees a small patch.** From 50–100 mm above the bed it sees a few centimetres, so the
  whole-bed ring target of ADR-441 does not fit in one picture.
- **It needs the machine to see more.** A picture of a larger area means moving the head to
  several places and joining the pictures.

The camera model of ADR-440 already treats each pixel as a ray and finds where it meets the
material. The camera turns with the head only if the head turns, which a gantry head does not, so
moving the head by `d` moves the camera by `d`: the pose `x_c = R·x_w + t` becomes
`x_c = R·(x_w − d) + t`. Everything else is unchanged.

### Decision

1. **Calibrating.** The calibration wizard gets **Camera rides on the laser head**. With it
   ticked, the target is a small square (**Target size**, 40 mm by default, in place of
   **Margin**) in the middle of the bed. After engraving, the operator jogs the head until the
   camera sees the whole square and takes the photo. KerfDesk records where the head was, read
   from the machine position with the verified controller-to-bed mapping that **Move laser here**
   uses. The saved calibration gets a `mount` of `{ kind: 'head', headAtCalibrationMm }`. The
   fitted pose includes the camera's offset from the beam and any tilt, so nothing is measured by
   hand. **Check camera** places the saved calibration at the head position of the check photo.
2. **Placing.** Wherever the head is, the camera in use is the saved calibration moved by how far
   the head has gone since the calibration photo. Every camera feature (the overlay, Trace from
   camera, Find pieces, the accuracy map, height areas) reads the model through one place, so all
   of them follow the head. While the head position is unknown (not connected, or the mapping not
   verified), a head camera is not used, and the Camera panel says what it needs.
3. **Capture here.** Takes one picture where the head is, without moving it, and shows it on the
   canvas as a top-down picture of that patch.
4. **Capture selection / Capture bed.** Moves the head over the selected objects' box, or the
   whole bed with nothing selected, and takes a picture at each stop:
   - The stops are a grid, travelled in rows that turn back at each end. Neighbouring pictures
     share 20% of their width, and only the middle 80% of each picture is used, where a close-up
     lens is sharpest.
   - Each move is the same beam-off jog as **Move laser here**, under the same readiness rules.
     A picture is taken once the machine reports Idle within 0.1 mm of the stop, plus 300 ms, and
     is the second of two, so a network camera cannot return a picture it began while moving.
   - The pictures are joined into one top-down picture with feathered seams, at up to 4 px/mm and
     at most 3000 px a side, and shown on the canvas in place of the live picture until **Live**
     is pressed or a still replaces it.
   - **Stop** cancels the jog in progress and shows the pictures already taken.
   - Stops are kept on the bed. When the head cannot travel far enough for the camera to see an
     edge of the area, the picture stops short of it and the panel says so.
5. **No new gate.** The captures use the existing jog and its messages. A head camera without a
   known head position is not a refusal; its picture simply has nowhere to go until the machine
   reports where the head is (ADR-228).

### Consequences

- A head camera needs a homed machine, or a controller-to-bed mapping confirmed another way, just
  like **Move laser here**. Placement is as good as the machine's repeatability.
- A head with a moving Z carries the camera up and down with it. The calibration holds at the Z
  it was taken at; after changing Z, return it there or calibrate again.
- The joined picture is flattened at the material height set when it was taken. Changing the
  height afterwards needs a new capture.
- Capturing moves the machine. It has not yet been tried on a real head camera; the first
  capture should be watched with a hand on Stop.
