## ADR-352 Amendment 2 — A drag frame of a selection is one store write, and selection edits look objects up by id once

**Status:** Accepted; counted in unit tests, not timed in a browser. | **Date:** 2026-10-28

### Context

Rolling audit v5 J10-P2-1 (P2, `docs/audits/2026-10-27-rolling-v5/J10-scale-performance.md`):

- A canvas move, scale or rotate drag of a selection wrote the store once per selected object on
  every pointer move, and each write copied the whole object array. One frame took about 0.7 s at
  4,000 selected objects and about 2 s at 8,000. The same updates as one write took 0.5–2.8 ms.
- Nudge, flip, rotate 90°, align, Undo, Redo, Duplicate and the drag's mouse-down looked each
  selected id up with a scan of the scene, so they also grew as selected × objects.
- Editing stays enabled while a job runs, so ABORT and Ctrl+. waited behind the frame in progress.
- ADR-352's context already notes that every store write runs every mounted selector.

### Decision

- **One write per drag frame.** `setObjectTransforms(updates)` applies a whole frame's transforms
  in one store write that maps the object array once. Move, single-object scale and rotate,
  selection scale and selection rotate all use it.
  - Undo is unchanged: `beginInteraction` and `endInteraction` still make one history step per
    drag, and Esc still restores the snapshot.
  - `setObjectTransform` stays for single edits outside a drag, through the same helper.
- **One id lookup per edit.** The selection transforms (`selectedObjects`), Undo and Redo
  (`visibleSelectionState`) and the drag's mouse-down build one id → object `Map` instead of
  scanning the scene per id.
- **One append per Duplicate or Paste.** Duplicate walks the copy closure it already has, and both
  Duplicate and Paste add their objects with one `addObjects` copy instead of one copy per object.
  A phone or MCP import that fits its new objects to the bed also sets their transforms in one write.

### Consequences

- These edits are linear in the number of objects. Their remaining cost is copying the scene once
  per edit, plus the guards and selectors that run once per write.
- During a job, a large-selection drag no longer holds ABORT for seconds per frame.

### Verification

`large-selection-edits.test.ts` counts work instead of timing it:

- A drag frame of 4,000 selected objects is one store write (move, selection scale, selection
  rotate), and the drag adds one Undo step.
- Mouse-down, nudge, Undo, Redo and Duplicate of 2,000 selected objects read each object's id at
  most 20 times; they read it 1 to 6 times. With the earlier lookups the same test read about 2–4
  million ids, against a budget of 40,000.

Browser frame times and React render cost were not measured.
