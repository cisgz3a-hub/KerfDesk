# Pro loop v2 — T11 CNC tabs, ramp and helix entry; T13 drill pecks

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Harness:** `audit/loop-v1/r2-cnc.test.ts` (outside the repository), `emitGcode` plus a router
  model of every move.
- **Counts:** 0 raised.

| Tool | Setting | Emitted | Verdict |
|---|---|---|---|
| Tabs | 6 mm deep outside profile, tabs 2 mm high × 6 mm wide, 4 per shape, 1/8" end mill | the final level climbs to Z −4.000 four times; each flat top runs 9.175 mm = 6 mm of tab + the bit's 3.175 mm diameter | the tab left in the material is 6 mm long and 2 mm high, as Vectric's tab length means |
| Ramp entry | 5°, on-path profile 3 mm in two levels | every descending move is at 5.000° or less; level 2 drops straight from Z 1 to −1.5 into the slot level 1 cut, then ramps | clean |
| Helix entry | pocket, helix 2–6 mm diameter, 3° | 12 arcs on a 3 mm radius (the 6 mm circle), descending at 2.03° | clean, never steeper than set |
| Drill | 6 mm in 2 mm pecks | Z 0 → −2 → 0 → −4 → 0 → −6 | clean (GRBL has no canned `G83`, so the cycle is written out) |

## T13b Feeds calculator (read)

`feeds-calculator.ts` applies feed = RPM × flutes × chip load (mm/tooth), rounds to 10 mm/min, caps at
the machine's maximum feed, takes plunge as a material fraction of feed (0.15–0.4) and depth per pass
as a fraction of the bit diameter (0.1–0.5). The chip-load chart is labelled provisional and
conservative in the code and the UI. Example: 1/8" two-flute bit in hardwood at 18,000 RPM →
0.04 mm/tooth → 1440 mm/min, plunge 580, 1.3 mm per pass. The formula is the standard one; the chart
is a starting point the operator is told to verify with a test cut. Clean.
