## ADR-426 - One 3D engine and a switchable Studio view (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

The second of five batches from the 2026-09-26 audit of the three.js viewers. Batch 1 (ADR-425)
fixed what the viewers got wrong. This batch gives every 3D view one camera feel and one mouse map,
adds the controls the audit found missing, and adds Studio, a second look for the G-code Inspector.
The operator asked to keep the current look as the main one, so Classic stays the default and
Studio is a switch.

### Context

1. **Three mouse maps.** Left-drag orbited in the G-code Inspector, panned in Cut 3D and the relief
   views, and drew in Design Studio. Right-drag panned in the Inspector and orbited everywhere
   else. The middle button zoomed everywhere except Design Studio, where it panned. An operator
   moving between views dragged the wrong way.
2. **No shared camera feel.** Every view stopped dead the moment the mouse let go, and each view
   wired its own rendering to the orbit controls, so there was no one place to change how a
   camera moves.
3. **Plan views in perspective.** Top, Front and Right were perspective views. A drilled hole read
   as a slanted stroke from above and a straight wall looked tapered. There was no orthographic
   view and no view cube.
4. **The Top view rolled.** Top set the camera's up to +Y. The orbit controls fix their orbit axis
   from the camera's up when they are created, so after Top the next orbit rolled the job.
5. **Only one look.** The Inspector has one look: pale lines on a flat grey stage. The audit's
   proposed look (a lit tool model, a job box with sizes, a floor that fades out) had nowhere to
   go without replacing the look operators know.
6. **The Inspector drew a generic bit.** KerfDesk's CNC programs state each tool in a comment
   (`; cnc tool: ball; diameter-mm: 3.175`), but the Inspector read only T words, so it could not
   show the real bit or colour the program per tool with the tool's name.
7. **Smaller gaps.** The Inspector could not hide its readouts or fill the window. A closed viewer
   left its WebGL context alive until the browser collected it, so opening and closing viewers
   could hit the browser's context limit.

### Decision

1. **One mouse map for every 3D view** (`ui/viewer3d/viewer3d-controls.ts`).
   - Right-drag orbits, left-drag pans, the middle button pans, and scroll zooms toward the cursor.
     Every view reads its drag actions from one table (`VIEWER3D_MOUSE_MAP`), and every hint is
     built from it (`VIEWER3D_MOUSE_HINT`).
   - This changes the Inspector: left-drag now pans instead of orbiting. The middle button pans
     everywhere, where Cut 3D used to zoom with it.
   - Design Studio keeps the left button for drawing (`leftButtonFree`); its right and middle
     buttons follow the map.
2. **One camera feel.** Every view glides briefly after a drag (orbit-control damping), and pans
   in screen space. The glide is off when the operator asks the system for reduced motion, and a
   named view ends any glide first (`stopViewer3dGlide`). `createViewer3dGlideRendering` keeps
   rendering while a glide runs and stops when it settles, so an idle view draws nothing.
   - Cut 3D draws in an offscreen worker without orbit controls, so it gets the same feel by hand.
     Its worker camera turns by the same angle per dragged pixel (`viewer3dOrbitRadiansPerPixel`)
     and zooms toward the cursor. During and after a drag, the page sends a fading share of its
     remaining pointer displacement, with the same damping factor (`cut3d-offscreen-glide.ts`).
     The settled movement equals the requested drag distance: it does not extrapolate extra
     travel from release speed. A new drag, the wheel, a key or cancellation ends the glide.
3. **Named views, orthographic views and a view cube** (Inspector).
   - Up is always +Z in every view, so orbiting after Top never rolls.
   - Top, Front, Right and the cube's faces draw orthographically; Iso draws in perspective. An
     Ortho button switches the projection of any view by hand. The orthographic camera copies the
     perspective camera's pose each frame and frames the same target plane, so switching never
     jumps and zoom, follow and view animations work the same in both.
   - A view change animates on the shortest arc around the target (about half a second, and at
     once with reduced motion). Fit frames the whole job from the current angle.
   - A job seen end-on, such as a straight line along its own length or one plunge seen from
     above, projects to a point. Its view still spans the minimum 10 mm, so the camera never sits
     on the target, where the orbit has no direction.
   - The view cube is drawn in a scissored corner of the main renderer, so it costs no second
     WebGL context. A DOM hit area over the corner takes the clicks and keeps a drag there from
     orbiting the view. Clicking a face turns the view to face it.
4. **Studio, a second look** (`studio-stage.ts`, `studio-furniture.ts`, `studio-tool-models.ts`).
   - A Classic / Studio switch in the Inspector header. Classic is the default and is unchanged:
     same line colours, same grid, same triad. The choice is remembered per browser.
   - Studio adds a soft gradient background and image-based lighting from a small prefiltered
     light box, shared with the relief views (`viewer3d-environment.ts`).
   - A floor grid (10 mm and 50 mm lines) sits under the job and fades out beyond it. The job box
     carries its width, depth and height as CAD-style dimension lines. A labelled axis triad marks
     the work origin. A laser program shows the machine's work area when its frame is known
     (a laser device with an absolute start).
   - The playhead shows the job's own bit, true to scale, in a collet and holder. Its cutting shape
     is `core/sim`'s `toolProfile`, the silhouette the cut simulation stamps with. A laser program
     shows a diode head with its beam. When the program states no usable geometry, Studio shows no
     tool rather than a guessed one.
   - Studio lines show exactly the colour their legend shows: its vertex colours go in as linear
     values, and only the lit tool model is tone mapped. Its ramps are ordered dark to bright and
     stay readable with colour-vision deficiency. Rapids are dashed, so a rapid never reads as a
     cut whatever the lens.
   - Studio parts are built on first use and kept until the view closes, so switching back and
     forth costs nothing after the first time.
5. **The program's own tools** (`gcode-inspector/program-tools.ts`, `tool-sections.ts`).
   - The Inspector reads KerfDesk's `; cnc tool-id:`, `; cnc tool-name:` and `; cnc tool:` comments
     and combines them with T words. Each move belongs to the tool in force when it runs.
   - The Tool lens colours each tool on its own and names it in the legend (for example
     "3.175 mm ball nose"). The viewport shows the current tool beside the playhead.
6. **Layout.** The Inspector header can hide the readouts and the source, and can fill the window
   (the browser's full-screen API, where it has one).
7. **Context release.** Closing a viewer disposes its renderer and, when its canvas has left the
   page, forces the WebGL context loss (`disposeViewer3dRenderer`). A canvas still on the page
   (React StrictMode reuses it) keeps its context.

### Consequences

- An Inspector user who orbited with left-drag now pans with it and orbits with right-drag, the
  same as Cut 3D and the relief views. Cut 3D and the relief views no longer zoom with the middle
  button; scroll zooms everywhere. The hint under every view says so.
- Studio makes the lit tool model and its environment part of the lazily loaded 3D chunk. They
  are built only when Studio is first chosen.
- A program from another CAM has no tool comments. Its tools come from T words only, labelled
  "Toolpath" in the legend, and Studio shows no bit for it.
- The Cut 3D axis triad still marks the stock's min-XY corner. Cut 3D moves are drawn in the design
  scene frame, and placing the triad at the work zero needs the job placement carried into the
  stage. Getting that wrong would show the origin in the wrong place, so it waits for batch 3,
  which adds the measuring tools that need the same frame.
- **Not a guard (ADR-228).** Nothing here blocks, refuses or asks for confirmation. The tool
  model, the dimensions and the work area are drawings; CAM and G-code are unchanged.

### Verification

- Unit tests:
  - Camera: `tweenPose` follows the shortest arc and lands on the target pose; `easeOutCubic`;
    `syncOrthographicCamera` frames the same target plane as the perspective camera; Top looks
    straight down with up +Z; the mouse map and hint.
  - End-on jobs: a straight line along X, along Y, and a single deep plunge, in every named view
    and three aspect ratios, keep a view of at least 10 mm and a finite animation path. Before the
    fix, an orthographic view of such a job put the camera on its target (distance 0), and the
    animation to it produced NaN positions.
  - Cut 3D: the orbit turns by the shared angle per pixel; a wheel zoom keeps the point under the
    cursor in place; actual pointer gestures settle to the same orbit and pan as the installed
    OrbitControls, including the reduced-motion case. The remaining displacement drains within
    a second for the focused fixture, a held-still drag adds no new travel, and new input or
    cancellation stops the pending glide.
  - Tools: `programToolCollector` reads id, name and geometry and ignores `(blank)` names;
    `buildToolSections` assigns each move to its tool with and without T words; `toolAtSegment`.
  - Studio: `studioToolSpec` builds the bit from the stated geometry, a laser head for a laser
    program, and nothing when the geometry is missing or invalid; Studio lens colours and legends;
    the look preference survives a reload and falls back to Classic.
  - Inspector controls: Fit, Ortho, the look switch and Hide / Show readouts reach the scene.
  - The bit preview keeps its WebGL context while its canvas is on the page and releases it after.
- Browser: screenshots of the Inspector in both looks with a CNC relief program and a laser
  program. Classic matches its batch-1 screenshots.
