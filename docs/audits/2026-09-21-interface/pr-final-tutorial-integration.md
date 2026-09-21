# Final tutorial integration — 2026-09-22

Main advanced from `9d72ba798` to `af1a1b83f7ece14a46e3386b1845bb35daf971ac`
(tutorial navigation and copy, PR #822). The branch incorporated it at
`35b873829c9eb6681d52cc966dc7e15564be4360`. The earlier **805/91** and **815/94**
control/command inventories and their evidence remain dated snapshots.

The separate [final source inventory](pr-final-source/buttons.json) contains **817 control
definitions and 94 command IDs**, across 2,637 scanned source files. Its SHA-256 of scanned
paths and contents is `46a5737e33d88d6fd46d90f49496b6f12229e8a0d38074f4bad895f03cbd93ad`.
The corpus excludes named test/spec files and fixtures but includes helper modules. Counts
refer to source definitions and call sites, not simultaneously visible buttons or runtime passes.

## Changed controls

The [seven-definition delta](pr-final-tutorial-control-delta.json) reconciles **810 unchanged
catalogue signatures, five changed or relocated definitions, and two introduced definitions**.
The net increase is two; no command IDs changed. The JSON preserves old/current IDs, exact
case names, limitations and the 29-file upstream change list. Matching signatures do not
automatically carry historical verdicts forward.

| Current definition | Change and executed software outcome |
| --- | --- |
| `TutorialHost.tsx:46` — Close | Updated title; Close immediately exits and clears history. Exercised for all 93 lesson bindings and a fresh contextual reopen. |
| `TutorialLibrary.tsx:46` — More for other machines | New button removes the machine filter, reveals the exact full lesson set and disappears. |
| `TutorialLibrary.tsx:103` — Category | Moved into Filters. Every category and All selects its exact card set, updates the pressed state and controls opening-panel visibility. |
| `TutorialLibrary.tsx:146` — Lesson card | Updated progress text. All 93 card bindings open their named lesson; completion and saved progress are checked separately. |
| `TutorialReader.tsx:128` — Previous lesson / All tutorials | Both clicked Back branches return to the expected parent or library, with the trail updated correctly. |
| `TutorialStart.tsx:25` — Start / Continue | Replaces the fixed first-project shortcut. Fresh, completed-first, half-read and completed-path states select or hide the intended action. |
| `TutorialStart.tsx:43` — Opening path | New mapped button. Every current starter lesson opens its own heading and first step; returning to the library preserves the project. |

All seven definitions have **verified software behaviour** within the specific fixtures and
assertions recorded in the JSON. They are not claims about every state permutation or the
physical operations described in a lesson. Completed starter items remain visible and marked
Done; clicking an already-completed starter item is not a separate new assertion. The updated
Continue text is not checked for every possible step value.

Escape now walks back one level: related lesson → previous lesson → library → workspace.
The Close button still exits immediately. Left/Right arrow keys advance or reverse lesson
steps, retain progress and stop at the ends. Those keyboard routes have their own executed
cases; typing-target and modifier-key variants were not added to this audit.

## Executed evidence

The [final narrow Vitest report](pr-final-tutorial-vitest.json) records **132 passed, zero failed,
zero skipped** across six files:

| Test file | Passed cases | Scope |
| --- | ---: | --- |
| `TutorialControls.audit.test.tsx` | 100 | 93 named card/contextual bindings, three existing control cases, four new integration cases |
| `tutorial-navigation.test.tsx` | 4 | Arrows, Escape history, Continue, fresh reopen after Close |
| `tutorial-fidelity.test.ts` | 6 | Selected catalogue, wording, location-prefix and shortcut consistency checks |
| `TutorialHost.test.tsx` | 6 | Steps, completion, filters, nested draft preservation and focus restoration |
| `TutorialPhoto.test.tsx` | 15 | Picture selection, failure/retry, mapped steps and project isolation |
| `CutSettingsDialog.tutorial.test.tsx` | 1 | Lesson → library → closed retains the unsaved cut draft and restores focus |

The [initial targeted attempt](pr-final-tutorial-initial-vitest.json) retains **one failed,
95 skipped**: the old audit searched for retired “Start your first project” wording. The audit
now locates the primary action and independently asserts its intended first-project destination.
Its Close title lookup and history resets were also adapted to the new contract. No production
source was changed during this follow-up, and no production defect was confirmed.

The parent-run [compiled Chromium report](pr-final-tutorial-browser.json) passes **1/1**:
“routine controls stay visible while setup, history, and tutorials remain reachable”. It opens
the contextual Jogging lesson, checks Escape returning first to the library and then workspace,
and checks focus restoration. This is a compiled-app check of that scenario, not all seven
controls in a browser. The JSDOM picture tests do not prove browser image decoding, and the
copy tests do not execute the operations described by the lessons. No hardware was operated.

Scoped ESLint and Prettier passed for the adapted audit test. Build and broader repository
verification remain recorded by the integration owner in [verification.md](verification.md).

## Reproduction

```sh
node docs/audits/2026-09-21-interface/inventory-buttons.mjs docs/audits/2026-09-21-interface/pr-final-source
pnpm exec vitest run src/ui/tutorials/TutorialControls.audit.test.tsx src/ui/tutorials/tutorial-navigation.test.tsx src/ui/tutorials/tutorial-fidelity.test.ts src/ui/tutorials/TutorialHost.test.tsx src/ui/tutorials/TutorialPhoto.test.tsx src/ui/layers/CutSettingsDialog.tutorial.test.tsx --maxWorkers=1 --reporter=json --outputFile=docs/audits/2026-09-21-interface/pr-final-tutorial-vitest.json
```

Use a new report filename when retaining another attempt. Keep the historical source inventories
and verdict matrices unchanged.
