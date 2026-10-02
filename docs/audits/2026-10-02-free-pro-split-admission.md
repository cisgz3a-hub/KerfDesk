# Free/Pro split-artwork admission audit, 2026-10-02

Baseline: `a03d8b2e3d44ff4eda66acbea78620167c3db0ff` (`origin/main`, desktop
1.0.7). The customer's reported feature and build are not yet identified, so
these findings do not conclusively diagnose that incident.

## Confirmed findings

Break Apart used the ordinary store setter. A compound SVG carrying an existing
V-carve, relief or adaptive-pocket operation became two independently selectable
objects, each retaining that operation, without requesting Pro. Cut Shapes had
the same composition gap: its outside and inside pieces retained the source's
Pro binding without admission. Both actions removed the original, but the
current Offset Shapes contract explicitly treats multiple replacement results
as copies. ADR-540 Amendment 1 item 6 requires new Pro work to request Pro.

The isolated baseline replay exercised both actions for all three operation
families. The proposed results were also identified as new Pro work by the
canonical `newlyIntroducedProFeature` policy. Before repair, the first 20 focused
regressions had 16 failures and four passes.

## Repair

Both split actions now use `proOperationMutationSetter`. The complete edit
remains outside the document while its licence prompt is pending. An unlock can
commit it only to the project and document epoch that requested it.

The shared setter accepts an optional commit notification. Success messages and
dependency-repair notices run after a successful commit, and a repeated or stale
unlock cannot emit them. Each deferred admission callback is consumed before
checking document ownership or committing, including after Undo restores the
original document. Proposed undo labels are restored while admission is pending
and become active only when that edit commits.

Ordinary Free splits, editing an existing Pro operation, undo and redo remain
available. This repair adds no licence gate to project opening, Preview, Frame,
Start, Save G-code, machine control or a running job. It changes no entitlement,
trial, paid-rights, controller or output implementation.

## Verification and delivery boundary

The focused suite covers all three operation families, immediate and deferred
admission, repeated callbacks, stale project and epoch ownership, notifications,
undo labels, ordinary Free splits and history restoration. Its final 26 tests
passed. The eight focused files first passed 87 tests; four added history and
notification cases then passed. A further seven browser-Free, Pro-choice,
provider, command and commercial-entitlement files passed 51 tests. Two added
replay-after-Undo cases failed before callback consumption and passed after it.
Together these cover 144 distinct test cases. Root TypeScript, scoped ESLint, formatting
and diff whitespace checks passed, as did the browser-Free production build
and file-size backstop. Complete publication checks and installed qualification
of this repair remain separate.

A fresh no-cache hosted read at 2026-10-02 06:44 UTC found the browser-Free
capability marker and build `a03d8b2e`, version `0.1.3001`. The public desktop
pointer still matched the previously signature-verified 1.0.7 receipt. Existing
Windows qualification records show commercial metadata verification and normal
native Free status; they do not qualify every Pro entry, paid activation or this
new repair on an installed commercial app. Source checks are not installed-app
or physical-machine evidence. Publication and customer update remain separate.

A fresh independent review found no production blocker in the split admission,
ordinary setter composition, project ownership, undo labels or notifications.
Its incremental callback checks also confirmed that consumed approval cannot
replay after restoration of the original project or revive after stale rejection.
These bounded helper checks used dependency stubs and are not native qualification.
