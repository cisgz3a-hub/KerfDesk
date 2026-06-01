# Set Origin Research Evidence - 2026-06-01

Scope: audit whether LaserForge's Set origin here behavior matches the operator expectation that an imported/traced image can run from the current head position.

## External References

### LightBurn

Source: https://docs.lightburnsoftware.com/legacy/CoordinatesOrigin

Relevant behavior:

- Absolute Coordinates uses the workspace/grid position as the machine location.
- Current Position outputs relative to the laser head position at Start.
- User Origin is like Current Position, but uses a previously set programmable point.
- In both Current Position and User Origin, the Job Origin control determines which point of the job bounding box is aligned to that position.

Audit implication: Set Origin alone is not the whole placement model. LightBurn combines a start reference with a separate job-origin anchor.

### GRBL

Sources:

- https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Commands
- https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Interface

Relevant behavior:

- `$#` reports coordinate offsets including G54-G59 and G92.
- GRBL treats G92 as non-persistent compared with work-coordinate parameters.
- Jog commands without `G53` use the work coordinate frame.
- WCO is the active work coordinate offset; the relationship is `WPos = MPos - WCO`.

Audit implication: `G92 X0 Y0` is a valid way to make the current physical head position read as work coordinate 0,0, but subsequent `G90 X... Y...` commands still target the numeric work coordinates emitted by the job.

### LinuxCNC manual

Source: https://linuxcnc.org/docs/stable/html/gcode/coordinates.html

Relevant behavior:

- G92 sets offset variables using the current axis location.
- `G92 X0 Y0` makes the current location read as X0/Y0 without motion.
- G92.1 clears the G92 variables.

Audit implication: G92 changes coordinate interpretation; it does not rewrite a CAM program so its object bounds start at zero.

### Open-source controller scan

Source inspected with GitHub CLI:

- https://github.com/cncjs/cncjs/blob/48550474bd6b0bf375997f2d779f1f440b16aa4d/src/app/widgets/Axes/DisplayPanel.jsx

Observed pattern:

- CNCjs separates Work Coordinate System commands (`G10 L20`), Temporary Offsets (`G92` / `G92.1`), and Machine Coordinate System (`G53`).
- This confirms that controller zeroing is treated as a coordinate-system action, not as a job-bounds anchoring action.

LaserGRBL source was also sampled read-only for terminology and G-code support, but it is GPL; no implementation ideas were copied.

## Local Evidence

### Set Origin command path

- `src/core/controllers/grbl/commands.ts:52` defines `CMD_SET_ORIGIN_HERE = 'G92 X0 Y0'`.
- `src/ui/state/origin-actions.ts:40-41` sends that command with a newline.
- `src/ui/state/origin-actions.test.ts:11-15` pins the exact write.

This part is internally consistent and matches GRBL semantics.

### Import placement path

- `src/ui/common/image-import.ts:20-28` creates imported raster bounds anchored at object-local `0,0`.
- `src/ui/state/scene-mutations.ts:201-208` calls `fitObjectToBed` for fresh imports.
- `src/core/scene/fit-to-bed.ts:23-34` keeps small imports at scale 1 and centers them on the bed by setting `transform.x` and `transform.y`.

Concrete consequence on the default 400 mm by 400 mm front-left device:

- A 50 mm by 30 mm imported image gets transform `x = 175`, `y = 185`.
- Scene bounds become X 175..225 and Y 185..215.
- Front-left machine coordinates flip Y, so emitted/job bounds become roughly X 175..225 and Y 185..215.
- After `G92 X0 Y0` at the workpiece corner, a `G90 X175 Y185` frame/start move is still 175 mm by 185 mm from the user-set origin.

### Compile/frame path

- `src/core/job/compile-job.ts:138-147` applies object transform and device origin transform to raster bounds.
- `src/core/job/compile-job.ts:231-233` does the same for vector paths.
- `src/core/output/grbl-strategy.ts:30-37` emits absolute `G90` G-code.
- `src/ui/laser/JobControls.tsx:223-249` frames the compiled job bounds.
- `src/ui/state/laser-store.ts:332-343` sends frame jogs as `$J=G90 G21 X... Y...`.

No step subtracts the job's selected/imported bounding-box anchor when User Origin/Set Origin is active.

## Root-cause Model

Current implementation correctly sets controller work zero, but LaserForge currently has only the equivalent of absolute workspace job placement. It lacks the LightBurn layer that says "align this point of the job bounding box to the current/user origin."

That is why imported/traced images appear to use the canvas or bed placement after Set Origin. The controller origin changed, but the job's own coordinates did not.
