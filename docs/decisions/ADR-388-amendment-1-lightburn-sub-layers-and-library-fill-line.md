## ADR-388 Amendment 1 - LightBurn sub-layers open as operations, with their own Output switch (2026-10-22)

**Status:** Accepted on 2026-10-22 |
**Amends:** ADR-388 decisions 9 and 10 (a sub-layer block was named as a whole and its values
were read as the layer's), and decision 7 as `.clb` libraries apply it

### Context

Rolling audit v2, report 21 (`lb-material-importers`), confirmed three findings in the LightBurn
importers:

- **21-P2-1.** LightBurn 1.2 and later save each sub-layer of a layer as a `<SubLayer>` inside the
  layer's `<CutSetting>`, with its type and index as attributes, and leave out every value at its
  default, on the layer and on each sub-layer. The `.lbrn` importer looked a setting up anywhere
  under the `<CutSetting>`, so when the layer left a value out, a sub-layer's value became the
  layer's. A Cut layer with a 4-pass, 0.3 mm kerf sub-layer opened as one 4-pass operation with a
  0.3 mm kerf offset. The report said only that the `SubLayer` settings were not imported.
- **21-P2-2.** Each tab of LightBurn's Cut Settings Editor, the first included, has its own Output
  switch, written `suboutput 0` when off. LightBurn's Sub-Layers page: a sub-layer's switch decides
  whether it is included in the output, sub-layers are output "in sequence, starting from left to
  right", and the layer's own Output switch leaves out the whole layer. In the real
  `DCP_BUTTONS.lbrn2` (LightBurn 1.6.03), layer C00 has three tabs off and runs only its last,
  "GOOD FINAL", a Fill at 10 %. KerfDesk burned the first tab, which is off, at 15 % and never ran
  "GOOD FINAL". `suboutput 0` reads as "off", so the report never named it.
- **21-P2-3.** A `.clb` library entry of type `Scan+Cut` (LightBurn's Fill+Line) became a Fill-only
  preset, because the library importer searched the type for "scan". Applying it engraved the
  shapes and never cut their outlines, and nothing was reported. Real libraries hold such entries
  (Binary-Kitchen `thunderlaser_nova35` `material_library.clb` has three).

Four of the five real sub-layer blocks the audit found are a Scan layer with a Cut sub-layer, which
is how LightBurn now approximates Fill+Line.

### Decision

1. **A setting is the element's own.** A LightBurn cut setting is read from the element's own
   attributes and children, never from a block inside it, in projects as `.clb` libraries already
   were. A value a layer leaves out keeps KerfDesk's default, as before.
2. **Each tab is an operation.** A layer's own settings are its first tab and each `<SubLayer>` is
   another, in the order the file lists them. Every tab opens as an operation of its own mode
   (decision 7) and settings on the layer's artwork, listed right after the one before, so the
   tabs run in LightBurn's order. The first keeps the layer's name; a sub-layer is named
   "<layer> (<its LightBurn name>)", or "<layer> (Sub-layer <n>)" when LightBurn names it nothing,
   `n` counting the layer's own tab as 1. A Fill+Line tab is a Fill and then a Line, as before.
   The import report names each tab's settings left behind under its own operation (decision
   10), and no longer names a sub-layer block as not imported.
3. **Each tab's Output switch.** A tab LightBurn switches off (`suboutput 0`) opens with Output
   off; one LightBurn leaves on, or writes nothing for, follows the layer. The layer's Output switch
   (`doOutput`) and a hidden layer keep every tab out of the job, as decision 9 does for the layer.
   The report has one line per layer naming the operations that opened off for this reason, so
   the user can switch one on. A switched-off tab is opened, not dropped, so nothing is lost.
4. **Fill+Line in a library.** A `.clb` entry's type is read as a whole name, as decision 7 reads a
   project's: `Cut` and `Line` are a Line preset, `Scan` and `Fill` a Fill preset, `Image` an
   Image preset, and no type is LightBurn's default, Line. A preset holds one mode, so a
   `Scan+Cut` (or `Fill+Line`) entry opens as two presets: a Fill preset under the entry's name and
   a Line preset named "<entry> (Line)", with the same speed, power, passes and air assist. The
   report says so and how to apply them: the Line to a second operation that runs after the Fill.
   Any other type is named in the report with the mode it opened as, which is still read from the
   name ("Offset Fill" opens as a Fill), so no older library changes mode.

### Limits

- The meaning of `suboutput` is read from LightBurn's Sub-Layers page and real files (it is
  written only on tabs that are off), not from a run in LightBurn.
- A sub-layer's left-out values take KerfDesk's defaults, as a layer's do. LightBurn starts a new
  sub-layer from "the Default Settings of the parent layer", which no file records; real files
  write speed and power on every sub-layer.
- `.clb` sub-layers are not mapped: a library entry still becomes the presets of its first tab, and
  its `SubLayer` block stays in the import's unsupported fields. A library entry whose first tab is
  off is not checked.
- LightBurn's own order inside a Fill+Line tab is still not observed (ADR-388 Limits).

### Tests

`lbrn-sub-layers.test.ts` (a sub-layer's passes and kerf stay out of the layer and run after it;
a Scan layer with a Cut sub-layer runs a fill then a line; the `DCP_BUTTONS` shape burns only
"GOOD FINAL" and names the three tabs that are off; a layer whose only tab is off, and a layer
whose Output switch is off, stay out of the job; a Fill+Line sub-layer); `clb-import.test.ts` (a
`Scan+Cut` entry is a Fill and a Line preset, reported, and reopens; type names read whole, an
unknown one named); `lbrn-setting-report.test.ts` (an unknown nested block is still named).
