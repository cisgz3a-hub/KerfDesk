## ADR-127 Amendment 3 - The rotary feed warning reads the job's own moves, and old rotary projects say their burn changed (2026-11-10)

**Status:** Accepted. | **Date:** 2026-11-10

Amends ADR-127 Amendment 2, Decisions 4 and 5. The feed rule itself is unchanged. Rolling audit v13
area Y5 raised these points on main `144e45d76`. The auditor, a fresh refuter and the coordinator
all confirmed them.

### Context

- **Y5-P2-1** (re-rated P1 by the refuter). Amendment 2 D4 promised a Job Review warning whenever
  the Max feed holds a stroke round the part back. The warning decided from the rotary's Y scale
  alone, and only when it was above 1. The emitter, though, clamps at `k × f(x)`, which includes the
  taper factor (ADR-694).
  - On a 20 oz-style tumbler (Ø88 → Ø72) on a roller with no roller diameter (`k = 1` exactly), a
    fill at the profile's Max feed burned the narrow end at 118.7–122.2 % of the set energy. No
    warning appeared, and with `k ≤ 1` none ever could.
  - That is the X8-P1-1 class: wrong dose, silently.
- **Y5-P3-1.** The warning said "turns Y ×… mm/min of Y feed" on an A rotary, where the units are
  degrees. It also fired for a 0° fill whose strokes all run along X.
- **Y5-P2-2.** A rotary project saved by 1.0.30 or earlier opened with no old-project burn notice,
  though its strokes round the part now burn `1 / k` times the energy: 6.28× on an Ø80 glass in the
  Creality chuck. ADR-682 Amendment 3 D4 requires the file, not the release notes, to raise such
  notices.

### Decision

1. **The warning reads the moves.** `detectRotarySurfaceSpeedWarnings` maps the prepared job to
   machine space and builds the emitter's own feed match (taper included). For every move of every
   line, cut and fill group it asks `surfaceFeedDoseRise` (in `core/output/rotary-surface-feed.ts`,
   beside the clamp) how far the ceiling holds the matched feed back.
   - A layer with any held move gets one warning. The warning gives the worst dose as a percentage of
     the set energy and the speed at which nothing is held (`floor(speed / rise)`).
   - On a taper it adds "most at the narrow end of the taper".
   - A stroke along X has a ratio of exactly 1, so a 0° fill never warns.
   - The words name no axis and no unit beyond the Max feed's own mm/min.
2. **Old rotary projects say so on open.** A project of schema 21 or older (1.0.30 and earlier) gets
   a `rotaryFeed` entry in its old-project burn notice (`io/project/old-project-rotary-feed.ts`).
   This happens when it is a laser project with an active rotary whose Y scale is not 1, and it has
   line, cut or fill output.
   - The message gives the factor, `1 / k`: "up to 6.28× the energy they did" for a chuck, "as little
     as 0.22×" for a 360 mm-per-turn roller of Ø25. It asks the operator to set power or speed again
     and run a test.
   - Job Review re-checks the live project, so switching the rotary off silences it.
   - Schema 22 (1.0.31) files are already matched and get none.

### Consequences

- The tumbler case above now warns: "They burn up to 122 % of the energy you set. For an even burn,
  set this layer to 4909 mm/min or less."
- The placeholder roller still warns at 1,500 mm/min (115 %, 1308 or less), as before.
- The 1.0.29 rotary golden now opens with the rotary notice. Among the 1.0.30 goldens, exactly the
  scaled rotaries do.
- The A/Z axis's own max rate (`$112`/`$113`, Y5-P1-4) is not read yet. It belongs to ADR-695's
  owner and will add its cap to the same match.
