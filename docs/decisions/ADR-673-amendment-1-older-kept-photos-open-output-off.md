## ADR-673 Amendment 1 - A photo an older file kept behind its trace opens with Output off, and every reader says so (2026-10-27)

**Status:** Accepted on 2026-10-27 |
**Amends:** ADR-673 decision 8 (older projects: a kept photo now engraves, a legacy raster result
keeps sharing its operation), and carries the load notices of WORKFLOW F-A12 and ADR-400
Amendment 1 to the readers that dropped them

### Context

Rolling audit v4, report H7 (`project-lifecycle`), confirmed two findings about reading a saved
project:

- **H7-P1-2 (P1).** Decision 8 dropped the legacy `role: 'trace-source'` marker on load and turned
  only a kept camera capture's Output off. A photo kept behind its trace by KerfDesk 1.0.27 or
  earlier, which that build never engraved (`compile-job-raster.ts` skipped the marker, and the
  hover read "Trace source, not output"), reopened as a raster engrave. The audit's 40 x 40 mm
  photo went from 0 to 37,881 lit raster lines; a 20 x 30 mm one took the job from 260 lit lines to
  7,528. Where a rasterized trace result shared the photo's operation, both engraved over the same
  area. The only message was `Opened <file>`: the schema did not change, so no migration toast
  fired. Decision 8's remedy, turning the operation's Output off, was written only in the ADR.
  The web build already shipped it (#1455).
- **H7-P3-1 (P3).** New from template and autosave recovery kept only the project and dropped the
  notices File > Open gives: the schema migration and "The saved Auto-focus command was removed".

### Decision

1. **An older kept photo keeps the job it had.** On load, every picture carrying the legacy
   marker, a photo as well as a camera capture, is settled the way decision 7 settles a new camera
   capture: its Image operations are set to Output off, or, where other artwork uses that
   operation, the picture moves to an output-off copy of it (`withImageOutputOff`). The marker is
   still dropped, so the next save writes an ordinary image, and the photo engraves as soon as its
   operation's Output is turned on, the LightBurn behaviour decision 1 chose. A raster result or
   any other image that shared the photo's operation keeps engraving on it, as in 1.0.27, so there
   is no double exposure.
2. **The loader counts it.** `deserializeProject` reports how many kept photos it set to Output
   off (`keptTracePhotosOff`), beside `migratedFrom` and `autofocusCommandRemoved`. A camera
   capture is not counted: it never was artwork, before or after ADR-673.
3. **Every reader says so, in one way.** `pushProjectLoadNotices`
   (`ui/state/project-load-notices.ts`) turns the loader's flags into toasts for File > Open (and
   Recent Projects, a drop, the operating system and a local snapshot, which share its
   completion), New from template, Restore of an autosave and a switch to a sheet an earlier build
   archived. A kept photo gives the warning: `This project kept a photo behind its trace, which
   earlier versions never engraved. Its Image operation now has Output off, so the job is
   unchanged. Turn that Output on to engrave the photo.` (or the count and plural). New from
   template and Restore also name a migration (`This project was saved by an earlier KerfDesk and
   was migrated from schema v<n>.`) and a removed Auto-focus command; File > Open keeps naming the
   migration in its `Opened` toast. A sheet switch does not repeat the document's migration.
4. **Once.** The next save, and every autosave, writes the project without the marker, so reopening
   it gives no notice.

### Limits

- Other readers of stored project text settle a marked photo the same way but say nothing: saved
  personal artwork inserted from the library (which always makes its own operations, so the photo
  arrives with Output off), production manifests, retained arrays, material recipe sheets and
  production nests. These are copies the app wrote itself; a 1.0.27 copy among them keeps its
  1.0.27 job.
- Builds from #1455 up to this amendment engraved such a photo. A file saved by one of them no
  longer carries the marker, so it is not recognised here and keeps engraving, as it did when saved.
- Code and test evidence only.

### Tests

`project-legacy-trace-source.test.ts` (an older kept photo opens off with a trace-only job and is
counted, engraves once turned on, saves without the marker and reopens with no notice; a raster
result or an ordinary image on the same operation keeps engraving and the photo moves to an
output-off copy; two photos are counted; camera captures as before, not counted);
`project-load-notices.test.ts` (File > Open, New from template, an autosave record and a sheet
switch give the kept-photo notice and keep the job trace-only; New from template names a v16
migration and a removed Auto-focus command; an autosave record carries both and a current one none);
`use-autosave.test.ts` (Restore of such an autosave shows the notice).
