# Pro loop v2 — T10 V-carve depth against the cone law

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v2`
- **Scope:** V-carve (`cutType: 'v-carve'`, flat depth off) on 40 mm bars 1, 3 and 5 mm wide, with the
  30°, 60° and 90° starter V-bits, through `emitGcode`
- **Judge:** the deepest emitted Z against d = (w / 2) / tan(angle / 2), and the carved groove's top
  width from a cone sweep of every cutting move across the bar's middle.
- **Counts:** 0 raised.

| Bit | Width | Deepest Z | Cone law | Carved top width |
|---|---|---|---|---|
| 60° | 1 / 3 / 5 mm | −0.864 / −2.596 / −4.328 | 0.866 / 2.598 / 4.330 | 0.998 / 2.998 / 4.998 |
| 90° | 1 / 3 / 5 mm | −0.499 / −1.499 / −2.499 | 0.500 / 1.500 / 2.500 | 0.998 / 2.998 / 4.998 |
| 30° | 1 / 3 mm | −1.863 / −5.595 | 1.866 / 5.598 | 0.998 / 2.998 |
| 30° (3.175 mm cut) | 5 mm | −5.924 | capped at the cone's own depth, 5.925 | 4.998, the rest cleared beside the cone |

Every groove is within 0.003 mm of the cone law (shallow, never deep) and its top edges land on the
drawn outline to 0.002 mm. That matches VCarve's description of V-carving: "a path defined by the
combination of the angle of the tool specified and the width and shape of the vectors being
machined" ([Vectric VCarve Pro 12.5, V-Carve Toolpath](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/VCarve%20Toolpath%20Creator/),
fetched 2026-11-08).
