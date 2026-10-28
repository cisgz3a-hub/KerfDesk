## ADR-590 Amendment 1 - A Design Studio drawing is kept, not written over

**Status:** Accepted; tested with the real persistence hook and project round trips, not in a
packaged build. |
**Date:** 2026-10-28

Fixes rolling audit v7 L5-P1-2 and L5-P2-1
(`docs/audits/2026-10-28-rolling-v7/L5-design-studio-sketch.md`). ADR-590 decided that "an
unrelated local recovery draft cannot replace" a project's own Studio document. It did not decide
what happens to that draft, and the code wrote over it.

### Context

- ADR-272 Amendment 3 keeps one saved drawing in `localStorage`, tagged with the project it was
  drawn on. When the Studio opened on a project with a different key, it opened that project's own
  drawing and then saved it over the slot. The draft was the only copy, so it was lost:
  - opening the Studio on the blank start-up project before restoring the autosave;
  - restoring an autosave a few seconds older than the drawing (any object added or removed, or an
    Apply, after the last 30 s autosave);
  - opening the Studio on any other project or sheet.
- The Studio's Close button promises "your drawing is kept without applying it", and nothing
  outside the Studio counted an unapplied drawing as unsaved work.
- A closed Studio path or chamfered rectangle is baked without its seam vertex. Compile cuts the
  closing edge, the Studio and the phone draw it, but the main canvas stroked it open.

### Decision

1. **A drawing the Studio did not open is never written over.** When the Studio opens on a
   project the saved drawing does not belong to, and that drawing holds shapes not yet applied, it
   is moved to the kept drawings first (`laserforge.design-studio-kept-drawings.v1`). A drawing
   with nothing unapplied is not kept: its project's own document holds it. The move happens only
   when the Studio actually shows the new session, so an open that a newer one supersedes changes
   nothing. If the move cannot be stored, the saved drawing is held: this page stops saving the
   Studio rather than write over it.
2. **The newest five kept drawings stay.** An identical drawing is kept once; past five, the
   oldest is dropped.
3. **A kept drawing comes back with its project.** Opening the Studio on the project a kept
   drawing belongs to opens that drawing, as the saved one would. Restoring the autosave after a
   blank start-up brings the drawing back by itself.
4. **Otherwise the Studio offers it.** A bar under the options bar names the newest kept drawing
   (its shape count and when it was kept) with Restore and Discard…. Restore opens it on the
   current project, reconciled as any saved drawing is; a drawing it replaces that holds unapplied
   work is kept in its place. Discard asks first.
5. **The browser's leave-page prompt counts an unapplied drawing as unsaved work.** The desktop
   close question stays about the project: Save cannot store a drawing that was never applied,
   and the drawing is written at teardown and offered again on the next start.
6. **The main canvas draws a closed path's closing edge** when the path omits its seam vertex, as
   compile cuts it. Design Studio paths and DXF contours both omit it.

### Consequences

- The two tests that pinned the overwrite now pin the kept drawing
  (`design-session-persistence.test.tsx`, `project-design-session.test.ts`).
- Kept drawings live in this browser profile only, like the saved drawing (ADR-272 Amendment 3);
  they are not part of the project file.
- ADR-590's precedence is unchanged: another project's draft never replaces a project's own
  drawing without the operator choosing Restore.
