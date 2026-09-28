## ADR-495 - Automatic overscan from speed and acceleration (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

Builds item 2 of the Rayforge comparison's build list, under the owner's direction of 2026-09-27 to
build everything Rayforge does better and make it better than theirs. The switch is off by default:
an existing project emits the same G-code. No new guard or refusal (ADR-228).

### Context

Every Image and Scan Line runway was a stored length: 5 mm by default, or what the operator typed
(ADR-415). In the comparison, Rayforge's fill and photo jobs finished 15 to 19% sooner at
3000 mm/min, mostly because of that fixed runway; the physics needs about 2.5 mm there at
500 mm/s². Rayforge computes its overscan, but it uses half the distance physics needs, measures
along X whatever the angle, and keeps the value from when the step was set, so it goes stale when
the speed changes.

KerfDesk already knew the physics: Cut Settings' Overscan note states v² / 2a for the saved speed
and acceleration, and Job Review warns when a runway is shorter than that (`scan-quality-warnings`).

### Decision

1. **One optional operation setting.** `autoOverscan` joins `LayerOperationSettings`, artwork
   overrides and sub-operations. The validator checks its type; it is captured only when set, and
   Copy and Paste settings carries it. Absent or false means the stored overscan, byte for byte.
   There is no schema bump: an older build uses the stored overscan, which is what it always ran.
2. **The length** (`core/job/automatic-overscan.ts`): the whole run-up from rest, v² / 2a, plus 10%,
   rounded up to 0.1 mm and held within the Overscan field's 0 to 25 mm range.
   - v is the scan feed: the operation's speed capped at the machine's maximum feed, as emitted.
   - a is the acceleration along the scan. GRBL limits a move so no axis passes its own setting, and
     the profile keeps the smaller of $120 and $121, so a scan at angle θ gets at least
     a / max(|cos θ|, |sin θ|). A 45° scan needs √2 times less runway than one along an axis.
3. **Worked out at every compile.** Image groups use each group's scan angle (ADR-492). Scanline
   and island Fill groups use their hatch angle; the cross-hatch pass at +90° has the same axis
   share, and an angle change per pass compiles each angle as its own group. So the runway follows
   any change of speed, angle or Machine Setup acceleration. Offset fills keep the stored value, the
   length they use as a contour entry. The 4040-safe profile's feed-matched entry cap still applies
   on top, as it does to a stored value.
4. **Everything downstream reads the compiled group.** The emitter, the preview, both estimates,
   Frame bounds and the recovery archive already use `group.overscanMm`. Preflight's allowance for
   intentional laser-off moves (`maxOutputOverscanMm`) now takes the device and allows the longest
   automatic runway an operation can run, the one along an axis.
5. **The runway warning follows the scan direction.** Job Review's "at most N mm of scan-entry
   runway" advisory measures the needed run-up with the acceleration along the group's scan (an
   image's scan angle, a fill's hatch direction). It says so when the angle changes the value. It
   stays an advisory.
6. **Controls.** In Cut Settings, Image detail and Fill detail (scanline and island) gain
   **Automatic** under Overscan. On, the typed length greys out and is kept for when Automatic is
   turned off, and a note gives the length Automatic runs now, with the speed, acceleration and
   angle it used. It also says to check the scan edges on scrap if the acceleration was not read
   from the controller. The operations list shows "Automatic (Cut Settings)" beside a fill's
   Overscan. Job Review's detail line reads "automatic overscan from speed and acceleration" in
   place of the stored length.

### Alternatives

- **Automatic by default.** Rejected for now: the profile's acceleration is a generic 500 mm/s²
  unless it was read from the controller, and a runway shorter than the machine needs darkens scan
  edges. A machine whose acceleration is known can turn it on per operation. A later decision can
  make it the default once the profile records where its acceleration came from.
- **Half of v² / 2a, as Rayforge does.** Rejected: the head is then still speeding up when the burn
  starts.
- **One length for the whole job.** Rejected: runways depend on each operation's speed and angle.

### Consequences

- Output changes only for operations that turn Automatic on. At 3000 mm/min and 500 mm/s² an image
  along X runs 2.8 mm instead of 5 mm; at 6000 mm/min it runs 11 mm, where 5 mm was too short.
- The runway is only as right as Machine Setup's acceleration. Read it from the controller ($120,
  $121) where the firmware reports it.
- The advisory stops warning about 45° scans whose runway is long enough for the diagonal's
  greater acceleration.

### Verification

- `automatic-overscan.test.ts`:
  - The formula at four speeds, the cap, and the angle factor.
  - Stored against automatic lengths, and the offset fill exception.
  - Compiled image runways per scan angle, and scanline and island fill runways.
  - Unchanged G-code with Automatic off.
  - Preflight's longest-runway allowance.
- `scan-quality-warnings.test.ts`: the warning uses the acceleration along a 45° scan.
- `CutSettingsDialog.auto-overscan.test.tsx`, `cut-settings-draft.test.ts`,
  `project-cut-extras.test.ts`, `job-review-scan-pattern-facts.test.ts`: the switch greys and
  keeps the typed length, the form reads it only where shown, the file round trip and rejection,
  and the Job Review wording.
- Not tried on a machine. A scrap test at the job's speed should confirm that edges on Automatic
  match edges with a long runway, after reading $120 and $121 into Machine Setup.
