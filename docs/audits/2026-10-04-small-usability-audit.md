# KerfDesk small usability audit - 4 October 2026

This audit looks for small failures around editing, focus, cancelling, delayed
actions and changing documents. The starting source is
`eaf37b066c1900bcc30645ff72aebf6156307000`. Work was isolated in
`codex/small-usability-audit-20261004`; the dirty primary checkout, existing
worktrees and customer profiles were preserved.

Seven product defects were reproduced and repaired. The new committed coverage
contains 42 unit scenarios and 25 installed-Chrome renderer workflows: **67
distinct new scenarios**. Existing tests and repeated before/after runs are not
added to that count. Passing these scenarios does not establish that every
input, operating system, installer or physical machine has been qualified.

## Reproduced findings

| Priority | Small failure | Repair and witness |
| --- | --- | --- |
| P2 | An externally restored number looked valid but retained its old native custom-validity error while focused. Invalid spelling such as `5e1` could also survive restoration to `50` because both parsed to the same scalar. | `use-debounced-commit.ts` reconciles invalid drafts and clears retired native validity when restoring the canonical value. Three unit regressions and an actual focused Chrome power-field reset cover this boundary. |
| P2 | An image adjustment pending when a project was replaced could apply to the new image if the replacement reused its ID and adjustment value. A blank draft could also remain visible. | `SelectedImageAdjustments.tsx` keys the editors by document epoch, image and adjustment. Three delayed Brightness/Contrast/Gamma Chrome workflows and four unit cases cover replacement and legitimate current-document editing. Ordinary A-to-B selection already had an identity key and is not a new defect. |
| P2 | A Save changes? question for the old document could authorise discarding or saving a replacement that completed opening while the question was visible. | `confirm-discard.ts` checks the captured document epoch after the choice and awaited Save. Four failing original unit witnesses and a real renderer pending-Open/old-Discard failure were recorded. Same-document latest edits retain normal explicit Save/Discard behaviour. |
| P2 | An old Machine Setup Save could close a newer setup or replacement document after its selected firmware write settled. Reopened requests could reuse an ID. | `MachineSetupDialogHost.tsx` binds closing to the original document and exact dialog object. Three original unit failures plus the normal completion control pass after repair. The write is synthetic; firmware commands and verification behaviour were not changed. |
| P2 | Escape during input-method composition discarded a modal text draft; composing Tab was consumed by the dialog focus trap. | `use-dialog-a11y.ts` preserves native composition handling for `isComposing` and the existing legacy 229 compatibility path. The original production text dialog disappeared in the Chrome witness and remains open after repair; ordinary Escape still cancels. Composition events are synthetic, not a native OS candidate-window qualification. |
| P2 | Disabled-fieldset and attribute-hidden controls were counted as focus targets. In busy Convert to Bitmap, Shift+Tab from the only enabled Cancel action escaped the dialog. | Initial focus and Tab wrapping reuse `dialogControlIsUnavailable` from `recover-dialog-focus.ts`. The original Chrome busy-dialog failure and five unavailable-control unit boundaries are recorded separately from four composition cases. Forward/backward Tab stay on Cancel, and Enter cancels without deleting artwork. |
| P2 | At 640 x 450, opening a project with a machine-choice notice let the job dock cover the Artwork controls and intercept clicks. | `WorkspaceSidePanels.tsx` exposes the compact collapsed state and active panel. `workspace-layout.css` gives expanded compact panels a minimum usable body, scrolls the rail when needed and prevents the job dock from shrinking over controls. Machine controls scroll their whole rail, including the heading, so they use a smaller minimum than Artwork's fixed header/tabs. Real mouse collapse/expand, tab selection, full Frame/Start button containment, unchanged project state and saved artwork/process equality are checked at 640 x 450 and 1024 x 600. Collapsed/spacious rules retain their previous sizing. |

The shared test helper now chooses Artwork/Machine inside the Side panel tablist;
an operation editor can also have an Artwork tab. That ambiguity was a test
fixture correction, not an eighth product defect. Tests also gained explicit
waits for asynchronous text Done completion and correct canvas-shortcut focus.
Those failed assumptions were retained in local receipts rather than reported
as application failures.

The first integrated layout check caught a regression in the initial repair:
the Machine panel's 120 px minimum pushed its dock below a 450 px window. The
final repair uses a 64 px minimum for the internally scrolling Machine rail and
retains 120 px for Artwork. The original failed integrated receipt is retained;
the final integrated run checks both the old acceptance case and full button
containment inside the dock and rail in both axes.

## Checklist and results

The scenarios below are deliberately small: pause halfway through typing, clear
the last character, cancel after editing, change selection, reopen a draft, or
finish an older action after newer work exists. Fixed means a failure was
reproduced on the original source; Passed means no additional defect was
confirmed in the listed scenarios. There are 36 checklist items.

| ID | What to try | Result and evidence |
| --- | --- | --- |
| N1 | Delete the final digit before the debounce fires, leave the field blank, then type a new number. | Passed: pending `8` is cancelled, blank is retained, new `4` commits once on blur. |
| N2 | Type a minus first, pause, complete a decimal, then delete only its leading sign. | Passed: actual text spacing `-0.25`, 650 ms pause, Home/Delete, saved `0.25`. |
| N3 | Type a leading decimal point, pause, complete `.75`, then cancel. | Passed: real text line-height editor canonicalises `0.75`; Escape leaves no object or undo entry. |
| N4 | Enter incomplete/exponent-like text, then correct it without leaving the field. | Passed: invalid exponent/prefix text does not commit a `parseFloat` prefix. |
| N5 | Restore the saved value while an invalid field remains focused, including equal parsed scalars. | Fixed: both displayed draft and native validity are reconciled without another blur. |
| N6 | Try zero/negative values in a positive-only field, then enter a valid fraction. | Passed: restores saved `5` without a commit, then accepts `0.125`. |
| N7 | Leave an existing tiny scientific-format value untouched and blur. | Passed: saved `1e-7` survives without a parse mutation. |
| N8 | Press Enter in deferred, caller-cancelled and blank numeric edits. | Passed: blur-owned fields avoid quiet-period commits and duplicate commits. |
| N9 | Let a numeric normaliser return a nonfinite value. | Passed: restores the previous finite value and never commits NaN. |
| N10 | Change between same-valued images, then edit the current image. | Passed: ordinary selection identity already works; current edit creates one undo step. |
| N11 | Open a replacement image file using the same image ID while adjustments or a blank draft are pending. | Fixed: old Brightness, Contrast and Gamma editors retire with their document. |
| N12 | Remove an editor before its pending change commits. | Passed: timer cancellation prevents a ghost store write. |
| N13 | Edit scan-offset speed, press Enter to reorder, duplicate a speed, or remove a row with an unsaved edit. | Passed: row identity/focus, canonical duplicate survivor and intended removal are preserved. |
| N14 | Exercise existing geometry scale, CNC depth, integer relief settings and target-switch handling. | Passed: 55 affected existing unit cases across five files; not counted as new scenarios. |
| D1 | Finish a pending Open while an older Save changes? question remains visible. | Fixed: old Discard cannot erase the replacement; old Save cannot pick a destination for it. |
| D2 | Reopen the same filename or create New while an earlier document question is pending. | Fixed: document identity is the epoch, not filename equality. |
| D3 | Make newer edits in the same document before choosing Save or Discard. | Passed: explicit choice still applies to that document's latest edits. |
| D4 | Replace the document while its captured Save is awaiting a file write. | Passed: old saved bytes remain owned by the old file; replacement survives. |
| D5 | Finish an older Machine Setup Save after replacing, reopening or starting another setup draft. | Fixed: late close affects only the exact original draft. |
| D6 | Cancel machine-setting drafts, then explicitly Save, Undo and Redo. | Passed in actual Chrome: only committed settings enter document history. Synthetic setup-write completion is checked separately. |
| D7 | Cancel New, cancel Open, open invalid data, or fail a retained-file Save requested by New. | Passed: artwork, power and dirty edits survive as appropriate; no accidental replacement. |
| D8 | Delete the last artwork, Undo/Redo it, then add fresh artwork. | Passed: operation ownership is restored by Undo and newly added artwork uses fresh values. |
| T1 | Browse fonts using arrows, Home/End and wheel at laptop size before choosing one. | Passed: browsing does not commit a font or scroll the surrounding text panel. |
| T2 | Search for no matching font, press Enter, then clear Search with Ctrl+A/Backspace. | Passed: no nonexistent selection; all 25 options return after clearing. |
| T3 | Choose a font and finish text editing. | Passed: selection remains a draft until Done and creates one undo step. |
| T4 | Escape from a font menu inside an editor or from a nested modal. | Passed: only the topmost surface closes; focus returns and the text draft remains. |
| T5 | Select/delete all textarea content, use native Undo, type again and press Enter. | Passed: canvas history/artwork stay intact, Enter creates a newline and no serial bytes are emitted. |
| T6 | Cancel and reopen an existing text edit. | Passed: saved content is restored, edit focus returns and caret is at the end. |
| T7 | Use Escape/Tab during composing text, then ordinary Escape afterwards. | Fixed for synthetic composing key events; ordinary dismissal still works. Native IME remains a qualification limit below. |
| T8 | Tab/Shift+Tab in a busy dialog with disabled fields and one enabled Cancel button; initialise focus around hidden/inert controls. | Fixed: unavailable controls are filtered, focus stays inside and Enter cancels safely. |
| W1 | Copy artwork, change its process power, then paste in the same document. | Passed: pasted artwork uses the current `47` power, with unique IDs and 10 mm offset. |
| W2 | Copy, create New, and Paste in Place into another document. | Passed: source `67` power and placement survive; operation binding and object IDs belong to the new document. |
| W3 | Cut, Undo, Paste, Undo and Redo. | Passed: artwork and operation ownership stay consistent with unique IDs. |
| W4 | Duplicate, delete all, Undo and Redo. | Passed: selection is cleared when artwork disappears and no stale selection remains. |
| W5 | Press New, Duplicate, Paste and Delete shortcuts while Settings is open. | Passed: Settings owns them; canvas project, selection and history remain unchanged. |
| W6 | Resize to 1024 x 600 and 640 x 450; collapse/expand both panels, switch tabs, reach Frame/Start and Save As. | Fixed for short-window overlap; both viewports preserve exact artwork/process settings and saved `43` power. No hardware commands are issued. |

## Qualification limits

These items are on the checklist but are **not marked Passed**:

- Native OS IME candidate panels, decimal-comma paste, focused numeric scroll-wheel
  edits and every disabled numeric surface.
- CSS-only `display:none` / `visibility:hidden` first controls in a modal. Attribute
  hiding, inert ancestors and effective disabled-fieldset state are covered;
  no supported opening path with a CSS-only hidden first control was reproduced.
- Other browser engines, all screen-reader combinations and all viewport sizes.
- Installed Windows customer upgrades, shutdown/profile migration, live licensing,
  Cloudflare account state, deployed phone/MCP services and physical machinery.
  The Chrome renderer uses fixture file/desktop APIs; setup write completion is
  synthetic. No customer key, hardware, real payment or provider state was used.

Some Chrome boundary scenarios deliberately use production store actions:
the three same-ID image cases call `setProject`, the focused power reset calls
`setLayerParam`, and the retained modal text editor is opened through the UI
store. The busy conversion worker is held pending. These exercise real mounted
controls and their lifecycle boundaries; they do not establish every file-picker,
native composition or worker-completion route. The document Open/Save and normal
font/text workflows use the actual renderer controls with fixture desktop APIs.

The native custom-validity repair follows the
[HTML constraint-validation API](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#dom-cva-setcustomvalidity):
a nonempty custom error remains separate state until cleared. Composition
handling was checked against the
[W3C UI Events composition key-event rules](https://www.w3.org/TR/uievents/#events-composition-key-events)
and the [legacy 229 processing definition](https://www.w3.org/TR/uievents/#determine-keydown-keyup-keyCode).
Those specifications inform the fixes; the recorded regression scenarios provide
the application evidence.

## Integrated verification and release boundary

The root combined run passes all 42 new unit scenarios across seven files. The
final combined Chrome run passes all 42 workflows: the 25 new scenarios and 17
existing responsive/shell cases, with zero skips, unexpected results or retries.
Final renderer-test TypeScript checking passes. The 21 production/test/note file
hashes match the frozen candidate after those checks; only this report was
completed afterwards. Independent source and evidence/count reviews found no
further attributable blocker in the repaired boundaries.

The full local `pnpm release:check` is still running at this pre-merge report cut;
its terminal status is recorded separately in `release-check-receipt.json`.
The completed checklist and narrow results do not substitute for that whole-app
gate. Exact-head hosted CI, Browser smoke and Desktop package checks must also
pass before merge. Later receipts record full-gate completion, merge, main checks,
Pages publication and served identity without changing this pre-merge snapshot.

The next desktop release's six short improvement notes include these repairs.
This source update does not publish a new installer. The 20-merged-PR cadence
remains in force unless the maintainer requests an earlier release. Exact-head
PR checks, merged-main checks, Pages publication and served browser identity
must be verified separately; they do not establish installed desktop delivery.

## Local evidence

Receipts are retained under
`D:/LaserForge/small-usability-audit-evidence-20261004` outside the shipped app.

| Evidence | Purpose |
| --- | --- |
| `initial-state.json` | Original primary checkout and isolated base identity |
| `numeric/receipt.json`, `numeric/before-regressions.log`, `numeric/original-exponent-witness.log` | Numeric findings, corrected fixtures and per-file hashes; original hook blob `12daeb92da9ffbaae3a5e19959ef876eefaec43c` |
| `document/audit-receipt.json`, original/final unit and Chrome logs | Old document questions and setup-close ownership; synthetic-write boundary |
| `text-focus/checklist.md`, original/final unit and Chrome logs | Font/text checks, composition and unavailable-control witnesses |
| `workspace/remaining-artifacts/`, `workspace/remaining.log` | Original real 640 x 450 click interception, screenshot and trace |
| `workspace/integrated-chrome.json`, `.log` and artifacts | First combined run, including the caught Machine-panel regression |
| `workspace/integrated-final.json`, `.log` and artifacts | Final combined new renderer workflows and existing responsive/shell checks |
| `integrated-new-unit.json`, `.log`, `e2e-types-final.log` | Combined 42 new unit scenarios and final renderer-test TypeScript check |
| `release-check.log`, `release-check-receipt.json` | Full local release gate and terminal exit status |

The committed new cases live in four `e2e/small-*.spec.ts` files, two
`src/ui/layers/*.small-audit.test.tsx` files, two
`src/ui/kit/*.small-audit.test.tsx` files,
`src/ui/app/confirm-discard.document-audit.test.ts`,
`src/ui/laser/device-setup/MachineSetupDialogHost.document-audit.test.tsx` and
`src/ui/common/use-dialog-a11y.small-usability.audit.test.tsx`.
