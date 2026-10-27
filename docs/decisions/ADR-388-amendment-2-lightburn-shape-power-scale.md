## ADR-388 Amendment 2 - A LightBurn shape opens with its own Power Scale (2026-10-27)

**Status:** Accepted on 2026-10-27 |
**Amends:** ADR-388 decisions 5 and 11 (the shape attributes read, and what the report names
about a shape), under decision 6's rule that nothing is dropped without a line in the report

### Context

Rolling audit v4, report H7 (`project-lifecycle`), confirmed H7-P1-1: the `.lbrn2` importer read a
shape's geometry and `CutIndex` and nothing else, so LightBurn's Shape Properties > Power Scale was
dropped, and no report line said so.

- LightBurn writes it on the `<Shape>` element as `PowerScale`, a percent, and leaves it out at
  100 %. LightBurn's developer (Oz, forum thread 15531, 2020-05-03): if `PowerScale` is in the
  file, it is used.
- LightBurn 2.0's Shape Properties page lists Power Scale among the options "available for all
  types of objects": it "rescales the power used to cut this shape by this percentage". Oz (forum
  thread 12712, 2020-03-02) shows it giving shapes scanned in one sweep different powers, so it
  applies to Scan layers as well as Cut layers.
- Real files carry it: a LightBurn 1.4.02 power-test grid (`qnexo/yumi-laser` @ `521bd5ac`) has
  63 Rects at `PowerScale` 10 to 90 on 100 % Scan layers; a LightBurn 1.1.04 test pattern
  (`davidribyrne/laser` @ `53ba244a`) has 30 Ellipses with it.
- The grid opened with all 90 objects at the layer's 100 %, and a Rect at Power Scale 20 on an 80 %
  layer burned S800 instead of S160. KerfDesk's own artwork power multiplier (`powerScale` on
  the object, added for Shape Properties and used by ADR-044's Material Test cells) models
  exactly this setting; set by hand, the same Rect burns S160.

### Decision

1. **Power Scale opens as the object's power multiplier.** A Rect, Ellipse or Path shape's
   `PowerScale`, and a Text shape's for the outline (`BackupPath`) it opens from, becomes the
   imported object's `powerScale`, value for value. Every operation the object runs on scales its
   power by it, Fill and Line alike, as LightBurn scales the shape on its layer. A shape without
   one, or with 100, opens with no multiplier, so nothing changes for it.
2. **A value the field cannot hold is named, not applied.** A Power Scale that is not a percent
   from 0 to 100 (not a number, negative, or above 100) is not applied, and the import report says
   how many shapes had one, with the values as LightBurn wrote them, that they open at their
   layer's full power, and where to set the multiplier. This follows decision 6's rule for a kerf
   offset the field cannot hold. LightBurn's own multi-select editor has been reported writing
   `-1` (forum thread 37489, 2021).
3. **A Group's Power Scale is named.** A `PowerScale` written on a `Group` shape is not applied to
   the shapes inside it, since whether LightBurn applies it to them is not known here. The report
   says how many groups carry one, with the values, that each shape inside opens at its own Power
   Scale, and to check their multiplier.

### Limits

- LightBurn's docs say the scale works "between Min Power and Max Power". For G-code controllers,
  Oz (forum thread 60413, 2022-02-18 and 2022-02-28) describes it as scaling only the Max Power,
  with Min Power unused on vector shapes. KerfDesk's multiplier scales the operation's Max Power
  the same way and also scales its Min Power (`effectiveObjectMinPowerPercent`); the two agree
  while the layer's Min Power is 0, and decision 10 of ADR-388 already names a Min Power other than
  0 or the Max Power. Ruida-style controllers, where LightBurn may place the scaled power between
  Min and Max, are outside KerfDesk's controllers.
- A Power Scale on a `Bitmap` is not read, since KerfDesk does not open LightBurn bitmaps (decision
  11 names them). The older `.lbrn` format is read the same way; no `.lbrn` file with a Power Scale
  was available to check it.
- Neither real file is copied into the repository: neither repository grants a licence that allows
  it. The tests use small files written in the same form.
- Code and test evidence only; no LightBurn job was compared on a machine.

### Tests

`lbrn-power-scale.test.ts`: a Rect at 25 % on an 80 % Scan layer burns S200 beside a plain Rect at
S800, and an Ellipse at 50 % inside a Group on a 60 % Cut layer burns S300; a nine-cell grid at 10 to
90 % of a 100 % Scan layer burns S100 to S900; a Text shape's scale reaches its outline; a written
100 is no multiplier; unreadable and out-of-range values are named and not applied; a Group's own
scale is named and its shapes keep theirs. The two real files were also opened locally: the grid
now compiles at 10 to 90 % with no report line, and the test pattern's 30 Ellipses open at 20
to 80 %.
