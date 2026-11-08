# Pro loop audit v2: every tool, one by one

**Requested by** the maintainer on 2026-11-08, after round v1 ("we start our next round of loops
full deep audits not only in sector but by tool"). Method as
[v1](../2026-11-08-pro-loop-v1/AREAS.md): real app path, independent judge, primary sources,
LightBurn decides laser questions and Vectric decides CNC ones. Every fix gets its own PR.

Round v1 audited by sector (laser core, raster, vector, time, CNC 2D, 3D, controllers). This round
takes each tool on its own and feeds it edge inputs: sharp tips, holes smaller than the beam or the
bit, nested islands, curves, tiny features, unusual settings.

## Tools (run order)

| # | Tool | What is checked | Status |
|---|---|---|---|
| T1 | Laser kerf offset | offset distance on a star (convex and concave corners), a shape smaller than the kerf | [done](T-laser-tools.md) — clean |
| T2 | Laser tabs | tab count, gap length on a curve, with kerf | [done](T-laser-tools.md) — clean |
| T3 | Automatic overscan | run-up = v² / 2a with margin, per kinematics | [done](T-laser-tools.md) — clean |
| T4 | Fill styles | coverage and containment of Scan Line, Offset and Island fills on a star with a hole | [done](T-laser-tools.md) — 1 P3 |
| T5 | Leads and overcut | scrap side, lengths, kerf on holes and outers | [done](T5-T6-T9-leads-perforation-order.md) — clean |
| T6 | Perforation | dash lengths, repeat across passes | [done](T5-T6-T9-leads-perforation-order.md) — clean |
| T7 | Image tool transforms | mirror, rotate, scale about the object origin | [done](T7-T12-image-transforms-pocket-islands.md) — clean |
| T8 | Text tool | closed outlines, counters kept, fill area | [done](T8-text.md) — clean |
| T9 | Cut order across nested parts | holes before outlines, inner parts first | [done](T5-T6-T9-leads-perforation-order.md) — clean |
| T10 | CNC V-carve depth against the cone law | depth and top width for 30/60/90° bits | [done](T10-vcarve.md) — clean |
| T11 | CNC tabs, ramps and helix entry | tab height and width, entry angles | [done](T11-T13-cnc-entry-tabs-drill.md) — clean |
| T12 | CNC pocket islands | island and outside untouched, floor cleared at 40 and 70 % stepover | [done](T7-T12-image-transforms-pocket-islands.md), adaptive [done](T12b-adaptive-islands.md) — clean |
| T13 | CNC drill pecks and feeds calculator | peck sequence; feed = RPM × flutes × chip load, capped | [done](T11-T13-cnc-entry-tabs-drill.md) — clean |
| T14 | Relief projection | engraving depth below a sloped surface | [done](T14-relief-projection.md) — clean with #1622; two-sided stock edit [done](T14b-two-sided-stock-edit.md) — clean |

## Overlap

Rolling audit v11 (PR #1621) covers import/export, relief and design generators, the Inspector, AI,
camera, licensing, remote and Electron. This round stays on the tools that shape emitted output.
