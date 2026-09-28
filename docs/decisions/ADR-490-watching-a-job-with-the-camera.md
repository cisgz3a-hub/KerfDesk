## ADR-490 - Watching a job with the camera (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

The camera plan's batch 7 is about the job itself rather than setting it up. Other laser programs
offer little here. LightBurn and xTool Creative Space show the live camera while a job runs, and
some machines' own apps record a timelapse, but none of them check what the laser actually did.
KerfDesk already knows the job's exact path on the bed (the live canvas trail follows it), and a
calibrated camera fixed over the bed can flatten a picture onto the same bed millimetres
(ADR-440). Comparing a picture from before the job with one from after tells where the bed
changed, and the path says where it should have.

The pictures are honest only within limits, which the design has to respect:

- The laser head and the gantry are in view. They are in different places before and after the
  job, so they show as changes.
- The camera's exposure can differ between two pictures.
- A thin cut line is a few camera pixels at most, and the calibration is good to about half a
  millimetre.
- Light parts of an image engrave burn faintly and may not show at all.

### Decision

1. **Watch the job.** The Camera panel gets a **Watch the job** section with two choices,
   remembered per computer like the other camera choices: **Record a timelapse** (every 2, 5, 10
   or 30 s) and **Check the burn when a laser job finishes**. While either is ticked, the camera
   keeps running when the panel closes, so it is there when a job starts. Nothing moves the
   machine: pictures are taken wherever the head is.
2. **When a job starts and ends.** A job starts when a new live run begins streaming, and ends
   when that run is finished, stopped, lost or failed. The watcher reads the laser store; it adds
   no step to Start and cannot hold a job back.
3. **Timelapse.**
   - While the job runs (not while paused), one frame is kept every interval.
   - A long job never keeps more than 480 frames. At the limit, every other frame is dropped and
     the interval doubles, so the frames stay evenly spaced over the whole job.
   - Once the job has ended and the smoke has had 3 s to clear, one last frame shows the result.
   - With a camera fixed over the bed and calibrated, the frames are flat pictures of the job's
     area plus 10 mm, square-on. With any other camera they are the plain camera frames. The
     frames are stored as JPEG, at most 1024 px a side.
   - The panel plays the frames. **Save video…** records them at 15 frames a second with the
     browser's own recorder, as MP4 where the browser can record it and WebM otherwise.
4. **Burn check.** Only a laser job, with a camera fixed over the bed and its own calibration, and
   a plan that can be placed on the bed, is checked. Otherwise the panel says why not.
   - **Pictures.** The first picture is taken as the job starts. The second is taken 3 s after
     the job finishes. Both are flattened over the burned area plus 10 mm, at up to 4 px/mm. If
     the job had already begun burning when the first picture arrived, the path up to where the
     head was confirmed (plus 10 mm) is allowed to show a burn but is not checked.
   - **Changes.** Both pictures are softened 3 × 3. The median brightness change away from the
     path is taken as the camera's exposure change and removed. A pixel has changed when its
     brightness moved more than 24 of 255 steps. Single changed pixels are ignored as noise.
   - **The path.** Every lit move of the started plan is drawn at the beam's width (the machine's
     spot size, 0.2 mm when unknown), and a zone 1 mm wider on each side.
   - **Hidden.** Bed the camera did not see is hidden. So is a 35 mm circle round the head's bed
     position in either picture, when the machine reports it. So is any change that reaches the
     picture's edge: the 10 mm margin keeps every burn clear of the edge, so such a change is the
     gantry, a hand or the material moving. Hidden bed is left out of every figure.
   - **Verdict.**
     - The share of the seen path with a change within 1 mm of it.
     - Stray marks: changed groups of at least 1 mm² outside the zone, with their total area.
     - The share of the path that was hidden.
   - **Showing it.** The verdict is shown in plain words ("The camera sees a change along 97% of
     the path"). The after picture is drawn on the canvas with missed path in red, stray marks in
     amber, and hidden bed dimmed.
   - **Taking it again.** **Take the after picture again** takes a new after picture and checks
     again, for when the head was in the way. The operator jogs the head clear first.
5. **No new gate.** The watcher never refuses or delays a job. A check it cannot make says so in
   the panel (ADR-228).

### Consequences

- The burn check compares pictures; it does not measure depth or darkness. A light engrave on
  pale material, or light parts of an image engrave, can read as missed.
- A gantry parked over the job in the after picture hides what it covers. The panel reports the
  hidden share and offers the retake.
- The check runs in the app window when the job ends. A bed-sized job takes up to a second or so.
- Making the video takes as long as the video plays (about 30 s for 480 frames).
- A job continued after a lost connection is a new job to the watcher. It starts a new
  timelapse, and its check covers only the part it burned.
- The timelapse and the check live until the next watched job or **Clear**. They are not saved
  with the project.
- Not yet tried on a real machine. The first real jobs should be compared with what the panel
  says.
