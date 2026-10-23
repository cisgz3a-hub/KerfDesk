# Four-audit remediation, 2026-10-23

The maintainer authorised re-auditing and repairing the 34 distinct findings previously summarised from four successive report-only audits, then opening a PR and merging it after verification. This pass is scoped to those findings: 18 P2 and 16 P3. It starts from fetched `origin/main` at `8acc4599c918c3ab7dd4e9f625437cb2f22e3620` in an isolated worktree. The shared checkout and its unrelated work were preserved.

The original reproduction ledgers were read again, their implementation assumptions checked against this baseline, and focused correct-behaviour regressions added for substantive defects. Browser, React/store and geometry evidence are distinguished below. Related open PR #1424 covers a separate controller/PR audit and does not repair these findings. Implementation decisions are recorded in [ADR-653 Amendment 3](../decisions/ADR-653-amendment-3-four-audit-workflow-fidelity.md).

## Disposition

All 34 reported mechanisms remain supported on the baseline and are repaired by this change. Each row retains its original severity; no claim of permanent project loss or hardware malfunction is inferred from an undoable or display-only defect.

| Finding | Priority | Repair and verification |
| --- | --- | --- |
| SG-001 | P2 | Snap settings uses form-style Tab traversal; keyboard regression checks traversal and Escape focus restoration. |
| SG-002 | P3 | Overflowing toast stacks own pointer scrolling and their scrollbar. Fitting stacks remain click-through. Chrome checks wheel input over text and the scrollbar area, then the fitting-stack control. |
| SG-003 | P2 | Final PNG source assembly checks the combined import signal. The delayed final-read regression cancels without insertion or a success toast. |
| SG-004 | P2 | Select All uses hierarchy-scoped selection. Delete inside a group leaves outside artwork intact, with exact Undo/Redo. |
| SG-005 | P3 | Auto-connect persistence uses the existing warning/retry queue, remembers the latest requested session value, and reacquires a formerly denied storage getter on Retry. |
| SG-006 | P2 | Numeric fields are keyed by document and selection identity. A pending old draft is retired on selection change; a committed Enter edit cannot repeat on another object. Same-size selections and real canvas clicks are covered. |
| SG-007 | P3 | Docked Console commands and filters live in workspace memory across full remounts. Restoring them sends nothing; Super Console retains its separate local draft. |
| PF-001 | P2 | Recent opens reserve request ownership before asynchronous reading, suppressing older completions after a newer Open. |
| PF-002 | P3 | DXF, native-project and LightBurn text fallbacks recheck abort signals after their asynchronous reads and before parsing/publication. |
| PF-003 | P2 | An incoming name-only project does not match a different known file solely by filename. Known file identity and picker fallback controls remain covered. |
| PF-004 | P3 | Per-entry probe versions retire stale Missing results after a newer successful read or probe. |
| PF-005 | P3 | Unpin trims unpinned history against the committed Keep limit inside the mutation. |
| PF-006 | P2 | A shared launch-delivery chain preserves order across separate PWA launch callbacks as well as within one batch. |
| PF-007 | P2 | External opens recheck modal state immediately before publication and retain the existing pending-open offer instead of replacing work under a new Notes dialog. |
| PF-008 | P3 | File identity is checked against a transaction snapshot; a changed snapshot retries against current entries, preventing duplicate successful concurrent same-file records. |
| PF-009 | P3 | Snapshot completion clears the name field only if it still contains the submitted draft. |
| PF-010 | P2 | Template commands reserve Open ownership before the asynchronous discard/Save guard; newer pending or cancelled requests retire them. |
| PF-011 | P3 | History mutations read the persisted Keep limit, so another window's saved change applies without opening the File menu first. Pending unsaved limits do not trim history. |
| ART-001 | P2 | A split Pen polyline becomes a same-ID path when multiple subpaths cannot fit its parametric representation. Break/Delete Segment and converted-path controls are covered. |
| ART-002 | P2 | Duplicate, Paste and Paste in Place clear the original node selection before subsequent edits; history controls verify the original is untouched. |
| ART-003 | P2 | Layout availability and builders use groups within the entered hierarchy focus. Align, Distribute, Match Size and Move Together receive distinct selected units. |
| ART-004 | P2 | Join Paths repairs text dependencies on absorbed guides, allowing ordinary text editing to finish. |
| ART-005 | P3 | Geometry repair carries the artwork's custom name into the surviving object. |
| ART-006 | P2 | Upright unchanged-size copies use the existing validated piecewise gap solver. Tests measure the promised projected endpoint clearance across a bend. |
| ART-007 | P2 | Warp/Deform Apply receives the current display geometry and verifies its source project. QR decoding checks the preview and committed value agree, with Undo/Redo and unchanged-value controls. |
| ART-008 | P2 | Font rendering retains glyph/cluster contour ownership through styling, so kerned overlapping letters bend independently without distorting their own contours. Real-font, style, multiline and worker controls are included. |
| ART-009 | P2 | Path-text guides remove consecutive duplicate points and close the guide only once. Reverse at zero offset keeps the first glyph's stem length. |
| ART-010 | P2 | Retained-array merge imports only groups owned by generated instances, leaving preserved source groups unchanged across repeated regeneration. |
| ART-011 | P3 | Retained source capture preserves complete selected groups. For older saved arrays, replay reconstructs grouping from the actual baseline instance hierarchy, so a previously truncated source parent cannot invent groups on regeneration. |
| IMG-001 | P3 | Resize dimensions are coupled at either edge cap while proportions are constrained; both aspect directions and the ordinary cap control are covered without allocating a giant image. |
| IMG-002 | P3 | Closing or replacing an image session clears its Clone source and offset. A new image requires a fresh source selection. |
| IMG-003 | P3 | A real Image Size change clears obsolete crop coordinates; resize and crop history remain independently undoable. |
| IMG-004 | P3 | Pointer gestures subscribe to their tool/session/draft owner. Escape and replacement sessions cancel the held gesture before move/up can commit it; fresh-gesture controls still work. |
| IMG-005 | P3 | Hover information reads the already-rendered composite, including enabled previews. Transparent upper layers agree with the visible pixels and eyedropper without recompositing every pointer move. |

## Evidence and limits

Original audit ledgers remain in their owners' ignored build directories. This worktree retains fresh before/after logs and per-area dispositions under ignored `build/audit34/` and `build/audit-files/`. Permanent regression suites are committed beside the implementations; `e2e/audit-workflow-repairs.spec.ts` covers Snap traversal, notification scrolling and numeric draft ownership in Chrome.

- Interface/settings: the first repaired cohort passed 95 cases across 17 files, including adjacent Console, preference, PNG-import, numeric-unit and toast behaviour.
- Images: the baseline added regressions exposed 11 failures with 33 passing controls; after repair, 53 distinct focused cases passed. Two early recovery-control assertions used a one-pixel brush at integer corners, covering no pixel centres; correcting that fixture made the controls pass without changing production code.
- Artwork/text: all 11 families reproduced. The broader repaired cohort passed 228 cases across 28 files. Cross-review then reproduced the legacy saved-array case; its repair passed 24 retained-array cases, including nested groups and shared dependencies. Four additional Warp display/QR/lock ownership controls passed. These runs overlap and are not added together.
- Files/projects: original diagnostics reproduced the reported ordering, cancellation, identity and draft mechanisms. The repaired cohort passed 77 cases across 10 files; two storage-refusal/pending-preference controls and eight history cases after correcting required fixture metadata also passed. These runs overlap.

The ADR-378 documented duplicate-history exception after initial IndexedDB read refusal is preserved: identity cannot be checked against a list that was unavailable. PF-008 fixes successful concurrent records. Copy Along Path's projected gap rule does not promise general collision avoidance on folded or intersecting guides. Numeric selection changes retire unfinished numeric drafts; Enter or blur before changing selection remains the ordinary explicit commit path.

Initial local test attempts exposed sandbox child-process/network restrictions, cold renderer startup and development reloads from diagnostic HTML. Those attempts are retained as infrastructure evidence, not product failures. Final browser runs use isolated ports/caches and matching served source. No real controller was opened or commanded. This is software verification, not installer, provider, deployment or physical-material qualification.

## Final integration verification

The three Chrome regressions passed: native Snap traversal/Escape, notification scrolling over text/scrollbar with a fitting-stack click-through control, and real canvas selection changes with pending or Enter-committed numeric edits. E2E typechecking and the production renderer bundle passed. Repository ADR, physical-line, soft-size and export-ratchet gates passed.

Independent cross-review checked all four areas. It caught the legacy ART-011 case above, which was reproduced and repaired before publication. The full TypeScript run found one incomplete new Recent-file test fixture; required metadata was added, and its eight-case suite passed. The final complete typecheck, repository lint/format checks and hosted PR checks qualify the final integrated head; their completion is recorded in the PR. No earlier or queued check is counted as a merge verdict.
