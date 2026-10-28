## ADR-204 Amendment 2 — Saves are compact, a save past the text limit says so, and the raw recovery copy is written in chunks

**Status:** Accepted; measured in unit tests, not at the real limit and not in the packaged desktop app. | **Date:** 2026-10-28

### Context

Rolling audit v5 J10-P3-3, raised to P2 by its refuter
(`docs/audits/2026-10-27-rolling-v5/J10-scale-performance.md`):

- Manual Save wrote the project as JSON indented by two spaces, with each path's polylines and its
  curves. With full-precision coordinates that took about 349 bytes per imported vector point.
- V8 cannot build a string longer than 536,870,888 characters (Node 25.8.2 / V8 14.1; Chromium and
  Electron use the same engine). Past about 1.5 million points `JSON.stringify` threw
  "Invalid string length", and Save was refused with that message.
- The raw recovery copy that Save then offers used the same indented serializer, so it failed in
  the same way. Only autosave, which is compact (about 115 bytes per point), kept the work.
- The cliff is reachable. The 10,000-object limit counts objects, one imported SVG is one object,
  and point counts only warn (ADR-268).

### Decision

- **Manual Save writes compact JSON, as autosave does.** Both passes of the validation are compact;
  validation, normalization and the drift refusal are unchanged. Whitespace is not part of the
  `.lf2` format, so every version reads these files and the schema version does not change.
  - This replaces the 2026-09-09 dense-artwork amendment under ADR-288 Amendment 1, where manual
    file formatting stayed indented.
  - On 20,000 full-precision points the save measured 113 bytes per point compact, against 347
    indented. The cliff therefore moves from about 1.55 million such points to about 4.7 million.
    The refuter measured 7.59 million instead of 1.76 million for coordinates rounded to 3 decimals.
- **A save past the limit says why.** "Invalid string length" from the serializer becomes:
  "it is too large for one project file (the saved file would pass about 512 MB, the most this app
  can write in one piece); simplify dense imported artwork or split the work across projects".
  The project stays open and unsaved, autosave keeps it, and the raw recovery offer follows as
  before (ADR-204 Amendment 1).
- **The raw recovery copy of a large project is never one string.** The worker writes it as
  compact chunks: the project's settings through the chunked JSON writer, and each scene object
  natively while its own text fits, otherwise through the chunked writer too. The chunks become a
  Blob that is written to the picked file. The desktop app accepts up to 1 GiB
  (`MAX_DESKTOP_PROJECT_SAVE_BYTES`). Open already reads files over 25 MiB as a stream
  (`PROJECT_NATIVE_JSON_PARSE_MAX_BYTES`), so the copy can be opened again.
  A small project's copy stays one compact string.
- **Not changed:**
  - Imported and drawn artwork still stores line curves beside its polylines. ADR-159's amendment
    omits redundant line curves only for traced images. Dropping them elsewhere would roughly halve
    line-only files again, but curve editing of imported artwork reads those curves, so it is a
    separate format decision.
  - Autosave, local snapshots and the project text embedded in sheets and arrays are unchanged.

### Consequences

- Saved files are about a third of their former size and are written faster.
- A project past about 4.7 million full-precision points still cannot be saved as one validated
  file. The refusal now names the size, and the recovery copy can still be written.
- A person reading an `.lf2` file needs a JSON formatter to see its structure.

### Verification

- `project-save-text-limit.test.ts` checks the size per point. It also simulates the limit by
  making `JSON.stringify` throw V8's `RangeError` for the whole project: Save is refused with the
  reason above, and the recovery chunks still give the same compact text. A third case does the
  same for one oversized object.
- `compact-autosave.test.ts` checks that manual saves are compact and that the recovery chunks
  equal the compact serializer, including typed relief meshes.
- The real 512 MB limit was not built, because this PC is short of memory. Electron 44's own string
  limit was not checked.
