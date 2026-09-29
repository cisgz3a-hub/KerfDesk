## ADR-498 Amendment 1 - Copy Along Path copies are limited only by the project, and the dialog does not lay copies out (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

ADR-498 item 4 puts no bound on the number of copies, and ADR-307 and the machine-output rules
forbid a policy cap. The command had no factual bound either, and three things followed from that
(the 2026-09-28 weakness audit, H-5):

- The dialog worked out the whole plan, every placement of every copy, on every edit of every
  field. A spacing of 0.002 mm on a metre of guide is 500,000 placements per keystroke.
- A count too large for an array (1e12) reached `Array.from({ length })`. The error, `Invalid array
  length`, came out of the store action uncaught and, in the dialog, out of render, which is where
  a typed value must never be able to reach.
- Apply looked through every group in the project for every copy.

Whatever the count, the result has to be a project KerfDesk can save and open again. The project
file loader refuses a scene of more than `PROJECT_SCENE_LIMITS.objects` (10,000) objects, and the
registration jig editor (ADR-316 item 3), the SVG fragment insert and the personal-artwork insert
all keep to that same figure. That is a fact about the file format, not a policy about what is
sensible to cut. Array (ADR-307) does not check it, and this amendment leaves Array as it is.

### Decision

1. **One limit: the project's own.** A copy is the selected artwork and everything it carries with
   it (an image's mask, a path text's guide: `sceneObjectCopyClosure`). The project has room for
   `floor((10,000 - objects kept) / objects per copy)` copies, where the originals give their
   places back when they are not kept. Every request up to that many is placed. A request for
   more, by count or by a spacing or gap that would place more, is refused, never clamped, and
   nothing changes. The message says how many fit and what to change: "This project has room for
   at most 18 more copies of this artwork (project limit 10000 objects). Ask for fewer copies." A
   project with no room at all says so and to delete some objects. Groups follow the objects: a
   copied group has two or more objects, so groups and group members stay well inside their own
   limits.
2. **Nothing that is not a copy reaches the layout.** The count is compared with the room before
   anything is laid out, so 1e12 and 1e300 are refused as too many, exactly as 10,000 is. A count
   that is not finite or is below 1 still reads as 1, and a fraction rounds down, as before. A
   spacing or gap stops stepping along the guide as soon as it has passed the room, so a tiny
   spacing on a very long guide costs the room's worth of steps and no more.
3. **The dialog does not lay copies out.** Its status line comes from `copyAlongPathCount`, which
   answers with how many copies and how far apart from the same working as the layout but builds
   no placement. A count is worked out from the numbers alone; a spacing or gap steps along the
   guide, at most the room plus one step (about 30 ms at 10,000). The status line always says the
   full number, so there is no partial preview to label with "showing N of M": the dialog has never
   drawn the copies, and it still does not. The field values are still deferred
   (`useDeferredValue`), so a fast typist does not queue work.
4. **Apply lays the copies out once.** It places exactly the requested copies, in one state update
   and one undo step. The groups that travel with the artwork are found once, not once per copy.
   A 9,998-copy Apply, the most a scene of two objects allows, took about a quarter of a second in
   the test run.
5. The plan behind Apply and the preview behind the status line are two entry points on one set
   of rules (`planForSelection` and `previewForSelection`), and a test holds them to the same
   answer, problems included.

### Alternatives

- **A small fixed cap (500, 1,000).** Rejected: it is the policy cap ADR-307 removed from Array.
- **Clamp to the room.** Rejected: the operator asked for a number of copies, and a different
  number placed silently is the truncation ADR-307 removed. A refusal that names the number that
  fits lets them choose.
- **Debounce the dialog with a timer.** Rejected: the cost was the layout, not the number of
  renders, and a timer would delay the status line for the small counts nearly everyone uses.
- **Draw the first few copies on the canvas as a preview.** Not part of this fix; the dialog has no
  canvas preview to bound.

### Consequences

- Copy Along Path never takes a project over the limit it can be reopened with. A project that is
  already over it (Array can make one) gets "no room" until objects are deleted.
- Typing a large count or a small spacing is as quick as typing a small one. Applying a large count
  still costs what its copies cost, and no more.
- Array's own lack of a project-limit check is unchanged and is a separate decision.

### Verification

- `src/core/geometry/copy-along-path.test.ts`: a bound refuses a large count before laying
  anything out, accepts exactly the bound, stops a tiny spacing or gap at the bound on a long open
  and closed guide, and counting gives the layout's answer without the placements.
- `src/ui/state/copy-along-path-limits.test.ts`: 1e12, 1e300 and 10,000 copies place nothing and
  say what fits; not-a-number, infinite, zero, negative and fractional counts; exactly the room,
  with masks, several selected objects and the original not kept counted; the 4,000-copy Apply as
  one undo step; group cloning going through only the groups that travel; the preview and the plan
  agreeing.
- `src/ui/commands/CopyAlongPathDialogHost.test.tsx`: typing 4, 40, 400 and 4,000 lays nothing out
  and Copy lays out once with 4,000 placements; a count and a spacing no project could hold are
  explained in the status line and disable Copy.
