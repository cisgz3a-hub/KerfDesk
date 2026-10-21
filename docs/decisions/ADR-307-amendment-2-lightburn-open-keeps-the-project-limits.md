## ADR-307 Amendment 2 - Opening a LightBurn project keeps to the project limits (2026-10-21)

**Status:** Accepted. | **Date:** 2026-10-21

### Context

Amendment 1 holds every command that adds objects in one step to the loader's limits, because a
project the loader refuses is lost work. Opening a whole LightBurn project (`.lbrn`, `.lbrn2`)
was the one path without the check (rolling audit v2, report 13, finding P2-1):

- Every `<Shape>`, with groups flattened, becomes one object. A sheet of tags with 10,001 shapes
  opened with the toast `Imported tags.lbrn2: 10001 objects … Save as .lf2 to keep changes.`
- Save then failed with ``invalid `scene.objects`: count 10001 exceeds 10000``, autosave failed
  with a message about browser storage, and every edit after the import was unsaveable.
- The recovery offer said the project "cannot be saved as-is without changing its machine or
  output settings", and its raw copy was refused on reopen for the same count.

### Decision

1. The LightBurn project import checks the loader's scene budgets (`validateSceneBudgets`) on the
   project it built, before that project replaces the open document. Past a limit it is not
   opened, and the reason names the count: `This LightBurn project has <n> shapes, but a KerfDesk
   project holds at most 10000 objects, so it could never be saved. Split the design into smaller
   LightBurn projects and import each one.` The open document is left as it was.
2. Grouping does not help, since a group's members still count as objects, so no grouped import is
   offered.
3. The save recovery offer quotes the refusal itself (`This project cannot be saved as-is: <reason>.
   Export a raw recovery copy…`) instead of naming machine or output settings, which are often not
   the cause.

### Consequences

- A LightBurn project of up to 10,000 shapes opens and saves as before. A larger one is refused at
  open, with nothing lost, instead of at the first Save.
- No G-code, Frame, Start or controller behaviour changes.

### Verification

`ui/app/lightburn-open-project-limit.test.ts`: 10,000 shapes open and Save accepts them; 10,001 are
refused with the count, and the open completion neither replaces the document nor marks it
loaded. jsdom takes minutes to walk a 10,000-shape XML file, so the test copies one real imported
shape; the import, limit and Save preparation are the real ones.
`ui/app/file-actions-project-validation.test.ts` checks that the recovery offer quotes the reason.
