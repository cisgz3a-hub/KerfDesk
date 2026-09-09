# CNC tab count and editor synchronisation proposal

Status: draft for review, 2026-09-06. This preserves a bounded historical change;
adoption is pending. No hardware qualification is claimed.

## Reproduced intentions

On main `00abb56e151332a85d9f9673ed6a5e0fae3faaef`, two store-backed UI regressions
failed before the port: disabling Holding tabs left the `cnc-tabs` editor armed;
changing Tabs per shape from 4 to 6 published a project with count 6 and four
saved anchors. Existing dragged anchors take precedence over automatic spacing
where the compiler's current color mapping resolves them.

The proposed port closes the matching operation's editor when tabs are disabled,
without deleting its saved positions. New editor sessions record the operation
ID in ephemeral UI state so another same-color operation's editor is preserved.
Re-enabling tabs keeps the dragged positions and does not reopen the editor.

Changing the count updates the operation and eligible saved anchors in the same
`setLayerParam` transaction. Subscribers see the complete project once; one Undo
and Redo restore settings and anchors together. Only closed contours with existing
anchors on unlocked paths bound exclusively to that operation are redistributed.
Explicit path bindings take precedence over object bindings; geometry color alone
does not select other explicitly bound operations. Unanchored contours remain
automatic. Unrelated paths, operations, geometry, and operation bindings stay put.
Changing height, width, enabled state, or committing the same count preserves
dragged positions. Pocket and generated inlay handling remain unchanged.

## Preserved limits requiring review

**Shared paths:** `CncTabAnchor` in `src/core/scene/scene-object.ts` stores source
color, path index, polyline index, and normalized fraction, with no operation ID.
Two operations bound to the same path can therefore consume the same saved
positions. This draft leaves those anchors unchanged instead of moving another
operation's tabs. The count setting still changes; saved shared-path positions
can continue to determine a different actual count. Locked artwork also retains
its saved positions. The count control states these exceptions visibly and in its
tooltip. `cnc-tab-count-sync.test.ts` verifies shared anchors, another operation's
collected positions, and locked objects remain unchanged.

**Existing compiler color mapping:** `appendObjectContours` in
`src/core/cnc/collect-cnc-contours.ts` correctly checks `pathUsesOperation`, but
passes `layer.color` into `objectTabPoints`. That function filters anchors by the
operation presentation color; `cncTabAnchorPosition` then requires the anchor
color to match the source path color. The editor instead seeds using source path
color in `src/ui/layers/CncTabPositionControls.tsx`. With differing operation and
source colors, the existing compiler ignores those saved manual positions and
uses automatic placement. This draft does not change that mapping or the schema.

External observational probes on the same base reproduced both differing-color
manual-position omission and same-color shared-path reuse. Those probes stay
outside the product test suite: the unresolved behavior is evidence, not a new
regression contract. Stored-anchor assertions for multiple source colors are not
emitted-position proof. The focused compilation test uses matching operation and
source colors and verifies four, then six, then four, then six compiled tab rises
across edit, Undo, and Redo. Physical bridges remain unqualified.

The explicit follow-up is to decide operation ownership for manual tab positions
and repair the compiler/editor color mapping together, with migration, shared-path,
transformed roughing/finishing, and output evidence. That design is outside this
preservation PR and must not be lost when reviewing or closing it. Until reviewed,
this PR remains draft; neither a passing test nor preservation authorizes adoption.

## Historical donor dispositions

Donor: `C:/Users/Asus/LaserForge-2.0/.claude/worktrees/tab-dots-canvas-sync-f76ce0`,
branch `claude/tab-dots-canvas-sync-f76ce0`, HEAD
`f36175ea4e16952950c0b426a0c158d91b93769e`. Original working files and index are
preserved; raw SHA-256 receipts are held in the external commit/PR monitor.

| Authored donor path | Current-main disposition |
| --- | --- |
| `src/core/cnc/cnc-tab-anchors.ts` | Reimplemented as explicit eligible-path redistribution; existing seed/drag geometry is preserved. |
| `src/ui/layers/CncLayerAdvancedFields.tsx` | Extracted only the tab controls needed by this slice. |
| `src/ui/layers/CncLayerFields.test.tsx` | Intentions ported to dedicated store-backed UI regressions; existing coverage retained. |
| `src/ui/layers/CncLayerFields.tsx` | Wires the extracted tab controls into the current operation editor. |
| `src/ui/layers/CncTabPositionControls.tsx` | Retains current path-color resolution and adds ephemeral operation identity for editor matching. |
| `src/ui/state/cnc-tab-actions.test.ts` | Boundary cases reworked in `cnc-tab-count-sync.test.ts`; existing seed/drag tests retained. |
| `src/ui/state/cnc-tab-actions.ts` | Color-wide second setter omitted; synchronisation runs inside the settings transaction via `cnc-tab-count-sync.ts`. |
| `src/ui/layers/CncTabFields.tsx` | Disable/count intentions ported; shared-path/locked exceptions disclosed. |
| `src/ui/layers/tab-path-color.ts` | Shared resolver extraction omitted; operation identity owns editor matching and path membership owns redistribution. |

The donor's `AGENTS.md` and `CLAUDE.md` copies are preserved and excluded from this
publication. PR746 operation bindings, PR727 transformed tab projection, and PR737
tab coverage/seam behavior remain governing current implementations. Frame and
Start policy, hardware, deployment, and unrelated cleanup are outside this draft.
